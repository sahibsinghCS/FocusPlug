import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "../../shared/defaults.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SimulatedForegroundReader } from "./foreground.ts";
import { createWindowMonitor } from "./index.ts";
import { FocusWindowMonitor } from "./monitor.ts";
import type { FocusSnapshot } from "../../shared/types.ts";

async function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return Date.now() - started;
    }
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  throw new Error(`${label} not met within ${timeoutMs}ms`);
}

describe("FocusWindowMonitor gauntlet", () => {
  let monitor: FocusWindowMonitor | undefined;

  afterEach(() => {
    monitor?.stop();
  });

  test("Discord-like focus → matchedBlock within 1s; Chrome/Docs → matchedAllow within 1s", async () => {
    const reader = new SimulatedForegroundReader({
      processName: "explorer",
      windowTitle: "Desktop",
    });
    const snapshots: FocusSnapshot[] = [];
    monitor = new FocusWindowMonitor({
      reader,
      loadAllowlist: () => DEFAULT_ALLOWLIST,
      loadBlocklist: () => DEFAULT_BLOCKLIST,
    });
    monitor.start((snap) => {
      snapshots.push(snap);
    });

    reader.set({ processName: "Discord", windowTitle: "Friends - Discord" });
    const blockLatency = await waitUntil(
      () => snapshots.some((snap) => snap.matchedBlock === true && snap.blockEntryId === "discord"),
      1000,
      "matchedBlock for Discord-like window",
    );
    const blocked = snapshots.find((snap) => snap.matchedBlock);
    assert.ok(blocked);
    assert.equal(blocked.matchedAllow, false);
    assert.ok(blockLatency < 1000);

    snapshots.length = 0;
    reader.set({
      processName: "chrome",
      windowTitle: "Essay - Google Docs - Google Chrome",
    });
    const allowLatency = await waitUntil(
      () => snapshots.some((snap) => snap.matchedAllow === true && snap.matchedBlock === false),
      1000,
      "matchedAllow for Chrome/Docs window",
    );
    const allowed = snapshots.find((snap) => snap.matchedAllow && !snap.matchedBlock);
    assert.ok(allowed);
    assert.equal(allowed.processName, "chrome");
    assert.ok(allowLatency < 1000);
  });

  test("store-backed monitor picks up list edits on the next poll", async () => {
    const reader = new SimulatedForegroundReader({
      processName: "chrome",
      windowTitle: "Essay - Google Docs - Google Chrome",
    });
    const created = createWindowMonitor({
      userDataDir: mkdtempSync(join(tmpdir(), "focusplug-mon-")),
      reader,
    });
    monitor = created.monitor;
    const snapshots: FocusSnapshot[] = [];
    monitor.start((snap) => {
      snapshots.push(snap);
    });
    await waitUntil(
      () => snapshots.some((snap) => snap.matchedAllow === true),
      1000,
      "initial Chrome/Docs allow match",
    );
    created.store.saveAllowlist([]);
    created.store.saveBlocklist([]);
    snapshots.length = 0;
    const clearedMs = await waitUntil(
      () =>
        snapshots.some(
          (snap) =>
            snap.processName === "chrome" &&
            snap.matchedAllow === false &&
            snap.matchedBlock === false,
        ),
      1000,
      "allow/block cleared after store save",
    );
    assert.ok(clearedMs < 1000);
  });

  test("stop() ends callbacks", async () => {
    const reader = new SimulatedForegroundReader({
      processName: "Discord",
      windowTitle: "Discord",
    });
    let count = 0;
    monitor = new FocusWindowMonitor({
      reader,
      loadAllowlist: () => DEFAULT_ALLOWLIST,
      loadBlocklist: () => DEFAULT_BLOCKLIST,
      intervalMs: 40,
    });
    monitor.start(() => {
      count += 1;
    });
    await waitUntil(() => count > 0, 1000, "first snapshot");
    monitor.stop();
    const frozen = count;
    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(count, frozen);
  });
});
