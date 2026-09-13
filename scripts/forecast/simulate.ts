import { createWriteStream, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeskLabel } from "../../src/shared/types";
import {
  RAW_SESSIONS_FILE,
  boolFlag,
  deriveSeed,
  forecastDataRoot,
  gaussian,
  mulberry32,
  numberArg,
  stringArg,
  type RawDeskEvent,
  type RawFocusEvent,
  type RawSession,
} from "./lib";

/**
 * Synthetic-session simulator — emits 22–40 min sessions as RAW behavior
 * streams (sub-second focus transitions incl. title flips + multi-Hz desk
 * states). Features are never generated directly: the dataset builder replays
 * these streams through the shared ring + extractor, so the extractor stays
 * the single source of truth and label leakage is structurally impossible.
 *
 * Drifts are caused, not scripted: a per-second hazard rate reads the
 * generator's OWN recent behavior (leaky switch rate, grey occupancy, sag
 * ramps), so precursors precede drift onsets the way they do in life —
 * typically by 20–90 s. Two archetypes exist to keep the model honest:
 *
 * - research_churn: heavy switching + title churn entirely INSIDE the
 *   allowlist, zero drifts — kills any "switching ⇒ risk" if-else.
 * - steady_then_snap: hazard uncoupled from behavior — near-zero-warning
 *   drifts that keep recall < 100% and lead-time claims honest.
 *
 * Deterministic under --seed (per-session sub-seeds derived by FNV-1a).
 *
 *   tsx scripts/forecast/simulate.ts --sessions 240 --seed 42
 */

export const ARCHETYPES = [
  "grinder",
  "wanderer",
  "burst_switcher",
  "away_drifter",
  "research_churn",
  "steady_then_snap",
] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const DEFAULT_WEIGHTS: Record<Archetype, number> = {
  grinder: 0.2,
  wanderer: 0.2,
  burst_switcher: 0.2,
  away_drifter: 0.15,
  research_churn: 0.15,
  steady_then_snap: 0.1,
};

export interface SimConfig {
  sessions: number;
  seed: number;
  minMinutes: number;
  maxMinutes: number;
  deskHz: number;
  hazardScale: number;
  deskNoise: number;
  greyVocab: number;
  webcamOffProb: number;
  dropoutProb: number;
  dwellJitter: number;
  weights: Record<Archetype, number>;
  out: string;
}

function readWeights(raw: string): Record<Archetype, number> {
  const weights = { ...DEFAULT_WEIGHTS };
  if (!raw) {
    return weights;
  }
  for (const part of raw.split(",")) {
    const [name, value] = part.split("=");
    const parsed = Number(value);
    if (name && (ARCHETYPES as readonly string[]).includes(name) && Number.isFinite(parsed)) {
      weights[name as Archetype] = Math.max(0, parsed);
    }
  }
  return weights;
}

