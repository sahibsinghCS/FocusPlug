/**
 * Gauntlet probe (no Electron required).
 *
 *   node --experimental-strip-types src/main/window/probe.ts
 *
 * Bar: Discord-like title/process → matchedBlock within 1s;
 *      Chrome/Docs → matchedAllow within 1s; lists persist via store seam.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "../../shared/defaults.ts";
import { createListsStore } from "../store/index.ts";
import { SimulatedForegroundReader } from "./foreground.ts";
import { createWindowMonitor } from "./index.ts";
import type { FocusSnapshot } from "../../shared/types.ts";

const BAR_MS = 1000;

async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  label: string,
): Promise<number> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return Date.now() - started;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`FAIL ${label} within ${timeoutMs}ms`);
}

function line(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function main(): Promise<void> {
  line("=== FocusPlug window-monitor gauntlet probe ===");
  const userDataDir = mkdtempSync(join(tmpdir(), "focusplug-probe-"));
  const reader = new SimulatedForegroundReader({
    processName: "explorer",
    windowTitle: "Desktop",
  });
  const { monitor, store } = createWindowMonitor({
    userDataDir,
    reader,
  });

  const snapshots: FocusSnapshot[] = [];
  monitor.start((snap) => {
    snapshots.push(snap);
  });

  line("");
  line("[1] Discord-like title/process");
  reader.set({ processName: "Discord", windowTitle: "Friends - Discord" });
  const blockMs = await waitFor(
    () => snapshots.some((s) => s.matchedBlock && s.blockEntryId === "discord"),
    BAR_MS,
    "matchedBlock===true",
  );
  const blocked = snapshots.find((s) => s.matchedBlock);
  line(`    processName=${blocked?.processName} windowTitle=${blocked?.windowTitle}`);
  line(
    `    matchedBlock=${blocked?.matchedBlock} blockEntryId=${blocked?.blockEntryId} matchedAllow=${blocked?.matchedAllow}`,
  );
  line(`    latencyMs=${blockMs} (bar: ${BAR_MS})`);
  line("    PASS");

  snapshots.length = 0;
  line("");
  line("[2] Chrome / Google Docs");
  reader.set({
    processName: "chrome",
    windowTitle: "Essay - Google Docs - Google Chrome",
  });
  const allowMs = await waitFor(
    () => snapshots.some((s) => s.matchedAllow && !s.matchedBlock),
    BAR_MS,
    "matchedAllow===true",
  );
  const allowed = snapshots.find((s) => s.matchedAllow && !s.matchedBlock);
  line(`    processName=${allowed?.processName} windowTitle=${allowed?.windowTitle}`);
  line(`    matchedAllow=${allowed?.matchedAllow} matchedBlock=${allowed?.matchedBlock}`);
  line(`    latencyMs=${allowMs} (bar: ${BAR_MS})`);
  line("    PASS");

  monitor.stop();

  line("");
  line("[3] Store seam persist (allowlist/blocklist JSON in userData)");
  store.saveAllowlist(DEFAULT_ALLOWLIST);
  store.saveBlocklist(DEFAULT_BLOCKLIST);
  const reloaded = createListsStore(userDataDir);
  const allowIds = reloaded.loadAllowlist().map((e) => e.id);
  const blockIds = reloaded.loadBlocklist().map((e) => e.id);
  if (!allowIds.includes("chrome") || !allowIds.includes("google-docs")) {
    throw new Error("allowlist did not persist chrome/google-docs");
  }
  if (!blockIds.includes("discord")) {
    throw new Error("blocklist did not persist discord");
  }
  line(`    dir=${userDataDir}`);
  line(`    allowlist ids=${allowIds.join(",")}`);
  line(`    blocklist ids=${blockIds.join(",")}`);
  line("    PASS");

  line("");
  line("=== GAUNTLET RESULT: PASS ===");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.stderr.write("=== GAUNTLET RESULT: FAIL ===\n");
  process.exitCode = 1;
});
