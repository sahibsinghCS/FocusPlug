import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  INITIAL_ESCALATION_STATE,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
} from "../../../src/shared/forecast/escalate";
import {
  findDriftOnsets,
  labelFrames,
  type DecisionFrame,
  type DriftOnset,
} from "../../../src/shared/forecast/labels";
import { FORECAST_FEATURE_KEYS, FORECAST_WARMUP_SEC, type ForecastEvent } from "../../../src/shared/forecast/types";
import type { Decision } from "../../../src/shared/types";
import {
  DATASET_FILE,
  RAW_SESSIONS_FILE,
  forecastDataRoot,
  keepProbability,
  readJsonl,
  splitForSession,
  type DatasetRow,
  type RawSession,
} from "../lib";
import { augmentLocal } from "../augment-local";
import { HYBRID_EXTRA_DIM, HYBRID_EXTRA_KEYS, replaySessionExtended } from "../candidates/hybrid/features-plus";
import {
  HOLDOUT_MANIFEST_FILE,
  HOLDOUT_SESSIONS_FILE,
  holdoutRoot,
  isHoldoutSessionId,
} from "../holdout-namespace";

/**
 * ONE replay of every session, shared by every contender in
 * `scripts/forecast/holdout-bakeoff.ts`.
 *
 * Two invariants this file exists to enforce:
 *
 *  - EVERY model is scored on the IDENTICAL frames. The 1 Hz features, the
 *    policy decisions, the censoring flags and the drift onsets are computed
 *    once, by the SHARED core (`TelemetryRing` → `classify` →
 *    `extractFeatures` → `findDriftOnsets`/`labelFrames`, via hybrid's
 *    `replaySessionExtended`, which is that loop plus `extractExtended` on the
 *    same ring at the same instant). No contender re-derives them.
 *  - The hold-out corpus this produces is ASSERTED equal, row for row, to the
 *    published `holdout-manifest.json` — same row count, same positives, same
 *    onsets, same lead-censored eligibility counts. If the two disagree the run
 *    aborts, because then the numbers would not be re-derivable by
 *    `npm run forecast:evalset`.
 *
 * Feature layout is `WIDTH` columns per frame: the `FORECAST_FEATURE_KEYS`
 * block (24 today) followed by hybrid's 7 extras. Every model slices the
 * columns its own basis asks for; nothing is recomputed per model.
 */

/** The pipeline's base seed — the one every committed artifact was built at. */
export const TRAIN_SEED = 42;

export const SHIPPED_DIM = FORECAST_FEATURE_KEYS.length; // 24
export const OLD_DIM = 18; // the basis the five-family bake-off ran on
export const WIDTH = SHIPPED_DIM + HYBRID_EXTRA_DIM;
export { HYBRID_EXTRA_DIM };

/** hybrid extras that are NOT already in FORECAST_FEATURE_KEYS (24-basis case). */
export const HYBRID_EXTRA_ONLY = HYBRID_EXTRA_KEYS.map((key, i) => ({ key, col: SHIPPED_DIM + i })).filter(
  (entry) => !(FORECAST_FEATURE_KEYS as readonly string[]).includes(entry.key),
);

const DECISION_CODES: Decision[] = ["ON_TASK", "DISTRACTED", "AWAY", "IDLE"];
const DECISION_INDEX = new Map<Decision, number>(DECISION_CODES.map((d, i) => [d, i]));

export interface SessionMeta {
  id: string;
  archetype: string;
  source: string;
  durationSec: number;
  /** Frame count (== durationSec). */
  n: number;
  /** Offset of frame 0 inside the corpus-wide arrays, in FRAMES. */
  offset: number;
  onsets: DriftOnset[];
}

