import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MemoryProcessHost, parseCsvLine, parseTasklistCsv, WindowsProcessHost } from "./hosts";
import { DEFAULT_STUDY_PROCESS_MATCHERS } from "./protect";
import { BlocklistTerminator, createProcessKiller, formatProc } from "./terminator";
import type { CommandRunner, ListedProcess } from "./types";

function procs(...pairs: Array<[number, string]>): ListedProcess[] {
  return pairs.map(([pid, name]) => ({ pid, name }));
}

describe("tasklist CSV parsing", () => {
  it("parses quoted Windows tasklist rows including memory commas", () => {
    const csv = [
      '"Image Name","PID","Session Name","Session#","Mem Usage"',
      '"Discord.exe","44552","Console","1","150,000 K"',
      '"chrome.exe","1001","Console","1","80,123 K"',
      '"Code.exe","2222","Console","1","200,000 K"',
    ].join("\r\n");
    assert.deepEqual(parseTasklistCsv(csv), [
      { pid: 44552, name: "Discord.exe" },
      { pid: 1001, name: "chrome.exe" },
      { pid: 2222, name: "Code.exe" },
    ]);
  });

  it("parses escaped quotes in CSV", () => {
    assert.deepEqual(parseCsvLine('"a""b",1'), ['a"b', "1"]);
  });
});