export function readConfig(): SimConfig {
  return {
    sessions: Math.max(1, Math.round(numberArg("--sessions", 240))),
    seed: numberArg("--seed", 42),
    minMinutes: numberArg("--minutes-min", 22),
    maxMinutes: numberArg("--minutes-max", 40),
    deskHz: Math.max(1, Math.round(numberArg("--desk-hz", 2))),
    hazardScale: numberArg("--hazard", 1),
    deskNoise: numberArg("--desk-noise", 0.05),
    greyVocab: Math.max(2, Math.round(numberArg("--grey-vocab", 5))),
    webcamOffProb: numberArg("--webcam-off", 0.08),
    dropoutProb: numberArg("--dropout", 0.01),
    dwellJitter: numberArg("--dwell-jitter", 1),
    weights: readWeights(stringArg("--weights", "")),
    out: stringArg("--out", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
  };
}

// ---------------------------------------------------------------------------
// App vocabulary — allow / grey / block, with per-app title pools
// ---------------------------------------------------------------------------

interface SimApp {
  proc: string;
  kind: "allow" | "grey" | "block";
  titles: string[];
}

function titlePool(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix} — ${i + 1}`);
}

const ALLOW_APPS: SimApp[] = [
  { proc: "code", kind: "allow", titles: titlePool("main.ts — focusplug — Visual Studio Code", 10) },
  { proc: "chrome", kind: "allow", titles: titlePool("Assignment notes — Google Docs", 24) },
  { proc: "notion", kind: "allow", titles: titlePool("Course workspace — Notion", 8) },
  { proc: "winword", kind: "allow", titles: titlePool("essay-draft.docx — Word", 6) },
];

const GREY_POOL: SimApp[] = [
  { proc: "spotify", kind: "grey", titles: titlePool("Spotify", 12) },
  { proc: "slack", kind: "grey", titles: titlePool("#general — Slack", 10) },
  { proc: "explorer", kind: "grey", titles: titlePool("Downloads — File Explorer", 6) },
  { proc: "photos", kind: "grey", titles: titlePool("Photos", 5) },
  { proc: "mail", kind: "grey", titles: titlePool("Inbox — Mail", 8) },
  { proc: "settings", kind: "grey", titles: titlePool("Settings", 4) },
  { proc: "calculator", kind: "grey", titles: titlePool("Calculator", 2) },
];

const BLOCK_APPS: SimApp[] = [
  { proc: "discord", kind: "block", titles: titlePool("#memes — Discord", 8) },
  { proc: "steam", kind: "block", titles: titlePool("Store — Steam", 5) },
];

// ---------------------------------------------------------------------------
// Per-session generator
// ---------------------------------------------------------------------------

type Phase = "calm" | "loiter" | "ramp" | "blocked" | "sag" | "away";

interface SessionState {
  app: SimApp;
  titleIndex: number;
  dwellLeft: number; // seconds on current app remaining
  phase: Phase;
  phaseLeft: number;
  sw45: number; // leaky switch rate (switches/s, tau 45 s)
  grey60: number; // leaky grey occupancy (0..1, tau 60 s)
  sw30: number; // faster tracker the hazard reads (tau 30 s)
  grey30: number; // faster tracker the hazard reads (tau 30 s)
  phaseLen: number; // length of the current episode at entry
  chastenedLeft: number;
  drifts: number;
  deskConf: number;
  sagFrom: number;
  sagLen: number;
  sagWillLeave: boolean;
  loiterGreyProb: number;
}

function logNormal(rand: () => number, meanSec: number, sigma: number, jitter: number): number {
  return Math.max(0.4, Math.exp(Math.log(meanSec) + sigma * jitter * gaussian(rand)));
}

function poisson(rand: () => number, lambda: number): number {
  if (lambda <= 0) {
    return 0;
  }
  const limit = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > limit);
  return k - 1;
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))] as T;
}

export function simulateSession(
  index: number,
  archetype: Archetype,
  config: SimConfig,
): RawSession {
  const seed = deriveSeed(config.seed, `session:${index}:${archetype}`);
  const rand = mulberry32(seed);
  const durationSec = Math.round(
    (config.minMinutes + rand() * (config.maxMinutes - config.minMinutes)) * 60,
  );
  const greyApps = Array.from(
    { length: Math.min(config.greyVocab, GREY_POOL.length) },
    (_, i) => GREY_POOL[(i + Math.floor(rand() * GREY_POOL.length)) % GREY_POOL.length] as SimApp,
  );
  const allowApps =
    archetype === "research_churn" ? ALLOW_APPS : ALLOW_APPS.slice(0, 2 + Math.floor(rand() * 3));
  const blockApp = pick(rand, BLOCK_APPS);

  const focus: RawFocusEvent[] = [];
  const desk: RawDeskEvent[] = [];

  const webcamOff = rand() < config.webcamOffProb;
  const webcamOffStart = webcamOff ? 120 + rand() * Math.max(60, durationSec - 420) : -1;
  const webcamOffLen = webcamOff ? 60 + rand() * 180 : 0;

  const state: SessionState = {
    app: allowApps[0] as SimApp,
    titleIndex: 0,
    dwellLeft: logNormal(rand, 150, 0.5, config.dwellJitter),
    phase: archetype === "research_churn" ? "loiter" : "calm",
    phaseLeft: Infinity,
    sw45: 0,
    grey60: 0,
    sw30: 0,
    grey30: 0,
    phaseLen: 0,
    chastenedLeft: 0,
    drifts: 0,
    deskConf: 0.86,
    sagFrom: 0.86,
    sagLen: 0,
    sagWillLeave: false,
    loiterGreyProb: 0.85,
  };

  const emitFocus = (tsMs: number, app: SimApp, titleIndex: number): void => {
    focus.push({
      ts: Math.round(tsMs),
      proc: app.proc,
      title: app.titles[titleIndex % app.titles.length] as string,
      allow: app.kind === "allow",
      block: app.kind === "block",
    });
  };
  emitFocus(300, state.app, state.titleIndex);

  const sampleDwell = (): number => {
    if (state.phase === "ramp") {
      return logNormal(rand, 2.4, 0.6, config.dwellJitter);
    }
    if (archetype === "research_churn") {
      return logNormal(rand, 5, 0.9, config.dwellJitter);
    }
    if (state.phase === "loiter" && state.app.kind === "grey") {
      // The loiter accelerates as it deepens — dwells shrink, so the last
      // half-minute before a wanderer drift is visibly restless, not just
      // "grey for a long time" (which saturates the 30 s window features).
      const age = Math.max(0, state.phaseLen - state.phaseLeft);
      return logNormal(rand, Math.max(7, 26 - 0.45 * age), 0.6, config.dwellJitter);
    }
    if (state.phase === "loiter" && state.app.kind === "allow") {
      // Mid-loiter peeks at the assignment are short — the pull is back to
      // Spotify. Keeps the loiter's grey signature dense while it lasts.
      return logNormal(rand, 8, 0.6, config.dwellJitter);
    }
    if (state.app.kind === "grey") {
      return logNormal(rand, 16, 0.8, config.dwellJitter);
    }
    if (state.app.kind === "allow") {
      const deep = archetype === "grinder" || archetype === "steady_then_snap";
      return logNormal(rand, deep ? 220 : 90, deep ? 0.5 : 0.7, config.dwellJitter);
    }
    return logNormal(rand, 9, 0.4, config.dwellJitter);
  };

  const nextApp = (): SimApp => {
    if (archetype === "research_churn") {
      // Allowlist-internal churn only — never grey, never block.
      const others = allowApps.filter((app) => app.proc !== state.app.proc);
      return pick(rand, others.length > 0 ? others : allowApps);
    }
    let greyProb = 0.1;
    if (state.phase === "loiter") {
      greyProb = state.loiterGreyProb;
    } else if (state.phase === "ramp") {
      greyProb = 0.45;
    } else if (archetype === "grinder" || archetype === "steady_then_snap") {
      greyProb = 0.05;
    } else if (archetype === "wanderer") {
      greyProb = 0.2;
    }
    if (rand() < greyProb) {
      return pick(rand, greyApps);
    }
    const others = allowApps.filter((app) => app.proc !== state.app.proc);
    return pick(rand, others.length > 0 ? others : allowApps);
  };

  const titleFlipRate = (): number => {
    if (state.phase === "ramp") {
      return 0.28;
    }
    if (archetype === "research_churn") {
      return 0.38;
    }
    if (state.phase === "loiter") {
      const age = Math.max(0, state.phaseLen - state.phaseLeft);
      return Math.min(0.34, 0.1 + age / 110);
    }
    if (state.app.kind === "grey") {
      return 0.08;
    }
    return archetype === "burst_switcher" ? 0.05 : 0.02;
  };

  const beginDrift = (sec: number, kind: "tab_out" | "walk_away"): void => {
    state.drifts += 1;
    if (kind === "tab_out") {
      state.phase = "blocked";
      state.app = blockApp;
      state.titleIndex = Math.floor(rand() * blockApp.titles.length);
      // Comply before the 10 s fuse elapses, or get killed right at it.
      state.dwellLeft = Math.min(4 + logNormal(rand, 6, 0.5, 1), 13);
      emitFocus(sec * 1000 + 200 + rand() * 500, state.app, state.titleIndex);
    } else {
      state.phase = "away";
      state.phaseLeft = 45 + rand() * 105;
    }
  };

  const endDrift = (sec: number): void => {
    state.phase = "calm";
    state.phaseLeft = Infinity;
    state.chastenedLeft = 90 + rand() * 60;
    state.sw45 = 0;
    state.grey60 = 0;
    state.sw30 = 0;
    state.grey30 = 0;
    state.app = allowApps[Math.floor(rand() * allowApps.length)] as SimApp;
    state.titleIndex = Math.floor(rand() * state.app.titles.length);
    state.dwellLeft = logNormal(rand, 180, 0.5, config.dwellJitter);
    emitFocus(sec * 1000 + 100 + rand() * 400, state.app, state.titleIndex);
  };

  // Episode arrival rates (per second) by archetype.
  const loiterRate = archetype === "wanderer" ? 1 / 450 : 0;
  const rampRate = archetype === "burst_switcher" ? 1 / 450 : 0;
  const sagRate = archetype === "away_drifter" ? 1 / 380 : 0;

  const maxDrifts =
    archetype === "grinder" ? 1 : archetype === "steady_then_snap" ? 3 : Infinity;

  for (let sec = 0; sec < durationSec; sec += 1) {
    const idle = state.phase === "away";
    const drifting = state.phase === "blocked" || state.phase === "away";
    state.chastenedLeft = Math.max(0, state.chastenedLeft - 1);

    // --- Phase scheduling -------------------------------------------------
    if (!drifting && state.chastenedLeft <= 0 && sec > 90) {
      if (state.phase === "calm" && loiterRate > 0 && rand() < loiterRate) {
        state.phase = "loiter";
        // Long enough that a DEEP loiter almost always ends in the drift the
        // hazard causes; the survivors that keep the model honest are the
        // half-hearted loiters below and the young phase itself.
        state.phaseLeft = 120 + rand() * 80;
        state.phaseLen = state.phaseLeft;
        // A quarter of loiters are half-hearted — they thin out the
        // grey-dwell ⇒ drift shortcut and feed the model hard negatives.
        state.loiterGreyProb = rand() < 0.15 ? 0.45 : 0.85;
        state.dwellLeft = Math.min(state.dwellLeft, 4 + rand() * 8);
      }
      if (state.phase === "calm" && rampRate > 0 && rand() < rampRate) {
        state.phase = "ramp";
        state.phaseLeft = 50 + rand() * 55;
        state.phaseLen = state.phaseLeft;
        state.dwellLeft = Math.min(state.dwellLeft, 2 + rand() * 4);
      }
      if (state.phase === "calm" && sagRate > 0 && rand() < sagRate) {
        state.phase = "sag";
        state.sagLen = 30 + rand() * 25;
        state.phaseLeft = state.sagLen;
        state.sagFrom = state.deskConf;
        state.sagWillLeave = rand() < 0.85; // some sags recover — false alarms
      }
    }
    if (state.phase === "loiter" || state.phase === "ramp" || state.phase === "sag") {
      state.phaseLeft -= 1;
      if (state.phaseLeft <= 0) {
        if (state.phase === "sag" && state.sagWillLeave && state.drifts < maxDrifts) {
          beginDrift(sec, "walk_away");
        } else {
          state.phase = "calm";
          state.phaseLeft = Infinity;
        }
      }
    }
    if (state.phase === "away") {
      state.phaseLeft -= 1;
      if (state.phaseLeft <= 0) {
        endDrift(sec);
      }
    }

    // --- Focus stream (sub-second switching within this second) -----------
    let switches = 0;
    if (!idle) {
      let budget = 1;
      let cursor = sec;
      while (budget > 1e-9) {
        if (state.dwellLeft <= budget) {
          cursor += state.dwellLeft;
          budget -= state.dwellLeft;
          if (state.phase === "blocked") {
            endDrift(cursor);
            break;
          }
          state.app = nextApp();
          state.titleIndex = Math.floor(rand() * state.app.titles.length);
          state.dwellLeft = sampleDwell();
          emitFocus(cursor * 1000, state.app, state.titleIndex);
          switches += 1;
          if (switches > 8) {
            break; // alt-tab faster than 8/s is not human
          }
        } else {
          state.dwellLeft -= budget;
          budget = 0;
        }
      }
      // Title flips inside the current app (tab flicking).
      const flips = poisson(rand, titleFlipRate());
      for (let f = 0; f < flips; f += 1) {
        const next = (state.titleIndex + 1 + Math.floor(rand() * (state.app.titles.length - 1))) %
          state.app.titles.length;
        state.titleIndex = next;
        emitFocus(sec * 1000 + 100 + rand() * 850, state.app, state.titleIndex);
      }
    }

    // --- Leaky behavior trackers the hazard reads --------------------------
    state.sw45 = state.sw45 * (1 - 1 / 45) + switches / 45;
    state.grey60 = state.grey60 * (1 - 1 / 60) + (state.app.kind === "grey" ? 1 : 0) / 60;
    state.sw30 = state.sw30 * (1 - 1 / 30) + switches / 30;
    state.grey30 = state.grey30 * (1 - 1 / 30) + (state.app.kind === "grey" ? 1 : 0) / 30;

    // --- Desk stream (Ornstein–Uhlenbeck around per-mode mean) --------------
    const webcamIsOff = webcamOff && sec >= webcamOffStart && sec < webcamOffStart + webcamOffLen;
    const dropout = rand() < config.dropoutProb;
    if (!dropout) {
      for (let tick = 0; tick < config.deskHz; tick += 1) {
        const ts = Math.round(sec * 1000 + (tick * 1000) / config.deskHz);
        if (webcamIsOff) {
          desk.push({ ts, on: false, label: "uncertain", conf: 0 });
          continue;
        }
        let label: DeskLabel;
        let conf: number;
        if (state.phase === "away") {
          label = "away";
          conf = Math.min(0.97, Math.max(0.7, 0.84 + 0.03 * gaussian(rand)));
        } else {
          let mu = 0.86;
          if (state.phase === "sag") {
            const progress = 1 - state.phaseLeft / Math.max(1, state.sagLen);
            mu = state.sagFrom + (0.45 - state.sagFrom) * Math.min(1, Math.max(0, progress));
          }
          const dt = 1 / config.deskHz;
          state.deskConf +=
            0.5 * (mu - state.deskConf) * dt + config.deskNoise * Math.sqrt(dt) * gaussian(rand);
          state.deskConf = Math.min(0.99, Math.max(0.05, state.deskConf));
          const flickerProb = state.phase === "sag" ? 0.1 : 0.004;
          if (rand() < flickerProb) {
            label = "uncertain";
            conf = 0.4 + 0.1 * rand();
          } else {
            label = state.deskConf < 0.5 ? "uncertain" : "at_desk";
            conf = state.deskConf;
          }
        }
        desk.push({ ts, on: true, label, conf: Math.round(conf * 1000) / 1000 });
      }
    }

    // --- Drift hazard: reads the generator's own recent behavior ----------
    if (!drifting && state.phase !== "sag" && state.drifts < maxDrifts && sec > 120) {
      const chastened = state.chastenedLeft > 0 ? 0.15 : 1;
      // Mild fatigue only — a strong time multiplier would hand `sessionMin`
      // the game as a single-feature baseline, which defeats the point.
      const fatigue = 1 + 0.15 * (sec / 1800);
      let lambda = 0;
      switch (archetype) {
        case "grinder":
          lambda = 0.00002 * fatigue;
          break;
        case "wanderer": {
          // The hazard is AGE-GATED: near zero for the first ~30 s of a
          // loiter, then steep. Onsets therefore land ≥ 30 s into an episode
          // (the precursor is fully inside the feature window at 20–30 s
          // lead) and deep-loiter frames carry a TRUE posterior above the
          // 0.80 pre-arm threshold — a calibrated model can only pre-arm if
          // the world actually behaves like that.
          const age = state.phase === "loiter" ? Math.max(0, state.phaseLen - state.phaseLeft) : 0;
          // The gate opens at 45 s of loiter: by then the 30/60 s window
          // features have fully saturated, so the risk needle crosses the
          // pre-arm line 10-25 s before the onset, not 3 s.
          const gate = age <= 45 ? 0 : Math.min(1, (age - 45) / 15);
          // Only fires FROM grey focus — a wanderer tab-outs from Spotify,
          // not from a fresh return to Docs — so every onset carries a live
          // grey signature at 20-30 s lead.
          lambda = state.app.kind === "grey"
            ? 0.14 * state.grey30 * state.grey30 * fatigue * gate
            : 0;
          break;
        }
        case "burst_switcher": {
          const age = state.phase === "ramp" ? Math.max(0, state.phaseLen - state.phaseLeft) : 0;
          const gate = age <= 30 ? 0 : Math.min(1, (age - 30) / 15);
          lambda = 1.2 * Math.pow(Math.max(0, state.sw30 - 0.08), 1.5) * fatigue * gate;
          break;
        }
        case "away_drifter":
          // Occasional tab-outs on top of the sag-driven walk-aways.
          lambda = 0.0006 * state.grey60 * fatigue;
          break;
        case "research_churn":
          lambda = 0; // never drifts — the anti-if-else archetype
          break;
        case "steady_then_snap":
          lambda = 0.0007; // uncoupled from behavior: near-zero warning
          break;
      }
      if (rand() < lambda * config.hazardScale * chastened) {
        beginDrift(sec, "tab_out");
      }
    }
  }

  focus.sort((a, b) => a.ts - b.ts);
  return {
    v: 1,
    id: `syn-${String(index).padStart(6, "0")}`,
    archetype,
    source: "synthetic",
    seed,
    durationSec,
    focus,
    desk,
  };
}

export function archetypeForIndex(
  index: number,
  total: number,
  weights: Record<Archetype, number>,
): Archetype {
  // Deterministic proportional assignment (largest-remainder style would be
  // overkill): walk the cumulative weights with an evenly spaced pointer.
  const sum = ARCHETYPES.reduce((acc, a) => acc + weights[a], 0) || 1;
  const point = ((index + 0.5) / total) * sum;
  let acc = 0;
  for (const archetype of ARCHETYPES) {
    acc += weights[archetype];
    if (point <= acc) {
      return archetype;
    }
  }
  return ARCHETYPES[ARCHETYPES.length - 1] as Archetype;
}

async function main(): Promise<void> {
  const config = readConfig();
  const out = createWriteStream(config.out, "utf8");
  const counts: Record<string, number> = {};
  let focusEvents = 0;
  let deskEvents = 0;
  let totalSec = 0;
  let drifts = 0;

  for (let i = 0; i < config.sessions; i += 1) {
    const archetype = archetypeForIndex(i, config.sessions, config.weights);
    const session = simulateSession(i, archetype, config);
    counts[archetype] = (counts[archetype] ?? 0) + 1;
    focusEvents += session.focus.length;
    deskEvents += session.desk.length;
    totalSec += session.durationSec;
    drifts += session.focus.filter((event, idx) => event.block && !(session.focus[idx - 1]?.block ?? false)).length;
    if (!out.write(`${JSON.stringify(session)}\n`)) {
      await new Promise<void>((resolve) => out.once("drain", () => resolve()));
    }
  }
  await new Promise<void>((resolve, reject) => {
    out.end(() => resolve());
    out.on("error", reject);
  });

  const meta = {
    seed: config.seed,
    sessions: config.sessions,
    deskHz: config.deskHz,
    hazardScale: config.hazardScale,
    weights: config.weights,
    counts,
    totalSeconds: totalSec,
    focusEvents,
    deskEvents,
    blockEntries: drifts,
  };
  writeFileSync(join(forecastDataRoot(), "simulate-meta.json"), JSON.stringify(meta, null, 2));
  console.log(
    `simulated ${config.sessions} sessions (${(totalSec / 3600).toFixed(1)} h) → ${config.out}`,
  );
  console.log(
    `  archetypes ${JSON.stringify(counts)} | focus events ${focusEvents} | desk events ${deskEvents}`,
  );
}

const invokedDirectly = process.argv[1]?.endsWith("simulate.ts") ?? false;
if (invokedDirectly && !boolFlag("--no-run")) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