export interface Corpus {
  sessions: SessionMeta[];
  totalFrames: number;
  /** totalFrames × WIDTH, row-major. */
  feats: Float64Array;
  decision: Uint8Array;
  countdown: Uint8Array;
  label: Uint8Array;
  /** Seconds to the next onset; NaN when none remains. */
  secs: Float64Array;
  excluded: Uint8Array;
  /** 0 none · 1 tab_out · 2 walk_away (label-1 rows only). */
  driftType: Uint8Array;
  /** Frame indices of the surviving (uncensored) rows — the dataset rows. */
  rowIdx: Int32Array;
  /** Session index per surviving row (the bootstrap cluster). */
  rowSession: Int32Array;
  /** 1/keepProbability — 1 everywhere in the hold-out corpus (no downsampling). */
  rowImportance: Float64Array;
}

export function decisionOf(corpus: Corpus, frame: number): Decision {
  return DECISION_CODES[corpus.decision[frame] as number] as Decision;
}

interface Staged {
  meta: Omit<SessionMeta, "offset">;
  onsets: DriftOnset[];
  feats: Float64Array;
  decision: Uint8Array;
  countdown: Uint8Array;
  label: Uint8Array;
  secs: Float64Array;
  excluded: Uint8Array;
  driftType: Uint8Array;
}

function replayOne(session: RawSession): Staged {
  const frames = replaySessionExtended(session);
  const n = frames.length;
  const feats = new Float64Array(n * WIDTH);
  const decision = new Uint8Array(n);
  const countdown = new Uint8Array(n);
  const decisions: DecisionFrame[] = new Array(n);
  for (let i = 0; i < n; i += 1) {
    const frame = frames[i] as (typeof frames)[number];
    const off = i * WIDTH;
    for (let f = 0; f < SHIPPED_DIM; f += 1) {
      feats[off + f] = frame.base[f] as number;
    }
    for (let f = 0; f < HYBRID_EXTRA_DIM; f += 1) {
      feats[off + SHIPPED_DIM + f] = frame.extra[f] as number;
    }
    decision[i] = DECISION_INDEX.get(frame.decision) ?? 0;
    countdown[i] = frame.countdownActive ? 1 : 0;
    decisions[i] = { t: frame.t, decision: frame.decision, countdownActive: frame.countdownActive };
  }
  const onsets = findDriftOnsets(decisions);
  const labels = labelFrames(decisions, onsets, session.durationSec);
  const label = new Uint8Array(n);
  const secs = new Float64Array(n);
  const excluded = new Uint8Array(n);
  const driftType = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const entry = labels[i] as (typeof labels)[number];
    label[i] = entry.label;
    secs[i] = entry.secsToDrift === null ? Number.NaN : entry.secsToDrift;
    excluded[i] = entry.excluded ? 1 : 0;
    driftType[i] = entry.driftType === "tab_out" ? 1 : entry.driftType === "walk_away" ? 2 : 0;
  }
  return {
    meta: {
      id: session.id,
      archetype: session.archetype,
      source: session.source,
      durationSec: session.durationSec,
      n,
      onsets,
    },
    onsets,
    feats,
    decision,
    countdown,
    label,
    secs,
    excluded,
    driftType,
  };
}

function assemble(staged: readonly Staged[]): Corpus {
  let totalFrames = 0;
  for (const item of staged) {
    totalFrames += item.meta.n;
  }
  const corpus: Corpus = {
    sessions: [],
    totalFrames,
    feats: new Float64Array(totalFrames * WIDTH),
    decision: new Uint8Array(totalFrames),
    countdown: new Uint8Array(totalFrames),
    label: new Uint8Array(totalFrames),
    secs: new Float64Array(totalFrames),
    excluded: new Uint8Array(totalFrames),
    driftType: new Uint8Array(totalFrames),
    rowIdx: new Int32Array(0),
    rowSession: new Int32Array(0),
    rowImportance: new Float64Array(0),
  };
  const rowIdx: number[] = [];
  const rowSession: number[] = [];
  let offset = 0;
  staged.forEach((item, s) => {
    corpus.feats.set(item.feats, offset * WIDTH);
    corpus.decision.set(item.decision, offset);
    corpus.countdown.set(item.countdown, offset);
    corpus.label.set(item.label, offset);
    corpus.secs.set(item.secs, offset);
    corpus.excluded.set(item.excluded, offset);
    corpus.driftType.set(item.driftType, offset);
    corpus.sessions.push({ ...item.meta, offset, onsets: item.onsets });
    for (let i = 0; i < item.meta.n; i += 1) {
      if (item.excluded[i] === 0) {
        rowIdx.push(offset + i);
        rowSession.push(s);
      }
    }
    offset += item.meta.n;
  });
  corpus.rowIdx = Int32Array.from(rowIdx);
  corpus.rowSession = Int32Array.from(rowSession);
  corpus.rowImportance = new Float64Array(rowIdx.length).fill(1);
  return corpus;
}

