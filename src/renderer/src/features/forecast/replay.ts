import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { Decision, DeskSnapshot, FocusSnapshot } from "@shared/ipc";
import {
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  FORECAST_PARAM_COUNT,
  FORECAST_FEATURE_KEYS,
  FORECAST_WARMUP_SEC,
  INITIAL_ESCALATION_STATE,
  TelemetryRing,
  attributions,
  effectiveFuseSec,
  extractFeatures,
  forward,
  parseForecastWeights,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
  type ForecastEvent,
  type ForecastSnapshot,
} from "@shared/forecast";
import weightsJson from "@shared/forecast/weights.json";

/**
 * Deterministic scripted replay — the demo beat as data. A raw behavior
 * stream (focus pokes + desk states, second by second) is pushed through the
 * SAME shared core the Electron main process runs: TelemetryRing →
 * extractFeatures → GLM forward → EMA → stepEscalation. Nothing here is
 * canned risk numbers; the model genuinely thinks on the scripted stream, so
 * the preview page and the mock console show real attributions, a real
 * calibration readout, and a real receipt. Same inputs ⇒ byte-identical
 * frames (no Date.now, no RNG beyond a seeded hash of `t`).
 *
 * Beat (≈2 min): warm-up → calm grind → a gentle grey-flicking ramp → NUDGE →
 * PRE-ARM → the student complies and the needle decays → PRE-ARM STOOD DOWN,
 * UNCONFIRMED (a false alarm, shown as loudly as a hit) → a harder, sustained
 * ramp with a fidgety desk signal → NUDGE → PRE-ARM → Discord → 5 s fuse (not
 * 10) → kill, receipt: HIT with real lead seconds → unlock → calm.
 *
 * The two ramps differ on purpose. The first is short and gentle and the
 * student backs off, so its pre-arm stands down unconfirmed — the demo shows
 * the model being WRONG before it shows it being right. The second is longer,
 * has almost no code time in it, and runs while the desk model turns restless;
 * it earns its pre-arm and collects the receipt.
 *
 * `nudge`/`prearm` in REPLAY_BEATS are ANNOTATIONS: they record when the
 * shipped model actually fires on this stream, they do not force it. A new
 * head moves them — that is the whole point of replaying through the real
 * model — so re-check with `npm run forecast:preview` after any swap.
 */

export const REPLAY_EPOCH = Date.UTC(2026, 0, 5, 9, 0, 0);
export const REPLAY_DURATION_SEC = 135;

/**
 * Scripted beats — seconds since session start. `warmup`, `calm`, `ramp`,
 * `comply`, `ramp2`, `drift`, `kill` and `recovered` DRIVE the script;
 * `nudge` and `prearm` are OBSERVED — the second the shipped head fires.
 */
export const REPLAY_BEATS = {
  warmup: 4,
  calm: 24,
  ramp: 30,
  nudge: 41,
  comply: 47,
  ramp2: 72,
  prearm: 97,
  drift: 112,
  kill: 117,
  recovered: 124,
} as const;

export interface ReplayFrame {
  /** Seconds since session start. */
  t: number;
  snapshot: ForecastSnapshot;
  events: ForecastEvent[];
  focus: FocusSnapshot;
  desk: DeskSnapshot;
  decision: Decision;
  countdownSec: number;
  detail: string;
}

export interface ForecastReplay {
  frames: ReplayFrame[];
  durationSec: number;
  startTs: number;
}

interface FocusPoke {
  offsetMs: number;
  processName: string;
  windowTitle: string;
  allow: boolean;
  block: boolean;
}

