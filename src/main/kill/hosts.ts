import { execFile as execFileCallback } from "node:child_process";
import { readdirSync, readFileSync, existsSync, readlinkSync } from "node:fs";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import type {
  CommandRunner,
  ExecResult,
  ListedProcess,
  ProcessHost,
} from "./types";

const execFileAsync = promisify(execFileCallback);

const DEFAULT_TIMEOUT_MS = 12_000;

export async function defaultExecFile(
  file: string,
  args: readonly string[],
  options?: { timeout?: number },
): Promise<ExecResult> {
  try {
    const result = await execFileAsync(file, [...args], {
      timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 12 * 1024 * 1024,
    });
    return {
      stdout: stringify(result.stdout),
      stderr: stringify(result.stderr),
      status: 0,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      code?: number | string;
    };
    const status =
      typeof err.status === "number"
        ? err.status
        : typeof err.code === "number"
          ? err.code
          : 1;
    return {
      stdout: stringify(err.stdout),
      stderr: stringify(err.stderr) || err.message || "Command failed",
      status,
    };
  }
}

function stringify(value: string | Buffer | undefined): string {
  if (value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : value.toString("utf8");
}

export function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === undefined) {
      break;
    }
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

export function parseTasklistCsv(output: string): ListedProcess[] {
  const rows: ListedProcess[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    const cols = parseCsvLine(line);
    const name = cols[0]?.trim();
    const pidRaw = cols[1]?.trim();
    if (!name || !pidRaw) {
      continue;
    }
    if (name.toLowerCase() === "image name") {
      continue;
    }
    const pid = Number.parseInt(pidRaw, 10);
    if (!Number.isInteger(pid) || pid < 0) {
      continue;
    }
    rows.push({ pid, name });
  }
  return rows;
}

function windowsSystem32(tool: string): string {
  const root = process.env["SystemRoot"] ?? "C:\\Windows";
  return join(root, "System32", tool);
}

export class WindowsProcessHost implements ProcessHost {
  private readonly runner: CommandRunner;

  constructor(runner: CommandRunner = { execFile: defaultExecFile }) {
    this.runner = runner;
  }

  async list(): Promise<ListedProcess[]> {
    const tasklistError = await this.tryTasklist();
    if (tasklistError.ok) {
      return tasklistError.processes;
    }
    const powershell = await this.tryPowerShell();
    if (powershell.ok) {
      return powershell.processes;
    }
    throw new Error(
      `Failed to list Windows processes: ${tasklistError.error}; fallback: ${powershell.error}`,
    );
  }

  async terminate(pid: number): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`Invalid pid ${pid}`);
    }
    const result = await this.runner.execFile(
      windowsSystem32("taskkill.exe"),
      ["/PID", String(pid), "/F"],
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    if (result.status === 0) {
      return;
    }
    const detail = (result.stderr || result.stdout).trim();
    if (result.status === 128 || /not found/i.test(detail)) {
      return;
    }
    throw new Error(detail || `taskkill exited ${result.status}`);
  }

  private async tryTasklist(): Promise<
    { ok: true; processes: ListedProcess[] } | { ok: false; error: string }
  > {
    const result = await this.runner.execFile(
      windowsSystem32("tasklist.exe"),
      ["/FO", "CSV", "/NH"],
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    if (result.status !== 0) {
      return {
        ok: false,
        error: (result.stderr || result.stdout || `tasklist exited ${result.status}`).trim(),
      };
    }
    const processes = parseTasklistCsv(result.stdout);
    if (processes.length === 0) {
      return { ok: false, error: "tasklist returned no processes" };
    }
    return { ok: true, processes };
  }

  private async tryPowerShell(): Promise<
    { ok: true; processes: ListedProcess[] } | { ok: false; error: string }
  > {
    const ps = join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const script =
      "Get-Process | ForEach-Object { '{0},{1}' -f $_.Id, $_.ProcessName }";
    const result = await this.runner.execFile(
      ps,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { timeout: DEFAULT_TIMEOUT_MS },
    );
    if (result.status !== 0) {
      return {
        ok: false,
        error: (result.stderr || result.stdout || `powershell exited ${result.status}`).trim(),
      };
    }
    const processes: ListedProcess[] = [];
    for (const raw of result.stdout.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) {
        continue;
      }
      const comma = line.indexOf(",");
      if (comma <= 0) {
        continue;
      }
      const pid = Number.parseInt(line.slice(0, comma), 10);
      const name = line.slice(comma + 1).trim();
      if (!Number.isInteger(pid) || pid < 0 || !name) {
        continue;
      }
      processes.push({ pid, name });
    }
    if (processes.length === 0) {
      return { ok: false, error: "PowerShell Get-Process returned no processes" };
    }
    return { ok: true, processes };
  }
}