/** Replays every hold-out session and asserts the result against the published manifest. */
export async function loadHoldoutCorpus(log: (message: string) => void): Promise<{
  corpus: Corpus;
  manifest: Record<string, unknown>;
}> {
  const manifest = JSON.parse(
    readFileSync(join(holdoutRoot(), HOLDOUT_MANIFEST_FILE), "utf8"),
  ) as Record<string, unknown>;
  const staged: Staged[] = [];
  const started = Date.now();
  let count = 0;
  for await (const session of readJsonl<RawSession>(join(holdoutRoot(), HOLDOUT_SESSIONS_FILE))) {
    if (!isHoldoutSessionId(session.id)) {
      throw new Error(`hold-out raw file contains a non-hold-out id: ${session.id}`);
    }
    staged.push(replayOne(session));
    count += 1;
    if (count % 150 === 0) {
      log(`  replayed ${count} hold-out sessions … ${((Date.now() - started) / 1000).toFixed(0)}s`);
    }
  }
  const corpus = assemble(staged);

  // --- the corpus must equal the published one, or nothing here is re-derivable
  const counts = (manifest["counts"] ?? {}) as Record<string, unknown>;
  const lead = ((counts["leadCensored"] ?? {}) as Record<string, unknown>)["lead20"] as
    | { positives?: number; negatives?: number }
    | undefined;
  let positives = 0;
  let lead20Pos = 0;
  let lead20Neg = 0;
  for (let k = 0; k < corpus.rowIdx.length; k += 1) {
    const i = corpus.rowIdx[k] as number;
    positives += corpus.label[i] as number;
    const secs = corpus.secs[i] as number;
    if (Number.isNaN(secs) || secs >= 20) {
      if ((corpus.label[i] as number) === 1) {
        lead20Pos += 1;
      } else {
        lead20Neg += 1;
      }
    }
  }
  const onsets = corpus.sessions.reduce((sum, s) => sum + s.onsets.length, 0);
  const expect: Array<[string, number, unknown]> = [
    ["sessions", corpus.sessions.length, counts["sessions"]],
    ["rows", corpus.rowIdx.length, counts["rows"]],
    ["positives", positives, counts["positives"]],
    ["driftOnsets", onsets, counts["driftOnsets"]],
    ["rawFrames", corpus.totalFrames, counts["rawFrames"]],
    ["lead20Positives", lead20Pos, lead?.positives],
    ["lead20Negatives", lead20Neg, lead?.negatives],
  ];
  for (const [name, mine, theirs] of expect) {
    if (theirs !== undefined && mine !== theirs) {
      throw new Error(
        `hold-out replay disagrees with holdout-manifest.json on ${name}: ${mine} vs ${String(theirs)} — ` +
          `re-run 'npm run forecast:evalset' so the corpus and the manifest describe the same thing`,
      );
    }
  }
  log(
    `hold-out corpus: ${corpus.sessions.length} sessions | ${corpus.totalFrames} frames | ` +
      `${corpus.rowIdx.length} rows (${positives} pos) | ${onsets} onsets | lead≥20s ${lead20Pos}/${lead20Neg} | ` +
      `manifest-verified | ${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return { corpus, manifest };
}

export interface TrainRows {
  n: number;
  /** n × WIDTH. */
  x: Float64Array;
  y: Uint8Array;
  yTab: Uint8Array;
  yAway: Uint8Array;
  /** NaN ⇒ no onset ahead. */
  secs: Float64Array;
  importance: Float64Array;
  sessionOf: Int32Array;
  sessions: string[];
  augmented: Uint8Array;
  /** Per-session replays, keyed by the session index in `sessions`. */
  replay: Corpus;
  /** Session id -> index inside `replay.sessions`. */
  replayIndexOf: Map<string, number>;
  /** Row -> frame index inside `replay`. */
  frameOf: Int32Array;
  /**
   * The RAW stream of every train session, simulated AND locally augmented.
   * `raw-sessions.jsonl` holds only the simulated ones; the sequence model
   * needs the augmented streams too, and silently training it on 79 % of the
   * train split would be a different experiment than every other contender's.
   */
  rawById: Map<string, RawSession>;
}

/**
 * Train-split rows of `dataset.jsonl`, joined to a fresh replay of the same raw
 * sessions so every row also carries hybrid's 7 extras and every session can be
 * escalation-simulated. The join is SELF-CHECKED against the dataset's own
 * feature columns (the check hybrid.ts runs), so a replay that drifted from the
 * committed file aborts instead of quietly training on different numbers.
 */
export async function loadTrainRows(log: (message: string) => void): Promise<TrainRows> {
  const started = Date.now();
  const rawFile = join(forecastDataRoot(), RAW_SESSIONS_FILE);
  // raw-sessions.jsonl holds the 240 SIMULATED sessions only; the 48
  // `augmented:local` train sessions are produced in-process by
  // build-dataset.ts and are reproduced here with the pipeline's own
  // `augmentLocal` at the pipeline's own settings (fraction 0.25, seed 42),
  // exactly as hybrid.ts does, so the join covers the whole train split.
  const rawSessions: RawSession[] = [];
  for await (const session of readJsonl<RawSession>(rawFile)) {
    rawSessions.push(session);
  }
  const trainRawSessions = rawSessions.filter(
    (session) => splitForSession(session.id, TRAIN_SEED) === "train",
  );
  const augmentedSessions = augmentLocal(trainRawSessions, { fraction: 0.25, seed: TRAIN_SEED });
  const staged: Staged[] = [];
  const rawById = new Map<string, RawSession>();
  for (const session of [...rawSessions, ...augmentedSessions]) {
    staged.push(replayOne(session));
    rawById.set(session.id, session);
  }
  const replay = assemble(staged);
  const replayIndexOf = new Map(replay.sessions.map((session, i) => [session.id, i]));

  const xs: number[] = [];
  const ys: number[] = [];
  const yTab: number[] = [];
  const yAway: number[] = [];
  const secs: number[] = [];
  const importance: number[] = [];
  const sessionOf: number[] = [];
  const frameOf: number[] = [];
  const augmented: number[] = [];
  const sessions: string[] = [];
  const sessionIndex = new Map<string, number>();
  let worstJoin = 0;
  let checked = 0;

  for await (const row of readJsonl<DatasetRow>(join(forecastDataRoot(), DATASET_FILE))) {
    if (row.split !== "train") {
      continue;
    }
    if (isHoldoutSessionId(row.session_id)) {
      throw new Error(
        `CONTAMINATION: training row ${row.session_id} carries a hold-out session id`,
      );
    }
    const replaySession = replayIndexOf.get(row.session_id);
    if (replaySession === undefined) {
      throw new Error(`train row ${row.session_id} has no raw session to join to`);
    }
    const meta = replay.sessions[replaySession] as SessionMeta;
    const frame = meta.offset + row.t - 1;
    let index = sessionIndex.get(row.session_id);
    if (index === undefined) {
      index = sessions.length;
      sessionIndex.set(row.session_id, index);
      sessions.push(row.session_id);
    }
    const off = frame * WIDTH;
    for (let f = 0; f < WIDTH; f += 1) {
      xs.push(replay.feats[off + f] as number);
    }
    ys.push(row.label);
    yTab.push(row.label === 1 && row.drift_type === "tab_out" ? 1 : 0);
    yAway.push(row.label === 1 && row.drift_type === "walk_away" ? 1 : 0);
    secs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
    importance.push(1 / keepProbability(row.label, row.secs_to_drift));
    sessionOf.push(index);
    frameOf.push(frame);
    augmented.push(row.source === "augmented:local" ? 1 : 0);
    if (ys.length % 257 === 0) {
      checked += 1;
      for (let f = 0; f < SHIPPED_DIM; f += 1) {
        worstJoin = Math.max(
          worstJoin,
          Math.abs((replay.feats[off + f] as number) - (row.features[f] ?? 0)),
        );
      }
    }
  }
  if (worstJoin > 1e-5) {
    throw new Error(
      `replay/dataset feature mismatch: worst |Δ| ${worstJoin} over ${checked} probed rows`,
    );
  }
  log(
    `train rows: ${ys.length} over ${sessions.length} sessions (${augmented.reduce((a, b) => a + b, 0)} augmented) | ` +
      `replay self-check worst |Δ| ${worstJoin.toExponential(2)} on ${checked} rows | ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
  );
  return {
    n: ys.length,
    x: Float64Array.from(xs),
    y: Uint8Array.from(ys),
    yTab: Uint8Array.from(yTab),
    yAway: Uint8Array.from(yAway),
    secs: Float64Array.from(secs),
    importance: Float64Array.from(importance),
    sessionOf: Int32Array.from(sessionOf),
    sessions,
    augmented: Uint8Array.from(augmented),
    replay,
    replayIndexOf,
    frameOf: Int32Array.from(frameOf),
    rawById,
  };
}

