import type { DeskSnapshot, FocusSnapshot } from "@shared/ipc";

/**
 * Mode 1's scripted student — the only fabricated thing in the demo.
 *
 * This file emits a raw BEHAVIOR stream (sub-second window pokes + a desk
 * label per second), never features and never risk numbers. Everything
 * downstream of it is the shipped code: the ring coalesces the pokes, the
 * shared extractor turns them into the 24 features, the trained GLM scores
 * them, and `stepPolicy` decides. Change a beat here and the risk curve moves
 * because the model re-reads it — there is no place to put a fake number.
 *
 * The arc, second by second (80 s at 1x):
 *   writing in Docs → tab flicking + grey loiter → NUDGE → comply, risk
 *   decays → harder flicking + desk fidget → PRE-ARM (fuse 10 s → 5 s) →
 *   Discord → 5 s fuse → kill → back to Docs → unlock.
 */

/** Fixed epoch so Mode 1 frames are byte-identical on every run. */
export const DEMO_EPOCH = Date.UTC(2026, 8, 13, 20, 0, 0);

export const DEMO_DURATION_SEC = 80;

/** Scripted beats, in seconds since session start. */
export const DEMO_BEATS = {
  /** Meter unlocks (FORECAST_WARMUP_SEC). */
  ready: 15,
  /** Tab flicking starts. */
  ramp: 21,
  /** Back to the assignment after the nudge. */
  comply: 41,
  /** Flicking resumes, faster, with a fidgety desk signal. */
  ramp2: 50,
  /** Discord takes focus — the policy violation. */
  discord: 66,
  /** Back on the assignment after the kill. */
  recover: 73,
} as const;

interface AppDef {
  processName: string;
  windowTitle: string;
  matchedAllow: boolean;
  matchedBlock: boolean;
}

const DOCS: AppDef = {
  processName: "chrome",
  windowTitle: "Unit 4 essay — Google Docs",
  matchedAllow: true,
  matchedBlock: false,
};
const YOUTUBE: AppDef = {
  processName: "chrome",
  windowTitle: "mix — YouTube",
  matchedAllow: true,
  matchedBlock: false,
};
const REDDIT: AppDef = {
  processName: "chrome",
  windowTitle: "r/all — reddit",
  matchedAllow: true,
  matchedBlock: false,
};
const SPOTIFY: AppDef = {
  processName: "spotify",
  windowTitle: "Spotify — Daily Mix 4",
  matchedAllow: false,
  matchedBlock: false,
};
const EXPLORER: AppDef = {
  processName: "explorer",
  windowTitle: "Downloads",
  matchedAllow: false,
  matchedBlock: false,
};
const DISCORD: AppDef = {
  processName: "discord",
  windowTitle: "#general — Discord",
  matchedAllow: false,
  matchedBlock: true,
};

interface Poke {
  app: AppDef;
  offsetMs: number;
  title?: string;
}

function poke(app: AppDef, offsetMs: number, title?: string): Poke {
  return { app, offsetMs, title };
}

/**
 * The flicking signature: a Docs stop, a couple of Chrome tab flips (same
 * process, new titles — the title-churn features), and a grey-app loiter.
 * `heat` 0 is the first, hesitant ramp; `heat` 1 is the sustained one.
 */
function flickCycle(t: number, from: number, heat: 0 | 1): Poke[] {
  const phase = (t - from) % 6;
  if (heat === 0) {
    // Hesitant: still coming back to the document once a cycle.
    if (phase === 0) return [poke(DOCS, 0, "Unit 4 essay (441 words) — Google Docs")];
    if (phase === 1) return [poke(YOUTUBE, 120, `mix ${t} — YouTube`)];
    if (phase === 2) return [poke(SPOTIFY, 60)];
    if (phase === 3) return [poke(YOUTUBE, 0, `mix ${t}b — YouTube`)];
    if (phase === 4) return [poke(SPOTIFY, 240)];
    return [poke(REDDIT, 80, `r/all ${t} — reddit`)];
  }
  // Sustained: the document never comes back, two pokes a second.
  if (phase === 0) return [poke(YOUTUBE, 0, `mix ${t} — YouTube`), poke(REDDIT, 480, `r/all ${t} — reddit`)];
  if (phase === 1) return [poke(SPOTIFY, 40)];
  if (phase === 2) return [poke(YOUTUBE, 0, `queue ${t} — YouTube`)];
  // A token return to the document — enough that the needle is reading a
  // pattern, not a hard "left the allowlist" switch.
  if (phase === 3) return [poke(DOCS, 0, "Unit 4 essay (441 words) — Google Docs"), poke(EXPLORER, 560)];
  if (phase === 4) return [poke(REDDIT, 60, `r/${t} — reddit`)];
  return [poke(SPOTIFY, 0), poke(YOUTUBE, 600, `mix ${t}c — YouTube`)];
}

/** The behavior stream for second `t` (0-based), oldest poke first. */
export function scriptSecond(t: number): Poke[] {
  const B = DEMO_BEATS;
  if (t < B.ramp) {
    // Writing: one long Docs dwell, the title creeping as the draft grows.
    const words = 380 + Math.floor(t / 4) * 7;
    return [poke(DOCS, 0, `Unit 4 essay (${words} words) — Google Docs`)];
  }
  if (t < B.comply) {
    return flickCycle(t, B.ramp, 0);
  }
  if (t < B.ramp2) {
    // Complied with the nudge: heads down in the assignment again.
    return [poke(DOCS, 0, "Unit 4 essay (441 words) — Google Docs")];
  }
  if (t < B.discord) {
    return flickCycle(t, B.ramp2, 1);
  }
  if (t < B.recover) {
    return [poke(DISCORD, 0)];
  }
  return [poke(DOCS, 0, "Unit 4 essay (441 words) — Google Docs")];
}

/** Deterministic 0..1 hash of a second — no RNG state, no Date.now. */
function jitter(t: number, salt = 0): number {
  const x = Math.sin(t * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Desk presence for second `t`. Present throughout — this is a tab-out story,
 * not a walk-away — but the confidence turns fidgety during the second ramp,
 * the way the away_drifter archetype fidgets before it leaves.
 */
export function scriptDesk(t: number, ts: number): DeskSnapshot {
  const restless = t >= DEMO_BEATS.ramp2 && t < DEMO_BEATS.recover;
  if (!restless) {
    return {
      ts,
      label: "at_desk",
      confidence: 0.9 + jitter(t, 3) * 0.06,
      webcamEnabled: true,
    };
  }
  return {
    ts,
    label: "at_desk",
    // A sub-threshold dip every 5th second reads as a presence flicker.
    confidence: t % 5 === 4 ? 0.55 : 0.74 + 0.08 * Math.sin(t * 2.1),
    webcamEnabled: true,
  };
}

/** Focus snapshots for second `t`, timestamped inside that second. */
export function scriptFocus(t: number, startTs: number): FocusSnapshot[] {
  return scriptSecond(t).map((item) => ({
    ts: startTs + t * 1000 + item.offsetMs,
    processName: item.app.processName,
    windowTitle: item.title ?? item.app.windowTitle,
    matchedAllow: item.app.matchedAllow,
    matchedBlock: item.app.matchedBlock,
    ...(item.app.matchedBlock ? { blockEntryId: "discord" } : {}),
  }));
}