describe("WindowsProcessHost", () => {
  it("lists via tasklist and kills via taskkill /PID /F", async () => {
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const runner: CommandRunner = {
      async execFile(file, args) {
        calls.push({ file, args });
        if (file.endsWith("tasklist.exe")) {
          return {
            status: 0,
            stdout: '"Discord.exe","99","Console","1","1 K"\n',
            stderr: "",
          };
        }
        if (file.endsWith("taskkill.exe")) {
          return { status: 0, stdout: "SUCCESS", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: `unexpected ${file}` };
      },
    };
    const host = new WindowsProcessHost(runner);
    const listed = await host.list();
    assert.deepEqual(listed, [{ pid: 99, name: "Discord.exe" }]);
    await host.terminate(99);
    const kill = calls.find((c) => c.file.endsWith("taskkill.exe"));
    assert.ok(kill);
    assert.deepEqual(kill.args, ["/PID", "99", "/F"]);
  });

  it("falls back to PowerShell when tasklist fails", async () => {
    const runner: CommandRunner = {
      async execFile(file) {
        if (file.endsWith("tasklist.exe")) {
          return { status: 1, stdout: "", stderr: "tasklist exploded" };
        }
        if (file.toLowerCase().includes("powershell")) {
          return { status: 0, stdout: "42,Discord\n7,chrome\n", stderr: "" };
        }
        return { status: 1, stdout: "", stderr: "no" };
      },
    };
    const listed = await new WindowsProcessHost(runner).list();
    assert.deepEqual(listed, [
      { pid: 42, name: "Discord" },
      { pid: 7, name: "chrome" },
    ]);
  });

  it("treats taskkill not-found as success", async () => {
    const runner: CommandRunner = {
      async execFile() {
        return { status: 128, stdout: "", stderr: "The process ... not found." };
      },
    };
    await new WindowsProcessHost(runner).terminate(1234);
  });
});

describe("BlocklistTerminator safety invariant", () => {
  it("kills Discord and never kills allowlisted study processes in the same pass", async () => {
    const host = new MemoryProcessHost(
      procs(
        [10, "Discord.exe"],
        [11, "chrome.exe"],
        [12, "Code.exe"],
        [13, "firefox.exe"],
        [14, "msedge.exe"],
        [15, "WINWORD.EXE"],
        [16, "Notion.exe"],
      ),
    );
    const killer = new BlocklistTerminator({ host });
    const result = await killer.kill(["discord", "chrome", "code", "firefox"]);
    assert.deepEqual(host.killed, new Set([10]));
    assert.deepEqual(result.killed, [formatProc({ pid: 10, name: "Discord.exe" })]);
    assert.equal(result.errors.some((e) => /chrome/i.test(e) && /Refused/i.test(e)), true);
    assert.equal(result.errors.some((e) => /Code/i.test(e) && /Refused/i.test(e)), true);
    assert.equal(host.killed.has(11), false);
    assert.equal(host.killed.has(12), false);
  });

  it("hard-fails the invariant: every default study matcher is unlistable as a kill target", async () => {
    const seed = DEFAULT_STUDY_PROCESS_MATCHERS.flatMap((matcher, i) => {
      const name = fakeProcessName(matcher);
      return name ? [{ pid: 1000 + i, name }] : [];
    });
    const host = new MemoryProcessHost(seed);
    const killer = createProcessKiller({ host });
    for (const matcher of DEFAULT_STUDY_PROCESS_MATCHERS) {
      const result = await killer.kill([matcher]);
      assert.equal(
        result.killed.length,
        0,
        `allowlist matcher ${matcher} killed ${result.killed.join(", ")}`,
      );
      assert.equal(host.killed.size, 0, `host killed pids for ${matcher}`);
    }
  });

  it("refuses explorer and other critical processes even when asked", async () => {
    const host = new MemoryProcessHost(procs([8, "explorer.exe"], [9, "lsass.exe"]));
    const result = await new BlocklistTerminator({ host }).kill(["explorer", "lsass"]);
    assert.equal(result.killed.length, 0);
    assert.equal(host.killed.size, 0);
    assert.equal(result.errors.length >= 2, true);
  });

  it("refuses to kill this process pid even if the name matches", async () => {
    const host = new MemoryProcessHost([{ pid: process.pid, name: "fp_blockstandin.exe" }]);
    const result = await new BlocklistTerminator({ host }).kill(["fp_blockstandin"]);
    assert.equal(result.killed.length, 0);
    assert.equal(host.killed.size, 0);
    assert.equal(result.errors.some((e) => /self or system pid/i.test(e)), true);
  });

  it("returns a clear error when nothing matches", async () => {
    const host = new MemoryProcessHost(procs([1, "Discord.exe"]));
    const result = await new BlocklistTerminator({ host }).kill(["steam"]);
    assert.deepEqual(result.killed, []);
    // pid 1 is critical, but steam does not match Discord — no-match error.
    assert.equal(result.errors.some((e) => /No running processes matched/i.test(e)), true);
  });

  it("returns a clear error for empty matchers", async () => {
    const result = await new BlocklistTerminator({
      host: new MemoryProcessHost(procs([50, "Discord.exe"])),
    }).kill(["  ", ""]);
    assert.deepEqual(result, {
      killed: [],
      errors: ["No process matchers provided"],
    });
  });

  it("surfaces terminate failures without claiming a kill", async () => {
    const host = new MemoryProcessHost(procs([77, "Discord.exe"]));
    host.fail.set(77, "Access is denied.");
    const result = await new BlocklistTerminator({ host }).kill(["discord"]);
    assert.deepEqual(result.killed, []);
    assert.equal(host.killed.size, 0);
    assert.equal(
      result.errors.some((e) => /Failed to kill Discord\.exe \(pid 77\): Access is denied/i.test(e)),
      true,
    );
  });

  it("unions live allowlist matchers so a custom study app cannot be killed", async () => {
    const host = new MemoryProcessHost(procs([33, "obsidian.exe"], [44, "Discord.exe"]));
    const killer = new BlocklistTerminator({
      host,
      getAllowlistMatchers: () => ["obsidian", "obsidian.exe"],
    });
    const result = await killer.kill(["obsidian", "discord"]);
    assert.deepEqual(result.killed, [formatProc({ pid: 44, name: "Discord.exe" })]);
    assert.equal(host.killed.has(33), false);
    assert.equal(result.errors.some((e) => /obsidian/i.test(e) && /Refused/i.test(e)), true);
  });
});

function fakeProcessName(matcher: string): string | undefined {
  const trimmed = matcher.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return undefined;
  }
  if (trimmed.includes(".google.") || trimmed.endsWith(".com")) {
    return undefined;
  }
  return trimmed;
}