// ---------------------------------------------------------------------------
// Alarm simulation — the SHIPPED reducer, ONE common hit rule
// ---------------------------------------------------------------------------

export interface AlarmTotals {
  sessions: number;
  hours: number;
  drifts: number;
  /** THE COMMON RULE: a forecast_nudge or forecast_prearm EVENT the shipped
   *  reducer actually emitted inside (onset − 30 s, onset]. */
  eventHits: number;
  eventLeads: number[];
  /** Strict pre-arm rule (eval.ts's `recallAt30`), reported beside it. */
  prearmHits: number;
  prearmLeads: number[];
  /** The LOOSE rule the adjudicator caught temporal using: band ≠ calm at
   *  onset − 1 s, with no event required. Reported ONLY to show the gap. */
  escalatedAtOnset: number;
  nudges: number;
  prearms: number;
  falsePrearms: number;
}

export function newAlarmTotals(): AlarmTotals {
  return {
    sessions: 0,
    hours: 0,
    drifts: 0,
    eventHits: 0,
    eventLeads: [],
    prearmHits: 0,
    prearmLeads: [],
    escalatedAtOnset: 0,
    nudges: 0,
    prearms: 0,
    falsePrearms: 0,
  };
}

export function addTotals(target: AlarmTotals, source: AlarmTotals): void {
  target.sessions += source.sessions;
  target.hours += source.hours;
  target.drifts += source.drifts;
  target.eventHits += source.eventHits;
  target.eventLeads.push(...source.eventLeads);
  target.prearmHits += source.prearmHits;
  target.prearmLeads.push(...source.prearmLeads);
  target.escalatedAtOnset += source.escalatedAtOnset;
  target.nudges += source.nudges;
  target.prearms += source.prearms;
  target.falsePrearms += source.falsePrearms;
}

