/**
 * Golden-path probe — production wiring, real OS, no Electron and no GUI.
 *
 *   npm run probe:golden
 *
 * `createSessionRuntime` is what `src/main/index.ts` boots: the platform
 * foreground reader, the JSON store, `PolicyEngine`, and `BlocklistTerminator`.
 * This drives that live and asserts the chain reaches **On task** for the
 * window you have focused right now.
 *
 * Safety: the allowlist is built from the focused window and the blocklist is a
 * name that matches nothing, so the probe cannot terminate any real process. It
 * never opens the webcam (`webcamEnabled: false`).
 *
 * Run it on the demo machine before filming. Every workstream was judged on
 * Linux against simulated readers, which is how a dead Win32 window sensor
 * shipped green; this probe fails loudly in that case.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppStore } from "../store/appStore.ts";
import { createPlatformForegroundReader } from "../window/index.ts";
import { createSessionRuntime } from "./runtime.ts";
import { DEFAULT_FACE_ID } from "../../shared/faces.ts";
import type { SessionState } from "../../shared/ipc.ts";
import type { FocusSnapshot, PolicyEvent } from "../../shared/types.ts";

const SETTLE_MS = 3000;
const READER_TIMEOUT_MS = 8000;

function line(message: string): void {
  process.stdout.write(`${message}\n`);
}

async function readLiveForeground(): Promise<{ processName: string; windowTitle: string }> {
  const reader = createPlatformForegroundReader();
  reader.start?.();
  try {
    const deadline = Date.now() + READER_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const window = await reader.read();
      if (window && window.processName.trim().length > 0) {
        return { processName: window.processName, windowTitle: window.windowTitle };
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } finally {
    reader.stop?.();
  }
  return { processName: "", windowTitle: "" };
}

async function main(): Promise<void> {
  line("=== FocusPlug golden-path probe (real wiring, live window) ===");
  line("");

  const focused = await readLiveForeground();
  line(`[1] Foreground reader`);
  line(`    process=${focused.processName || "(none)"} title=${focused.windowTitle || "(none)"}`);
  if (!focused.processName) {
    throw new Error(
      `no process name after ${READER_TIMEOUT_MS}ms — the window sensor is dead on this machine ` +
        `(on win32 check src/main/window/win32.ts; other platforms use EmptyForegroundReader)`,
    );
  }
  line("    PASS");

  const userDataDir = mkdtempSync(join(tmpdir(), "focusplug-golden-"));
  const store = createAppStore(userDataDir);
  store.saveAllowlist([
    {
      id: "study",
      name: `Study app (${focused.processName})`,
      match: [focused.processName],
      enabled: true,
    },
  ]);
  // Deliberately unmatchable: this probe must never terminate a real process.
  store.saveBlocklist([
    { id: "none", name: "no real target", match: ["fp_probe_never_matches"], enabled: true },
  ]);
  store.saveSettings({
    countdownSec: 3,
    deskThreshold: 0.6,
    strictMode: false, // window path only — Desk AI has npm run test:desk
    webcamEnabled: false,
    deskModelId: "stub",
    faceId: DEFAULT_FACE_ID,
    plugs: [],
  });

  const states: SessionState[] = [];
  const events: PolicyEvent[] = [];
  const focus: FocusSnapshot[] = [];
  const session = createSessionRuntime({
    userDataDir,
    push: {
      sessionState: (state) => states.push(state),
      policyEvent: (event) => events.push(event),
      focusSnapshot: (snap) => focus.push(snap),
      deskSnapshot: () => undefined,
      sessionEvent: () => undefined,
    },
  });

  line("");
  line("[2] Live session (allowlist = the focused window, blocklist = nothing real)");
  await session.start();
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  const state = session.getState();
  await session.stop();

  const matched = focus.filter((snap) => snap.matchedAllow).length;
  const kills = events.filter((event) => event.type === "kill");
  line(`    focusSnapshots=${focus.length} matchedAllow=${matched} stateUpdates=${states.length}`);
  line(`    decision=${state.decision} detail="${state.detail}"`);
  line(`    kill events=${kills.length}`);

  if (matched === 0) {
    throw new Error("reader produced snapshots but none matched the allowlist");
  }
  if (state.decision !== "ON_TASK") {
    throw new Error(`expected ON_TASK, got ${state.decision} (${state.detail})`);
  }
  if (kills.length > 0) {
    throw new Error(`probe must never kill, but emitted ${kills.length} kill event(s)`);
  }
  line("    PASS");

  line("");
  line("=== GOLDEN PATH PROBE: PASS ===");
  line("Sensor, list matching, and policy are live on this machine.");
  line("Kill itself: npm run test:kill · Desk AI: npm run test:desk");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.stderr.write("=== GOLDEN PATH PROBE: FAIL ===\n");
  process.exitCode = 1;
});