/** Deterministic 0..1 hash of an integer second — no RNG state. */
function jitter(t: number, salt = 0): number {
  const x = Math.sin(t * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

const CODE = { processName: "code", windowTitle: "forecast.ts — FocusPlug — Visual Studio Code", allow: true, block: false };
const DOCS = { processName: "chrome", windowTitle: "Essay draft — Google Docs", allow: true, block: false };
const SPOTIFY = { processName: "spotify", windowTitle: "Spotify — Daily Mix 4", allow: false, block: false };
const YOUTUBE = { processName: "chrome", windowTitle: "speedrun compilation — YouTube", allow: true, block: false };
const EXPLORER = { processName: "explorer", windowTitle: "Downloads", allow: false, block: false };
const DISCORD = { processName: "discord", windowTitle: "#general — Discord", allow: false, block: true };

function poke(app: typeof CODE, offsetMs: number, title?: string): FocusPoke {
  return {
    offsetMs,
    processName: app.processName,
    windowTitle: title ?? app.windowTitle,
    allow: app.allow,
    block: app.block,
  };
}

/**
 * The behavior stream for second `t`. Sub-second pokes model real 4 Hz
 * monitor cadence: fast alt-tabs land as multiple pokes inside one second.
 */
/** The HARD grey-flicking cycle of the second, ignored ramp: almost no code time. */
function flickCycle(t: number, from: number): FocusPoke[] {
  const phase = (t - from) % 7;
  if (phase === 0) {
    return [poke(CODE, 0), poke(SPOTIFY, 620)];
  }
  if (phase === 1 || phase === 2) {
    return [poke(SPOTIFY, 0, `Spotify — track ${t}`)];
  }
  if (phase === 3) {
    return [poke(YOUTUBE, 0, `video ${t} — YouTube`), poke(YOUTUBE, 520, `video ${t}b — YouTube`)];
  }
  if (phase === 4) {
    return [poke(SPOTIFY, 0), poke(EXPLORER, 550)];
  }
  if (phase === 5) {
    return [poke(YOUTUBE, 0, `video ${t}c — YouTube`), poke(SPOTIFY, 480)];
  }
  return [poke(EXPLORER, 0), poke(YOUTUBE, 600, `video ${t}d — YouTube`)];
}

/**
 * The FIRST ramp is deliberately gentler than the second: one grey loiter and
 * one tab flick per cycle, with real code time in between. It is the "caught
 * early" beat — enough to cross the nudge line, not enough to pre-arm.
 */
function softFlickCycle(t: number, from: number): FocusPoke[] {
  const phase = (t - from) % 5;
  if (phase === 0) {
    return [poke(CODE, 0), poke(SPOTIFY, 700)];
  }
  if (phase === 1) {
    return [poke(SPOTIFY, 0, `Spotify — track ${t}`)];
  }
  if (phase === 2) {
    return [poke(YOUTUBE, 0, `video ${t} — YouTube`)];
  }
  return [poke(CODE, 0, `forecast.ts:${140 + t} — FocusPlug — Visual Studio Code`)];
}

function scriptSecond(t: number): FocusPoke[] {
  const B = REPLAY_BEATS;
  // Calm grind: VS Code, an occasional Docs check, slow title changes.
  if (t < B.ramp) {
    if (t >= 26 && t < 30) {
      return [poke(DOCS, 0)];
    }
    const line = 120 + Math.floor(t / 8);
    return [poke(CODE, 0, `forecast.ts:${line} — FocusPlug — Visual Studio Code`)];
  }
  // First drift ramp: a gentler grey loiter + tab flick, with code time in
  // between — the pattern that should cross the nudge line and stop there.
  if (t < B.comply) {
    return softFlickCycle(t, B.ramp);
  }
  // Comply after the nudge: back to VS Code, heads down. Risk decays.
  if (t < B.ramp2) {
    return [poke(CODE, 0, "forecast.ts:161 — FocusPlug — Visual Studio Code")];
  }
  // Ignore the second warning: the same flicking signature, sustained, while
  // the desk signal turns fidgety (scriptDesk) — the pre-tab-out pattern.
  if (t < B.drift) {
    return flickCycle(t, B.ramp2);
  }
  // The drift: Discord until the kill lands.
  if (t < B.kill) {
    return [poke(DISCORD, 0)];
  }
  // Recovered: back on the assignment.
  return [poke(CODE, 0, "forecast.ts:204 — FocusPlug — Visual Studio Code")];
}

function scriptDesk(t: number, ts: number): DeskSnapshot {
  // Present throughout — this beat is a tab-out story, not a walk-away. In
  // the second, ignored ramp the presence signal turns fidgety (confidence
  // sag + wobble), the way the away_drifter archetype fidgets pre-drift.
  const restless = t >= REPLAY_BEATS.ramp2 && t < REPLAY_BEATS.kill;
  if (!restless) {
    return { ts, label: "at_desk", confidence: 0.9 + jitter(t, 3) * 0.06, webcamEnabled: true };
  }
  const confidence =
    t % 5 === 4
      ? 0.52 // brief sub-threshold dip — a presence flicker
      : 0.78 + 0.08 * Math.sin(t * 2.1);
  return { ts, label: "at_desk", confidence, webcamEnabled: true };
}

function decisionFor(focus: FocusSnapshot, countdownActive: boolean): Decision {
  if (focus.matchedBlock || countdownActive) {
    return "DISTRACTED";
  }
  if (focus.matchedAllow) {
    return "ON_TASK";
  }
  return "IDLE";
}

function detailFor(decision: Decision, focus: FocusSnapshot, countdownSec: number): string {
  if (decision === "DISTRACTED") {
    return countdownSec > 0 ? "Distracted: Discord" : "Kill window reached — Discord";
  }
  if (decision === "ON_TASK") {
    return `On task: ${focus.processName}`;
  }
  return `Unmatched app: ${focus.processName}`;
}

/**
 * Build the full deterministic frame sequence. `startTs` anchors wall-clock
 * timestamps (default: a fixed epoch, so tests and stills are byte-stable).
 */
export function buildForecastReplay(startTs = REPLAY_EPOCH): ForecastReplay {
  const weights = parseForecastWeights(weightsJson);
  if (weights === null) {
    throw new Error("forecast replay: committed weights.json failed validation");
  }
  const settings: EscalationSettings = {
    nudgeRisk: DEFAULT_SETTINGS.forecastNudgeRisk,
    prearmRisk: DEFAULT_SETTINGS.forecastPrearmRisk,
    prearmEnabled: DEFAULT_SETTINGS.forecastPrearmEnabled,
    prearmFuseSec: DEFAULT_SETTINGS.forecastPrearmFuseSec,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };

  const ring = new TelemetryRing(startTs);
  ring.reset(startTs);
  let esc: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  let countdownSec = 0;
  let countdownActive = false;
  let killed = false;

  const frames: ReplayFrame[] = [];
  let lastFocus: FocusSnapshot = { ts: startTs, ...CODE, matchedAllow: true, matchedBlock: false };

  for (let t = 0; t < REPLAY_DURATION_SEC; t += 1) {
    const ts = startTs + (t + 1) * 1000;

    // 1. Feed the second's behavior stream into the ring.
    for (const p of scriptSecond(t)) {
      const focusSnap: FocusSnapshot = {
        ts: startTs + t * 1000 + p.offsetMs,
        processName: p.processName,
        windowTitle: p.windowTitle,
        matchedAllow: p.allow,
        matchedBlock: p.block,
      };
      ring.noteFocus(focusSnap);
      lastFocus = focusSnap;
    }
    const desk = scriptDesk(t, ts);
    ring.noteDesk(desk, DEFAULT_SETTINGS.deskThreshold);

    // 2. Policy signal + countdown bookkeeping for this tick (scripted
    //    stand-in for the tapped policy events).
    let policySignal: "start_countdown" | "cancel_countdown" | "kill" | "unlock" | null = null;
    if (t === REPLAY_BEATS.drift) {
      policySignal = "start_countdown";
    } else if (t === REPLAY_BEATS.kill && !killed) {
      policySignal = "kill";
      killed = true;
    } else if (t === REPLAY_BEATS.kill + 2) {
      policySignal = "unlock";
    }

    const decision = decisionFor(lastFocus, countdownActive);
    ring.noteStatus(decision);

    // 3. Close the 1 Hz frame and run the real model.
    ring.commit(ts);
    const extraction = extractFeatures(ring, ts);
    const fwd = forward(weights, extraction.values);
    const attr = attributions(weights, extraction.values);
    smoothed = smoothRisk(smoothed, fwd.rawRisk);
    const ready = t + 1 >= FORECAST_WARMUP_SEC;

    // 4. Escalate exactly the way the monitor does.
    const stepped = stepEscalation(esc, {
      ts,
      risk: smoothed,
      ready,
      decision,
      countdownActive,
      policySignal,
      settings,
    });
    esc = stepped.state;
    const events: ForecastEvent[] = ready
      ? stepped.events.map((event) =>
          event.type === "forecast_nudge"
            ? {
                ...event,
                topFeatures: FORECAST_FEATURE_KEYS
                  .map((key, index) => ({ key, attribution: attr[index] ?? 0 }))
                  .filter((entry) => entry.attribution > 0)
                  .sort((a, b) => b.attribution - a.attribution)
                  .slice(0, 3)
                  .map((entry) => entry.key),
              }
            : event,
        )
      : [];

    // 5. Countdown burn — starts at the latched fuse, reaches 0 at the kill.
    if (policySignal === "start_countdown") {
      countdownActive = true;
      countdownSec = esc.latchedFuseSec ?? settings.baseFuseSec;
    } else if (countdownActive && countdownSec > 0) {
      countdownSec -= 1;
    }
    if (policySignal === "kill" || policySignal === "unlock") {
      countdownActive = false;
      countdownSec = 0;
    }

    // 6. Snapshot — field-for-field what the monitor publishes.
    const fuse = effectiveFuseSec(esc, settings);
    const snapshot: ForecastSnapshot = {
      ts,
      ready,
      warmupRemainingSec: ready ? 0 : FORECAST_WARMUP_SEC - (t + 1),
      risk: smoothed,
      rawRisk: fwd.rawRisk,
      logit: fwd.logit,
      band: esc.band,
      horizonSec: FORECAST_HORIZON_SEC,
      features: FORECAST_FEATURE_KEYS.map((key, index) => ({
        key,
        raw: extraction.raw[key],
        value: extraction.values[index] ?? 0,
        attribution: attr[index] ?? 0,
      })),
      hidden: [...fwd.hidden],
      prearmedAt: esc.prearmedAt,
      effectiveFuseSec: fuse ?? settings.baseFuseSec,
      baseFuseSec: settings.baseFuseSec,
      modelVersion: FORECAST_MODEL_VERSION,
      paramCount: FORECAST_PARAM_COUNT,
    };

    frames.push({
      t: t + 1,
      snapshot,
      events,
      focus: lastFocus,
      desk,
      decision,
      countdownSec,
      detail: detailFor(decision, lastFocus, countdownSec),
    });
  }

  return { frames, durationSec: REPLAY_DURATION_SEC, startTs };
}

/** Risk history for the sparkline: frames up to (and including) index. */
export function replayHistory(
  replay: ForecastReplay,
  index: number,
): { ts: number; risk: number }[] {
  return replay.frames
    .slice(0, Math.max(0, Math.min(index + 1, replay.frames.length)))
    .map((frame) => ({ ts: frame.snapshot.ts, risk: frame.snapshot.risk }));
}

/** All forecast events emitted up to (and including) index, oldest first. */
export function replayEvents(replay: ForecastReplay, index: number): ForecastEvent[] {
  const out: ForecastEvent[] = [];
  for (const frame of replay.frames.slice(0, Math.max(0, Math.min(index + 1, replay.frames.length)))) {
    out.push(...frame.events);
  }
  return out;
}
