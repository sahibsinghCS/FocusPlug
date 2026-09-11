import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createPlatformHost } from "./hosts";
import { BlocklistTerminator } from "./terminator";

interface Sleeper {
  source: string;
  args: string[];
}

function sleeper(): Sleeper | undefined {
  if (process.platform === "win32") {
    const timeout = join(
      process.env["SystemRoot"] ?? "C:\\Windows",
      "System32",
      "timeout.exe",
    );
    if (existsSync(timeout)) {
      return { source: timeout, args: ["/T", "45", "/NOBREAK"] };
    }
    return undefined;
  }
  for (const candidate of ["/bin/sleep", "/usr/bin/sleep"]) {
    if (existsSync(candidate)) {
      return { source: candidate, args: ["45"] };
    }
  }
  return undefined;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  label: string,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function spawnStandin(binary: string, args: string[]): ChildProcess {
  const child = spawn(binary, args, {
    stdio: "ignore",
    detached: false,
    windowsHide: true,
  });
  if (child.pid === undefined) {
    throw new Error(`Failed to spawn stand-in ${binary}`);
  }
  return child;
}

function stopChild(child: ChildProcess | undefined): void {
  if (!child?.pid) {
    return;
  }
  try {
    process.kill(child.pid, "SIGKILL");
  } catch {
    // already gone
  }
}

describe("live OS probe (harmless stand-in)", () => {
  it("starts a blocklist stand-in, kills via ProcessKiller.kill, and verifies exit", async (t) => {
    const bin = sleeper();
    if (!bin) {
      t.skip("no sleeper binary available for stand-in");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "focusplug-kill-"));
    const standin = join(
      dir,
      process.platform === "win32" ? "fp_blockstandin.exe" : "fp_blockstandin",
    );
    copyFileSync(bin.source, standin);
    chmodSync(standin, 0o755);
    let child: ChildProcess | undefined;
    t.after(() => {
      stopChild(child);
      rmSync(dir, { recursive: true, force: true });
    });

    child = spawnStandin(standin, bin.args);
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error("stand-in pid missing");
    }
    await waitUntil(() => isAlive(pid), 3000, "stand-in start");

    const host = createPlatformHost();
    const listed = await host.list();
    assert.equal(
      listed.some((proc) => proc.pid === pid && /fp_blockstandin/i.test(proc.name)),
      true,
      `stand-in pid ${pid} not listed (saw ${
        listed
          .filter((proc) => proc.pid === pid)
          .map((proc) => proc.name)
          .join(", ") || "no row"
      })`,
    );

    const killer = new BlocklistTerminator({ host });
    const result = await killer.kill(["fp_blockstandin"]);
    assert.equal(
      result.killed.some((row) => row.includes(String(pid))),
      true,
      `expected kill of pid ${pid}, got ${JSON.stringify(result)}`,
    );
    await waitUntil(() => !isAlive(pid), 3000, "stand-in exit after kill");
    assert.equal(isAlive(pid), false);
  });

  it("refuses to kill an allowlisted chrome stand-in (still running after kill())", async (t) => {
    const bin = sleeper();
    if (!bin) {
      t.skip("no sleeper binary available for stand-in");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "focusplug-kill-allow-"));
    const standin = join(dir, process.platform === "win32" ? "chrome.exe" : "chrome");
    copyFileSync(bin.source, standin);
    chmodSync(standin, 0o755);
    let child: ChildProcess | undefined;
    t.after(() => {
      stopChild(child);
      rmSync(dir, { recursive: true, force: true });
    });

    child = spawnStandin(standin, bin.args);
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error("chrome stand-in pid missing");
    }
    await waitUntil(() => isAlive(pid), 3000, "chrome stand-in start");

    const killer = new BlocklistTerminator({ host: createPlatformHost() });
    const result = await killer.kill(["chrome", "chrome.exe"]);
    assert.equal(
      result.killed.length,
      0,
      `allowlist stand-in was killed: ${result.killed.join(", ")}`,
    );
    assert.equal(
      result.errors.some((err) =>
        /Refused to kill allowlisted\/protected process/i.test(err),
      ),
      true,
      `expected refuse error, got ${JSON.stringify(result)}`,
    );
    assert.equal(isAlive(pid), true, "chrome stand-in must still be running");
  });

  it("kills a Discord-named stand-in the same way blocklist matchers will", async (t) => {
    const bin = sleeper();
    if (!bin) {
      t.skip("no sleeper binary available for stand-in");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "focusplug-kill-discord-"));
    const standin = join(dir, process.platform === "win32" ? "Discord.exe" : "Discord");
    copyFileSync(bin.source, standin);
    chmodSync(standin, 0o755);
    let child: ChildProcess | undefined;
    t.after(() => {
      stopChild(child);
      rmSync(dir, { recursive: true, force: true });
    });

    child = spawnStandin(standin, bin.args);
    const pid = child.pid;
    if (pid === undefined) {
      throw new Error("Discord stand-in pid missing");
    }
    await waitUntil(() => isAlive(pid), 3000, "Discord stand-in start");

    const killer = new BlocklistTerminator({ host: createPlatformHost() });
    const result = await killer.kill(["discord", "discord.exe"]);
    assert.equal(
      result.killed.some((row) => row.includes(String(pid))),
      true,
      `expected Discord stand-in kill, got ${JSON.stringify(result)}`,
    );
    await waitUntil(() => !isAlive(pid), 3000, "Discord stand-in exit");
    assert.equal(isAlive(pid), false);
  });
});
