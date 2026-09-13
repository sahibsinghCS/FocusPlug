import { spawn, type ChildProcess } from "node:child_process";
import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import type { ForegroundReader, ForegroundWindow } from "./foreground.ts";

const POLL_MS = 200;
const RESTART_BACKOFF_MS = [500, 1000, 2000, 5000] as const;
/** Marks our own stderr diagnostics apart from PowerShell CLIXML noise. */
const FAULT_PREFIX = "foreground reader: ";

/**
 * Persistent hidden PowerShell process calling GetForegroundWindow / GetWindowText /
 * GetWindowThreadProcessId. Avoids per-tick spawn cost so the monitor can meet a 1s SLA.
 *
 * Locals must not collide with a PowerShell automatic variable (names are
 * case-insensitive). `$pid` is `$PID` — Constant + AllScope — so `[ref]$pid`
 * threw "Cannot overwrite variable PID", the catch swallowed it, and every
 * snapshot came back empty. See `RESERVED_PS_VARIABLES` in win32.test.ts.
 */
export const FOREGROUND_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class FocusPlugFg {
  [DllImport("user32.dll")]
  public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
}
"@
while ($true) {
  try {
    $hwnd = [FocusPlugFg]::GetForegroundWindow()
    [uint32]$fgPid = 0
    [void][FocusPlugFg]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
    $sb = New-Object System.Text.StringBuilder 2048
    [void][FocusPlugFg]::GetWindowText($hwnd, $sb, $sb.Capacity)
    $name = ""
    if ($fgPid -ne 0) {
      $proc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
      if ($proc) { $name = [string]$proc.ProcessName }
    }
    $payload = [ordered]@{
      processName = $name
      windowTitle = $sb.ToString()
      pid = [int64]$fgPid
    }
    Write-Output ($payload | ConvertTo-Json -Compress)
  } catch {
    # Surface the fault once per distinct message: a silent catch here reads as
    # "no window focused" and hides a broken reader. Console::Error ignores
    # $ErrorActionPreference.
    $faultMessage = $_.Exception.Message
    if ($faultMessage -ne $lastFault) {
      $lastFault = $faultMessage
      [Console]::Error.WriteLine("${FAULT_PREFIX}" + $faultMessage)
    }
    Write-Output '{"processName":"","windowTitle":"","pid":0}'
  }
  Start-Sleep -Milliseconds ${POLL_MS}
}
`;

export function encodePowerShellCommand(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asPid(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  return undefined;
}

export function parseForegroundPayload(line: string): ForegroundWindow | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const processName = asString(record.processName ?? record.ProcessName);
  const windowTitle = asString(record.windowTitle ?? record.WindowTitle);
  const pid = asPid(record.pid ?? record.Pid ?? record.PID);

  const window: ForegroundWindow = { processName, windowTitle };
  if (pid !== undefined) {
    window.pid = pid;
  }
  return window;
}

export class Win32ForegroundReader implements ForegroundReader {
  private child: ChildProcess | null = null;
  private rl: ReadlineInterface | null = null;
  private latest: ForegroundWindow | null = null;
  private lastFault: string | null = null;
  private wanted = false;
  private restartAttempts = 0;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  read(): ForegroundWindow | null {
    return this.latest;
  }

  start(): void {
    this.wanted = true;
    this.restartAttempts = 0;
    this.spawnChild();
  }

  stop(): void {
    this.wanted = false;
    if (this.restartTimer !== null) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    this.teardownChild();
  }

  private spawnChild(): void {
    if (!this.wanted || this.child !== null) {
      return;
    }

    const child = spawn(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShellCommand(FOREGROUND_SCRIPT),
      ],
      {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    this.child = child;
    if (child.stdout === null) {
      this.teardownChild();
      this.scheduleRestart();
      return;
    }
    this.rl = createInterface({ input: child.stdout });
    this.rl.on("line", (line) => {
      const parsed = parseForegroundPayload(line);
      if (parsed !== null) {
        this.latest = parsed;
        this.restartAttempts = 0;
      }
    });

    // stderr must be drained or a full pipe stalls the child. PowerShell also
    // writes CLIXML progress records here, so only our own line is reported.
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const raw of String(chunk).split(/\r?\n/u)) {
        const text = raw.trim();
        if (!text.startsWith(FAULT_PREFIX) || text === this.lastFault) {
          continue;
        }
        this.lastFault = text;
        console.error(text);
      }
    });

    const onExit = (): void => {
      this.teardownChild();
      this.scheduleRestart();
    };
    child.once("exit", onExit);
    child.once("error", onExit);
  }

  private teardownChild(): void {
    // Drop the cached window with the child that produced it. A restart or a
    // stopped session must read as empty focus, not replay the previous
    // session's foreground window under fresh timestamps.
    this.latest = null;
    if (this.rl !== null) {
      this.rl.removeAllListeners();
      this.rl.close();
      this.rl = null;
    }
    if (this.child !== null) {
      this.child.stderr?.removeAllListeners();
      this.child.removeAllListeners();
      if (!this.child.killed) {
        this.child.kill();
      }
      this.child = null;
    }
  }

  private scheduleRestart(): void {
    if (!this.wanted || this.restartTimer !== null) {
      return;
    }
    const delay =
      RESTART_BACKOFF_MS[Math.min(this.restartAttempts, RESTART_BACKOFF_MS.length - 1)] ??
      5000;
    this.restartAttempts += 1;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      this.spawnChild();
    }, delay);
  }
}