/**
 * Replays one session's PRE-COMPUTED smoothed-risk series through the shipped
 * `stepEscalation`. `risk` is the per-frame calibrated risk of whichever model
 * is being scored; everything else (decisions, countdown, onsets) is corpus
 * data every model shares.
 */
export function simulateSessionAlarms(
  corpus: Corpus,
  sessionIndex: number,
  risk: Float64Array,
  settings: EscalationSettings,
): AlarmTotals {
  const meta = corpus.sessions[sessionIndex] as SessionMeta;
  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  const events: ForecastEvent[] = [];
  const bandAt = new Map<number, string>();
  for (let i = 0; i < meta.n; i += 1) {
    const frame = meta.offset + i;
    smoothed = smoothRisk(smoothed, risk[frame] as number);
    const t = i + 1;
    const stepped = stepEscalation(state, {
      ts: t * 1000,
      risk: smoothed,
      ready: t >= FORECAST_WARMUP_SEC,
      decision: decisionOf(corpus, frame),
      countdownActive: corpus.countdown[frame] === 1,
      policySignal: null,
      settings,
    });
    state = stepped.state;
    events.push(...stepped.events);
    bandAt.set(t, state.band);
  }

  const totals = newAlarmTotals();
  totals.sessions = 1;
  totals.hours = meta.durationSec / 3600;
  totals.drifts = meta.onsets.length;
  const prearms = events.filter((event) => event.type === "forecast_prearm");
  const hitEvents = events.filter((event) => event.type === "forecast_hit");
  const alarmEvents = events.filter(
    (event) => event.type === "forecast_nudge" || event.type === "forecast_prearm",
  );
  totals.nudges = events.filter((event) => event.type === "forecast_nudge").length;
  totals.prearms = prearms.length;

  for (const onset of meta.onsets) {
    // --- THE COMMON RULE -----------------------------------------------------
    const inWindow = alarmEvents.filter(
      (event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30,
    );
    const first = inWindow[0];
    if (first !== undefined) {
      totals.eventHits += 1;
      totals.eventLeads.push(onset.t - first.ts / 1000);
    }
    // --- strict pre-arm rule (eval.ts's recallAt30) --------------------------
    const receipt = hitEvents.find(
      (event) => event.type === "forecast_hit" && Math.abs(event.ts / 1000 - onset.t) <= 1.5,
    );
    if (receipt !== undefined && receipt.type === "forecast_hit") {
      totals.prearmHits += 1;
      totals.prearmLeads.push(receipt.leadSec);
    } else {
      const candidates = prearms.filter(
        (event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30,
      );
      const last = candidates[candidates.length - 1];
      if (last !== undefined) {
        totals.prearmHits += 1;
        totals.prearmLeads.push(onset.t - last.ts / 1000);
      }
    }
    // --- the LOOSE rule, for the comparability audit only --------------------
    const band = bandAt.get(onset.t - 1);
    if (band !== undefined && band !== "calm") {
      totals.escalatedAtOnset += 1;
    }
  }
  totals.falsePrearms = events.filter(
    (event) =>
      event.type === "forecast_clear" &&
      event.wasPrearmed &&
      !meta.onsets.some((onset) => onset.t >= event.ts / 1000 && onset.t - event.ts / 1000 <= 30),
  ).length;
  return totals;
}

export function runAlarms(
  corpus: Corpus,
  risk: Float64Array,
  settings: EscalationSettings,
): { totals: AlarmTotals; byArchetype: Map<string, AlarmTotals> } {
  const totals = newAlarmTotals();
  const byArchetype = new Map<string, AlarmTotals>();
  for (let s = 0; s < corpus.sessions.length; s += 1) {
    const result = simulateSessionAlarms(corpus, s, risk, settings);
    addTotals(totals, result);
    const archetype = (corpus.sessions[s] as SessionMeta).archetype;
    const bucket = byArchetype.get(archetype) ?? newAlarmTotals();
    addTotals(bucket, result);
    byArchetype.set(archetype, bucket);
  }
  return { totals, byArchetype };
}
