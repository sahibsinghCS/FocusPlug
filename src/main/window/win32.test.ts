import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, test } from "node:test";
import {
  FOREGROUND_SCRIPT,
  encodePowerShellCommand,
  parseForegroundPayload,
} from "./win32.ts";

const isWindows = process.platform === "win32";
const windowsOnly = { skip: isWindows ? false : "requires win32" } as const;

/**
 * PowerShell variable names are case-insensitive, and these automatic variables
 * are Constant or ReadOnly: writing one throws "Cannot overwrite variable X
 * because it is read-only or constant".
 *
 * Regression: `$pid` (i.e. `$PID`, the PowerShell host's own process id) was
 * used as the out-parameter for GetWindowThreadProcessId, so every tick threw,
 * the catch emitted an empty payload, and the window sensor matched nothing on
 * real Windows while every simulated-reader test still passed.
 */
export const RESERVED_PS_VARIABLES: readonly string[] = [
  "pid",
  "host",
  "home",
  "pshome",
  "true",
  "false",
  "null",
  "error",
  "matches",
  "args",
  "input",
  "this",
  "_",
  "psitem",
  "shellid",
  "executioncontext",
  "myinvocation",
  "stacktrace",
  "psversiontable",
  "psculture",
  "psuiculture",
];

/** Assignment (`$x =`, `[uint32]$x = 0`) or out-parameter (`[ref]$x`). */
function writesTo(script: string, variable: string): boolean {
  const name = variable.replace(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);
  const notNameChar = "(?![A-Za-z0-9_])";
  const assigned = new RegExp(`\\$${name}${notNameChar}\\s*=(?!=)`, "iu");
  const byRef = new RegExp(`\\[ref\\]\\s*\\$${name}${notNameChar}`, "iu");
  return assigned.test(script) || byRef.test(script);
}

/** One pass of the shipped loop body, so the run terminates. */
function boundedScript(): string {
  const bounded = FOREGROUND_SCRIPT.replace(
    "while ($true) {",
    "for ($iteration = 0; $iteration -lt 1; $iteration++) {",
  );
  assert.notEqual(bounded, FOREGROUND_SCRIPT, "loop header should be bounded");
  return bounded;
}

describe("FOREGROUND_SCRIPT", () => {
  test("never writes to a reserved PowerShell automatic variable", () => {
    const offenders = RESERVED_PS_VARIABLES.filter((name) =>
      writesTo(FOREGROUND_SCRIPT, name),
    );
    assert.deepEqual(
      offenders,
      [],
      `reserved PowerShell variable(s) written: ${offenders.join(", ")}`,
    );
  });

  test("guard catches the original $pid regression", () => {
    const regressed = FOREGROUND_SCRIPT.replace(/\$fgPid\b/gu, () => "$pid");
    assert.ok(
      writesTo(regressed, "pid"),
      "guard must flag the reverted script",
    );
  });

  test("emits the keys parseForegroundPayload reads", () => {
    for (const key of ["processName", "windowTitle", "pid"]) {
      assert.ok(
        FOREGROUND_SCRIPT.includes(`${key} =`),
        `script should build a ${key} field`,
      );
    }
  });
});

describe("Win32 foreground script on Windows", windowsOnly, () => {
  test("runs without faulting and names the focused process", () => {
    const result = spawnSync(
      "powershell.exe",
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowerShellCommand(boundedScript()),
      ],
      { encoding: "utf8", timeout: 30_000, windowsHide: true },
    );

    assert.equal(result.error, undefined, String(result.error));

    // The script reports its own faults on stderr; anything else there is
    // PowerShell CLIXML progress noise.
    const faults = (result.stderr ?? "")
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("foreground reader:"));
    assert.deepEqual(faults, [], `script faulted: ${faults.join(" | ")}`);

    const payloads = (result.stdout ?? "")
      .split(/\r?\n/u)
      .map((line) => parseForegroundPayload(line))
      .filter((payload) => payload !== null);
    assert.ok(payloads.length > 0, `no payload on stdout: ${result.stdout}`);

    // A pid means a window was found, so the process name must resolve. Under a
    // session with no foreground window (some CI) pid is 0 and there is nothing
    // to name — the fault assertion above is the regression guard either way.
    for (const payload of payloads) {
      if (payload!.pid !== undefined && payload!.pid > 0) {
        assert.notEqual(
          payload!.processName,
          "",
          `pid ${payload!.pid} resolved to an empty process name`,
        );
      }
    }
  });
});