export function parsePsTable(output: string): ListedProcess[] {
  const rows: ListedProcess[] = [];
  for (const raw of output.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      continue;
    }
    const match = /^(\d+)\s+(\S.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const pidRaw = match[1];
    const rest = match[2];
    if (!pidRaw || rest === undefined) {
      continue;
    }
    const pid = Number.parseInt(pidRaw, 10);
    const name = basename(rest.trim().split(/\s+/)[0] ?? rest.trim());
    if (!Number.isInteger(pid) || pid < 0 || !name) {
      continue;
    }
    rows.push({ pid, name });
  }
  return rows;
}

function listLinuxProc(): ListedProcess[] {
  const rows: ListedProcess[] = [];
  let entries: string[];
  try {
    entries = readdirSync("/proc");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read /proc: ${message}`);
  }
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const pid = Number.parseInt(entry, 10);
    if (!Number.isInteger(pid) || pid < 0) {
      continue;
    }
    const name = linuxProcessName(pid);
    if (!name) {
      continue;
    }
    rows.push({ pid, name });
  }
  return rows;
}

function linuxProcessName(pid: number): string | undefined {
  try {
    const exe = readlinkSync(`/proc/${pid}/exe`);
    const base = basename(exe.replace(/ \(deleted\)$/u, ""));
    if (base) {
      return base;
    }
  } catch {
    // Permission or zombie — fall back to comm.
  }
  try {
    const comm = readFileSync(`/proc/${pid}/comm`, "utf8").trim();
    return comm || undefined;
  } catch {
    return undefined;
  }
}

export class PosixProcessHost implements ProcessHost {
  private readonly runner: CommandRunner;

  constructor(runner: CommandRunner = { execFile: defaultExecFile }) {
    this.runner = runner;
  }

  async list(): Promise<ListedProcess[]> {
    if (existsSync("/proc/self")) {
      const fromProc = listLinuxProc();
      if (fromProc.length > 0) {
        return fromProc;
      }
    }
    const result = await this.runner.execFile("ps", ["-Ao", "pid=,comm="], {
      timeout: DEFAULT_TIMEOUT_MS,
    });
    if (result.status !== 0) {
      throw new Error(
        (result.stderr || result.stdout || `ps exited ${result.status}`).trim(),
      );
    }
    const parsed = parsePsTable(result.stdout);
    if (parsed.length === 0) {
      throw new Error("ps returned no processes");
    }
    return parsed;
  }

  async terminate(pid: number): Promise<void> {
    if (!Number.isInteger(pid) || pid <= 0) {
      throw new Error(`Invalid pid ${pid}`);
    }
    try {
      process.kill(pid, "SIGKILL");
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === "ESRCH") {
        return;
      }
      throw new Error(err.message || `Failed to signal pid ${pid}`);
    }
  }
}

export class MemoryProcessHost implements ProcessHost {
  readonly seed: ListedProcess[];
  readonly killed = new Set<number>();
  readonly fail = new Map<number, string>();

  constructor(seed: readonly ListedProcess[]) {
    this.seed = seed.map((proc) => ({ pid: proc.pid, name: proc.name }));
  }

  async list(): Promise<ListedProcess[]> {
    return this.seed.filter((proc) => !this.killed.has(proc.pid));
  }

  async terminate(pid: number): Promise<void> {
    const failure = this.fail.get(pid);
    if (failure !== undefined) {
      throw new Error(failure);
    }
    const found = this.seed.some((proc) => proc.pid === pid);
    if (!found) {
      throw new Error(`Process not found: ${pid}`);
    }
    if (this.killed.has(pid)) {
      return;
    }
    this.killed.add(pid);
  }
}

export function createPlatformHost(): ProcessHost {
  if (process.platform === "win32") {
    return new WindowsProcessHost();
  }
  return new PosixProcessHost();
}
