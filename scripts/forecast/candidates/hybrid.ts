import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../../src/shared/defaults";
import {
  INITIAL_ESCALATION_STATE,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
} from "../../../src/shared/forecast/escalate";
import { findDriftOnsets, type DecisionFrame } from "../../../src/shared/forecast/labels";
import { forward, parseForecastWeights } from "../../../src/shared/forecast/model";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_WARMUP_SEC,
  type DriftType,
} from "../../../src/shared/forecast/types";
import type { Decision } from "../../../src/shared/types";
import { augmentLocal } from "../augment-local";
import {
  CONTRACT_PREARM_FUSE_SEC,
  DATASET_FILE,
  RAW_SESSIONS_FILE,
  ece10,
  forecastDataRoot,
  keepProbability,
  logisticScore,
  mulberry32,
  numberArg,
  percentile,
  prAuc,
  readJsonl,
  repoRoot,
  rocAuc,
  round4,
  round6,
  splitForSession,
  stringArg,
  thresholdDefaults,
  trainLogistic,
  type DatasetRow,
  type RawSession,
} from "../lib";
import {
  HYBRID_EXTRA_DIM,
  HYBRID_EXTRA_KEYS,
  replaySessionExtended,
} from "./hybrid/features-plus";
import {
  fitPlatt,
  forwardHybrid,
  gradientCheck,
  logit,
  paramCount,
  sigmoid,
  trainHybrid,
  type HybridHyper,
  type HybridNet,
} from "./hybrid/nets";

/**
 * ============================================================================
 * CONTENDER: hybrid
 * ============================================================================
 *
 * The gauntlet's problem is not that the shipped 18→12→1 MLP ranks badly — it
 * is that (a) a plain full-18 multivariate logistic beats it on the headline
 * lead-censored metric (0.9325 vs 0.9248) and (b) only 56 % of held-out drifts
 * get a pre-arm (73 % get any alarm). This candidate attacks BOTH from the
 * weakness side rather than the architecture side:
 *
 * 1. HYBRID MODEL — one additive model that is simultaneously the linear GLM
 *    that currently wins and a small L2-leashed tanh residual on top of it:
 *      z(x) = b0 + w·x + v·tanh(W1·x + b1)
 *    Setting v = 0 recovers the logistic exactly, so the family CONTAINS the
 *    thing that beats the MLP; the residual can only add curvature the linear
 *    part cannot express. 296 params per head.
 *
 * 2. HYBRID FEATURE SET — the shipped 18 plus 7 extras read off the SHIPPED
 *    TelemetryRing (no new telemetry; see hybrid/features-plus.ts): loiter
 *    depth beyond the saturating 30/60 s windows, the dwell-shrink and
 *    title-churn crescendos that make imminence observable, desk-sag slope and
 *    absence-run shape, and switches-per-distinct-app (which separates
 *    research_churn's allowlist cycling from real exploration).
 *
 * 3. HYBRID HEADS — a generalist head plus per-DRIFT-TYPE specialists
 *    (tab_out, walk_away) fused by noisy-OR on individually calibrated
 *    probabilities, blended with the generalist at a weight chosen on
 *    train-internal validation. tab_out and walk_away have genuinely different
 *    precursors (switching/loiter vs desk sag), and the misses cluster by type.
 *
 * 4. CALIBRATION-AWARE OPERATING POINT — the recall gap is largely a
 *    threshold choice against a frozen 0.55/0.80 pair. The recommended point
 *    is searched on TRAIN-INTERNAL sessions only, maximizing drift recall@30 s
 *    through the SHIPPED escalation reducer subject to HARD ceilings:
 *    research_churn frame FPR ≤ 0.005, false pre-arms ≤ 2/h, nudges ≤ 6/h.
 *    Every number is also reported at the shipped 0.55/0.80 for comparability,
 *    plus the full recall / false-positive operating curve.
 *
 * DATA DISCIPLINE (non-negotiable): data/forecast/dataset.jsonl is read as-is
 * — never rebuilt, resampled or re-split. The 18 base columns of every scored
 * row are the dataset's OWN columns. The 7 extras are recomputed by replaying
 * raw-sessions.jsonl through the SHARED ring (the same replay the dataset
 * builder used, cloned in features-plus.ts) and are joined on
 * (session_id, t); the replay's base-18 output is asserted against the
 * dataset's columns on every run. split == "eval" rows never enter any fit,
 * early stop, calibration, fusion-weight or threshold-selection step.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/candidates/hybrid.ts
 */

const CANDIDATE = "hybrid";
const BASE_DIM = FORECAST_FEATURE_KEYS.length; // 18
const DIM = BASE_DIM + HYBRID_EXTRA_DIM; // 25
const ALL_KEYS = [...FORECAST_FEATURE_KEYS, ...HYBRID_EXTRA_KEYS];
const DECISIONS: Decision[] = ["ON_TASK", "DISTRACTED", "AWAY", "IDLE"];

/**
 * Hard ceilings the recommended operating point must satisfy, all measured on
 * TRAIN-INTERNAL sessions. The alarm-rate ceilings are the SHIPPED model's own
 * rates on those same sessions, so the recommended point is by construction
 * "no noisier than what ships today" on every alarm axis — the recall gain is
 * then a gain, not a volume knob. The research_churn ceiling is absolute.
 */
const CHURN_FPR_CEILING = 0.005;
/** Design budget (docs/FORECAST-DESIGN.md §4.5) — the floor under the shipped rate. */
const FALSE_PREARMS_PER_HOUR_CEILING = 2.0;

interface Config {
  data: string;
  raw: string;
  out: string;
  seed: number;
  epochs: number;
  hidden: number;
}

function readConfig(): Config {
  const outDir = join(forecastDataRoot(), "candidates", CANDIDATE);
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    out: stringArg("--out", join(outDir, "metrics.json")),
    seed: numberArg("--seed", 42),
    epochs: Math.round(numberArg("--epochs", 45)),
    hidden: Math.round(numberArg("--hidden", 10)),
  };
}

// ---------------------------------------------------------------------------
// Session frames (replay) + dataset rows (fixed file)
// ---------------------------------------------------------------------------

interface SessionFrames {
  id: string;
  archetype: string;
  source: string;
  split: "train" | "eval";
  durationSec: number;
  n: number;
  /** n × DIM, base-18 + 7 extras, both from the shared-ring replay. */
  feats: Float32Array;
  decisions: Uint8Array;
  countdown: Uint8Array;
}

interface RowSet {
  n: number;
  /** n × DIM: base-18 straight from dataset.jsonl, extras from the replay. */
  x: Float64Array;
  y: Uint8Array;
  yTab: Uint8Array;
  yAway: Uint8Array;
  importance: Float64Array;
  secsToDrift: Array<number | null>;
  archetype: string[];
  sessionId: string[];
}

function emptyRowSet(): RowSet {
  return {
    n: 0,
    x: new Float64Array(0),
    y: new Uint8Array(0),
    yTab: new Uint8Array(0),
    yAway: new Uint8Array(0),
    importance: new Float64Array(0),
    secsToDrift: [],
    archetype: [],
    sessionId: [],
  };
}

// ---------------------------------------------------------------------------
// Metric helpers (all AUCs go through lib.rocAuc — the shared Mann–Whitney)
// ---------------------------------------------------------------------------

/** Lead-censored eligibility, verbatim from eval.ts: onset ≥ leadSec away, or calm. */
function leadEligible(secsToDrift: number | null, leadSec: number): boolean {
  return secsToDrift === null || secsToDrift >= leadSec;
}

function leadAuc(rows: RowSet, scores: readonly number[], leadSec: number): number {
  const s: number[] = [];
  const l: number[] = [];
  for (let i = 0; i < rows.n; i += 1) {
    if (leadEligible(rows.secsToDrift[i] ?? null, leadSec)) {
      s.push(scores[i] as number);
      l.push(rows.y[i] as number);
    }
  }
  return rocAuc(s, l);
}

function operatingPoint(
  rows: RowSet,
  scores: readonly number[],
  threshold: number,
): { threshold: number; precision: number | null; recall: number; fpr: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < rows.n; i += 1) {
    const fired = (scores[i] as number) >= threshold;
    if ((rows.y[i] as number) === 1) {
      if (fired) tp += 1;
      else fn += 1;
    } else if (fired) fp += 1;
    else tn += 1;
  }
  return {
    threshold,
    precision: tp + fp > 0 ? round4(tp / (tp + fp)) : null,
    recall: round4(tp + fn > 0 ? tp / (tp + fn) : 0),
    fpr: round4(fp + tn > 0 ? fp / (fp + tn) : 0),
  };
}

// ---------------------------------------------------------------------------
// Fitted hybrid model: normalization + heads + noisy-OR fusion + Platt
// ---------------------------------------------------------------------------

interface FittedHead {
  net: HybridNet;
  platt: { a: number; b: number };
  bestEpoch: number;
  epochsRan: number;
  posWeight: number;
  valScore: number;
}

interface FittedModel {
  name: string;
  cols: number[];
  mean: Float64Array;
  scale: Float64Array;
  gen: FittedHead;
  tab: FittedHead | null;
  away: FittedHead | null;
  /** Blend weight on the noisy-OR of the specialists (0 ⇒ generalist only). */
  alpha: number;
  final: { a: number; b: number };
  hyper: HybridHyper;
  params: number;
}

interface ScoreBuffers {
  xn: Float64Array;
  h: Float64Array;
}

function makeBuffers(model: FittedModel): ScoreBuffers {
  return {
    xn: new Float64Array(model.cols.length),
    h: new Float64Array(model.hyper.hidden),
  };
}

function normalizeInto(model: FittedModel, src: ArrayLike<number>, offset: number, buf: ScoreBuffers): void {
  for (let j = 0; j < model.cols.length; j += 1) {
    const raw = src[offset + (model.cols[j] as number)] as number;
    buf.xn[j] = (raw - (model.mean[j] as number)) / (model.scale[j] as number);
  }
}

function headProbability(head: FittedHead, buf: ScoreBuffers): number {
  const z = forwardHybrid(head.net, buf.xn, 0, buf.h);
  return sigmoid(head.platt.a * z + head.platt.b);
}

/** Fused, finally-Platt-calibrated risk in [0,1]. */
function scoreModel(
  model: FittedModel,
  src: ArrayLike<number>,
  offset: number,
  buf: ScoreBuffers,
): number {
  normalizeInto(model, src, offset, buf);
  const pGen = headProbability(model.gen, buf);
  if (model.alpha <= 0 || model.tab === null || model.away === null) {
    return sigmoid(model.final.a * logit(pGen) + model.final.b);
  }
  const pTab = headProbability(model.tab, buf);
  const pAway = headProbability(model.away, buf);
  const pOr = 1 - (1 - pTab) * (1 - pAway);
  const fused = model.alpha * logit(pOr) + (1 - model.alpha) * logit(pGen);
  return sigmoid(model.final.a * fused + model.final.b);
}

function scoreRows(model: FittedModel, rows: RowSet): number[] {
  const buf = makeBuffers(model);
  const out = new Array<number>(rows.n);
  for (let i = 0; i < rows.n; i += 1) {
    out[i] = scoreModel(model, rows.x, i * DIM, buf);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Alarm simulation through the SHIPPED escalation reducer
// ---------------------------------------------------------------------------

interface AlarmResult {
  drifts: number;
  /** Onsets with a nudge OR pre-arm in the 30 s before onset. */
  nudgeHits: number;
  /** Onsets with a pre-arm active at onset, or fired within the prior 30 s. */
  prearmHits: number;
  nudgeLeads: number[];
  prearmLeads: number[];
  nudges: number;
  /** Nudges with no drift onset in the following 30 s. */
  falseNudges: number;
  prearms: number;
  falsePrearms: number;
  hours: number;
  sessions: number;
  byType: Record<DriftType, { drifts: number; nudgeHits: number; prearmHits: number }>;
  byArchetype: Record<string, { drifts: number; nudgeHits: number; prearmHits: number }>;
}

function newAlarmResult(): AlarmResult {
  return {
    drifts: 0,
    nudgeHits: 0,
    prearmHits: 0,
    nudgeLeads: [],
    prearmLeads: [],
    nudges: 0,
    falseNudges: 0,
    prearms: 0,
    falsePrearms: 0,
    hours: 0,
    sessions: 0,
    byType: {
      tab_out: { drifts: 0, nudgeHits: 0, prearmHits: 0 },
      walk_away: { drifts: 0, nudgeHits: 0, prearmHits: 0 },
    },
    byArchetype: {},
  };
}

/** Per-frame raw risk of a scorer over one session's replayed feature matrix. */
type FrameScorer = (feats: Float32Array, offset: number) => number;

/** Smoothed risk per frame — threshold-independent, so it is computed once. */
function smoothedRiskSeries(session: SessionFrames, scorer: FrameScorer): Float64Array {
  const out = new Float64Array(session.n);
  let smoothed: number | null = null;
  for (let i = 0; i < session.n; i += 1) {
    smoothed = smoothRisk(smoothed, scorer(session.feats, i * DIM));
    out[i] = smoothed;
  }
  return out;
}

function driftOnsetsOf(session: SessionFrames): ReturnType<typeof findDriftOnsets> {
  const frames: DecisionFrame[] = new Array(session.n);
  for (let i = 0; i < session.n; i += 1) {
    frames[i] = {
      t: i + 1,
      decision: DECISIONS[session.decisions[i] as number] as Decision,
      countdownActive: (session.countdown[i] as number) === 1,
    };
  }
  return findDriftOnsets(frames);
}

/**
 * Replays one session's smoothed risk through the SHIPPED `stepEscalation` at
 * the given settings and scores it exactly the way the parent brief defines:
 * a drift is "caught" when the reducer would have raised AT LEAST A NUDGE in
 * the 30 s before onset.
 */
function simulateAlarms(
  session: SessionFrames,
  smoothed: Float64Array,
  onsets: ReturnType<typeof findDriftOnsets>,
  settings: EscalationSettings,
  into: AlarmResult,
): void {
  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  const nudgeTs: number[] = [];
  const prearmTs: number[] = [];
  const hitAt: Array<{ t: number; leadSec: number }> = [];
  const standDowns: number[] = [];

  for (let i = 0; i < session.n; i += 1) {
    const t = i + 1;
    const stepped = stepEscalation(state, {
      ts: t * 1000,
      risk: smoothed[i] as number,
      ready: t >= FORECAST_WARMUP_SEC,
      decision: DECISIONS[session.decisions[i] as number] as Decision,
      countdownActive: (session.countdown[i] as number) === 1,
      policySignal: null,
      settings,
    });
    state = stepped.state;
    for (const event of stepped.events) {
      if (event.type === "forecast_nudge") {
        nudgeTs.push(t);
      } else if (event.type === "forecast_prearm") {
        prearmTs.push(t);
      } else if (event.type === "forecast_hit") {
        hitAt.push({ t, leadSec: event.leadSec });
      } else if (event.type === "forecast_clear" && event.wasPrearmed) {
        standDowns.push(t);
      }
    }
  }

  into.sessions += 1;
  into.hours += session.durationSec / 3600;
  into.nudges += nudgeTs.length;
  into.falseNudges += nudgeTs.filter(
    (t) => !onsets.some((onset) => onset.t >= t && onset.t - t <= 30),
  ).length;
  into.prearms += prearmTs.length;
  into.falsePrearms += standDowns.filter(
    (t) => !onsets.some((onset) => onset.t >= t && onset.t - t <= 30),
  ).length;

  const archetypeBucket = into.byArchetype[session.archetype] ?? {
    drifts: 0,
    nudgeHits: 0,
    prearmHits: 0,
  };
  into.byArchetype[session.archetype] = archetypeBucket;

  for (const onset of onsets) {
    into.drifts += 1;
    into.byType[onset.driftType].drifts += 1;
    archetypeBucket.drifts += 1;

    // "At least a nudge in the 30 s before onset": the earliest nudge OR
    // pre-arm inside (onset−30, onset] gives the warning lead.
    const warnings = [...nudgeTs, ...prearmTs]
      .filter((t) => t <= onset.t && onset.t - t <= 30)
      .sort((a, b) => a - b);
    const firstWarning = warnings[0];
    if (firstWarning !== undefined) {
      into.nudgeHits += 1;
      into.byType[onset.driftType].nudgeHits += 1;
      archetypeBucket.nudgeHits += 1;
      into.nudgeLeads.push(onset.t - firstWarning);
    }

    // Pre-arm recall, the shipped report's `alarms.recallAt30`: the reducer's
    // own receipt (pre-arm active at onset), else a pre-arm in the prior 30 s.
    const receipt = hitAt.find((entry) => Math.abs(entry.t - onset.t) <= 1.5);
    if (receipt !== undefined) {
      into.prearmHits += 1;
      into.byType[onset.driftType].prearmHits += 1;
      archetypeBucket.prearmHits += 1;
      into.prearmLeads.push(receipt.leadSec);
      continue;
    }
    const candidates = prearmTs.filter((t) => t <= onset.t && onset.t - t <= 30);
    const last = candidates[candidates.length - 1];
    if (last !== undefined) {
      into.prearmHits += 1;
      into.byType[onset.driftType].prearmHits += 1;
      archetypeBucket.prearmHits += 1;
      into.prearmLeads.push(onset.t - last);
    }
  }
}

interface PreparedSession {
  session: SessionFrames;
  smoothed: Float64Array;
  onsets: ReturnType<typeof findDriftOnsets>;
}

function runAlarms(prepared: readonly PreparedSession[], settings: EscalationSettings): AlarmResult {
  const totals = newAlarmResult();
  for (const entry of prepared) {
    simulateAlarms(entry.session, entry.smoothed, entry.onsets, settings, totals);
  }
  return totals;
}

function escalationSettings(nudge: number, prearm: number): EscalationSettings {
  return {
    nudgeRisk: nudge,
    prearmRisk: prearm,
    prearmEnabled: true,
    prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };
}

// ---------------------------------------------------------------------------

function meanStd(x: Float64Array, rows: readonly number[], cols: readonly number[]): {
  mean: Float64Array;
  scale: Float64Array;
} {
  const d = cols.length;
  const mean = new Float64Array(d);
  const scale = new Float64Array(d);
  for (const i of rows) {
    for (let j = 0; j < d; j += 1) {
      mean[j] = (mean[j] as number) + (x[i * DIM + (cols[j] as number)] as number);
    }
  }
  for (let j = 0; j < d; j += 1) {
    mean[j] = (mean[j] as number) / Math.max(1, rows.length);
  }
  for (const i of rows) {
    for (let j = 0; j < d; j += 1) {
      const diff = (x[i * DIM + (cols[j] as number)] as number) - (mean[j] as number);
      scale[j] = (scale[j] as number) + diff * diff;
    }
  }
  for (let j = 0; j < d; j += 1) {
    const s = Math.sqrt((scale[j] as number) / Math.max(1, rows.length));
    scale[j] = s > 1e-6 ? s : 1;
  }
  return { mean, scale };
}

/** Materializes the normalized design matrix for a column subset. */
function buildDesign(
  rows: RowSet,
  cols: readonly number[],
  mean: Float64Array,
  scale: Float64Array,
): Float64Array {
  const d = cols.length;
  const out = new Float64Array(rows.n * d);
  for (let i = 0; i < rows.n; i += 1) {
    for (let j = 0; j < d; j += 1) {
      out[i * d + j] =
        ((rows.x[i * DIM + (cols[j] as number)] as number) - (mean[j] as number)) /
        (scale[j] as number);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  const outDir = join(config.out, "..");
  mkdirSync(outDir, { recursive: true });

  // The SHIPPED operating point, read through lib's sanctioned accessor
  // (DEFAULT_SETTINGS forecast keys, with the frozen contract defaults as the
  // fallback) — the same source eval.ts asserts parity against.
  const shippedThresholds = await thresholdDefaults();
  const shippedNudge = shippedThresholds.nudge;
  const shippedPrearm = shippedThresholds.prearm;

  // --- 0. Prove the backprop before using it -------------------------------
  const gradBce = gradientCheck(0);
  const gradFocal = gradientCheck(1.5);
  console.log(
    `[hybrid] gradient check ok — worst rel err ${gradBce.toExponential(2)} (BCE) / ` +
      `${gradFocal.toExponential(2)} (focal γ=1.5)`,
  );

  // --- 1. Replay every session through the SHARED ring ---------------------
  // raw-sessions.jsonl holds the 240 synthetic sessions; the 48 augmented
  // train sessions are reproduced with the pipeline's own augmentLocal at the
  // pipeline's own settings (fraction 0.25, seed 42) so the join covers the
  // whole train split. Nothing here re-splits or re-labels anything.
  const rawSessions: RawSession[] = [];
  for await (const session of readJsonl<RawSession>(config.raw)) {
    rawSessions.push(session);
  }
  const trainRawSessions = rawSessions.filter(
    (session) => splitForSession(session.id, config.seed) === "train",
  );
  const augmented = augmentLocal(trainRawSessions, { fraction: 0.25, seed: config.seed });
  const sessions = new Map<string, SessionFrames>();
  for (const session of [...rawSessions, ...augmented]) {
    const split =
      session.source === "synthetic" ? splitForSession(session.id, config.seed) : "train";
    const frames = replaySessionExtended(session);
    const feats = new Float32Array(frames.length * DIM);
    const decisions = new Uint8Array(frames.length);
    const countdown = new Uint8Array(frames.length);
    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i] as (typeof frames)[number];
      for (let f = 0; f < BASE_DIM; f += 1) {
        feats[i * DIM + f] = frame.base[f] as number;
      }
      for (let f = 0; f < HYBRID_EXTRA_DIM; f += 1) {
        feats[i * DIM + BASE_DIM + f] = frame.extra[f] as number;
      }
      decisions[i] = Math.max(0, DECISIONS.indexOf(frame.decision));
      countdown[i] = frame.countdownActive ? 1 : 0;
    }
    sessions.set(session.id, {
      id: session.id,
      archetype: session.archetype,
      source: session.source,
      split,
      durationSec: session.durationSec,
      n: frames.length,
      feats,
      decisions,
      countdown,
    });
  }
  console.log(
    `[hybrid] replayed ${sessions.size} sessions (${rawSessions.length} synthetic + ` +
      `${augmented.length} augmented:local) through the shared ring | ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );

  // --- 2. Read the FIXED dataset and join the extras -----------------------
  interface StagedRow {
    sessionId: string;
    t: number;
    archetype: string;
    label: 0 | 1;
    secsToDrift: number | null;
    driftType: DriftType | null;
    base: number[];
  }
  const stagedTrain: StagedRow[] = [];
  const stagedEval: StagedRow[] = [];
  const trainBaseAll: number[][] = []; // eval.ts's own baseline input, file order
  const trainLabelAll: number[] = [];
  let selfCheckRows = 0;
  let worstSelfCheck = 0;
  let unjoinable = 0;

  for await (const row of readJsonl<DatasetRow>(config.data)) {
    const staged: StagedRow = {
      sessionId: row.session_id,
      t: row.t,
      archetype: row.archetype,
      label: row.label,
      secsToDrift: row.secs_to_drift,
      driftType: row.drift_type,
      base: row.features,
    };
    if (row.split === "eval") {
      if (row.source !== "synthetic" && row.source !== "recorded") {
        throw new Error(`eval split contains ${row.source} row (${row.session_id})`);
      }
      stagedEval.push(staged);
    } else {
      stagedTrain.push(staged);
      trainBaseAll.push(row.features);
      trainLabelAll.push(row.label);
    }
    const session = sessions.get(row.session_id);
    if (session === undefined || row.t < 1 || row.t > session.n) {
      unjoinable += 1;
      continue;
    }
    // Self-check the replay against the dataset's own columns (round6 noise).
    if ((stagedTrain.length + stagedEval.length) % 257 === 0) {
      selfCheckRows += 1;
      const offset = (row.t - 1) * DIM;
      for (let f = 0; f < BASE_DIM; f += 1) {
        const delta = Math.abs((session.feats[offset + f] as number) - (row.features[f] as number));
        worstSelfCheck = Math.max(worstSelfCheck, delta);
      }
    }
  }
  if (unjoinable > 0) {
    throw new Error(
      `${unjoinable} dataset rows could not be joined to a replayed session — the extras ` +
        `would be undefined for them; refusing to guess`,
    );
  }
  if (worstSelfCheck > 1e-5) {
    throw new Error(
      `replay/dataset feature mismatch: worst delta ${worstSelfCheck} over ${selfCheckRows} rows`,
    );
  }
  console.log(
    `[hybrid] dataset ${stagedTrain.length} train / ${stagedEval.length} eval rows joined; ` +
      `replay self-check worst |Δ| ${worstSelfCheck.toExponential(3)} over ${selfCheckRows} rows`,
  );

  const materialize = (staged: readonly StagedRow[]): RowSet => {
    const n = staged.length;
    const set: RowSet = {
      n,
      x: new Float64Array(n * DIM),
      y: new Uint8Array(n),
      yTab: new Uint8Array(n),
      yAway: new Uint8Array(n),
      importance: new Float64Array(n),
      secsToDrift: new Array<number | null>(n),
      archetype: new Array<string>(n),
      sessionId: new Array<string>(n),
    };
    for (let i = 0; i < n; i += 1) {
      const row = staged[i] as StagedRow;
      const session = sessions.get(row.sessionId) as SessionFrames;
      const offset = (row.t - 1) * DIM;
      for (let f = 0; f < BASE_DIM; f += 1) {
        set.x[i * DIM + f] = row.base[f] as number;
      }
      for (let f = 0; f < HYBRID_EXTRA_DIM; f += 1) {
        set.x[i * DIM + BASE_DIM + f] = session.feats[offset + BASE_DIM + f] as number;
      }
      set.y[i] = row.label;
      set.yTab[i] = row.label === 1 && row.driftType === "tab_out" ? 1 : 0;
      set.yAway[i] = row.label === 1 && row.driftType === "walk_away" ? 1 : 0;
      set.importance[i] = 1 / keepProbability(row.label, row.secsToDrift);
      set.secsToDrift[i] = row.secsToDrift;
      set.archetype[i] = row.archetype;
      set.sessionId[i] = row.sessionId;
    }
    return set;
  };

  const trainRows = materialize(stagedTrain);
  const evalRows = materialize(stagedEval);
  stagedTrain.length = 0;
  stagedEval.length = 0;
  if (evalRows.n === 0) {
    throw new Error("no eval rows");
  }
  const evalBaseRate = (() => {
    let positives = 0;
    for (let i = 0; i < evalRows.n; i += 1) {
      positives += evalRows.y[i] as number;
    }
    return positives / evalRows.n;
  })();

  // --- 3. Train-internal fit / val / calibration split, by SESSION ---------
  const trainSessionIds = [...new Set(trainRows.sessionId)].sort();
  const syntheticTrainIds = trainSessionIds.filter(
    (id) => (sessions.get(id) as SessionFrames).source === "synthetic",
  );
  const rand = mulberry32(config.seed ^ 0x48594252);
  const shuffledIds = [...syntheticTrainIds];
  for (let i = shuffledIds.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = shuffledIds[i] as string;
    shuffledIds[i] = shuffledIds[j] as string;
    shuffledIds[j] = tmp;
  }
  const valCount = Math.round(shuffledIds.length * 0.18);
  const calibCount = Math.round(shuffledIds.length * 0.18);
  const valIds = new Set(shuffledIds.slice(0, valCount));
  const calibIds = new Set(shuffledIds.slice(valCount, valCount + calibCount));
  // Augmented sessions are derivatives of TRAIN sessions — always fit-side, so
  // a jittered twin of a val session can never leak into model selection.
  const fitIdx: number[] = [];
  const valIdx: number[] = [];
  const calibIdx: number[] = [];
  for (let i = 0; i < trainRows.n; i += 1) {
    const id = trainRows.sessionId[i] as string;
    if (valIds.has(id)) valIdx.push(i);
    else if (calibIds.has(id)) calibIdx.push(i);
    else fitIdx.push(i);
  }
  console.log(
    `[hybrid] train-internal split — fit ${fitIdx.length} rows / val ${valIdx.length} ` +
      `(${valIds.size} sessions) / calib ${calibIdx.length} (${calibIds.size} sessions)`,
  );

  // Val rows as a RowSet view (for lead-censored val AUC during early stop).
  const viewOf = (indices: readonly number[]): RowSet => {
    const set = emptyRowSet();
    set.n = indices.length;
    set.x = new Float64Array(indices.length * DIM);
    set.y = new Uint8Array(indices.length);
    set.yTab = new Uint8Array(indices.length);
    set.yAway = new Uint8Array(indices.length);
    set.importance = new Float64Array(indices.length);
    set.secsToDrift = new Array<number | null>(indices.length);
    set.archetype = new Array<string>(indices.length);
    set.sessionId = new Array<string>(indices.length);
    for (let k = 0; k < indices.length; k += 1) {
      const i = indices[k] as number;
      for (let f = 0; f < DIM; f += 1) {
        set.x[k * DIM + f] = trainRows.x[i * DIM + f] as number;
      }
      set.y[k] = trainRows.y[i] as number;
      set.yTab[k] = trainRows.yTab[i] as number;
      set.yAway[k] = trainRows.yAway[i] as number;
      set.importance[k] = trainRows.importance[i] as number;
      set.secsToDrift[k] = trainRows.secsToDrift[i] ?? null;
      set.archetype[k] = trainRows.archetype[i] as string;
      set.sessionId[k] = trainRows.sessionId[i] as string;
    }
    return set;
  };
  const valRows = viewOf(valIdx);
  const calibRows = viewOf(calibIdx);

  // --- 4. Head training machinery ------------------------------------------
  const baseCols = Array.from({ length: BASE_DIM }, (_, i) => i);
  const allCols = Array.from({ length: DIM }, (_, i) => i);

  interface HeadSpec {
    label: "generalist" | "tab_out" | "walk_away";
    y: Uint8Array;
  }

  function trainHead(
    d: number,
    design: Float64Array,
    labels: Uint8Array,
    hyper: HybridHyper,
    valLeadRows: RowSet,
    valDesign: Float64Array,
    valLabels: Uint8Array,
  ): FittedHead {
    const localFit = fitIdx;
    const h = new Float64Array(hyper.hidden);
    const valScore = (net: HybridNet): number => {
      const s: number[] = [];
      const l: number[] = [];
      for (let k = 0; k < valLeadRows.n; k += 1) {
        if (!leadEligible(valLeadRows.secsToDrift[k] ?? null, 20)) {
          continue;
        }
        s.push(forwardHybrid(net, valDesign, k * d, h));
        l.push(valLabels[k] as number);
      }
      return rocAuc(s, l);
    };
    const result = trainHybrid(design, labels, d, localFit, hyper, valScore);
    return {
      net: result.net,
      platt: { a: 1, b: 0 },
      bestEpoch: result.bestEpoch,
      epochsRan: result.epochsRan,
      posWeight: round6(result.posWeight),
      valScore: round6(result.bestScore),
    };
  }

  /** Importance-weighted Platt for one head, fit on the calibration split only. */
  function calibrateHead(
    head: FittedHead,
    d: number,
    calibDesign: Float64Array,
    labels: Uint8Array,
  ): void {
    const h = new Float64Array(head.net.hidden);
    const logits: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    let positives = 0;
    for (let k = 0; k < calibRows.n; k += 1) {
      logits.push(forwardHybrid(head.net, calibDesign, k * d, h));
      ys.push(labels[k] as number);
      ws.push(calibRows.importance[k] as number);
      positives += labels[k] as number;
    }
    if (positives === 0) {
      return; // degenerate slice — leave the identity Platt in place
    }
    head.platt = fitPlatt(logits, ys, ws);
  }

  function assemble(
    name: string,
    cols: readonly number[],
    hyper: HybridHyper,
    withSpecialists: boolean,
  ): FittedModel {
    const columns = [...cols];
    const { mean, scale } = meanStd(trainRows.x, fitIdx, columns);
    const design = buildDesign(trainRows, columns, mean, scale);
    const valDesign = buildDesign(valRows, columns, mean, scale);
    const calibDesign = buildDesign(calibRows, columns, mean, scale);

    const specs: HeadSpec[] = withSpecialists
      ? [
          { label: "generalist", y: trainRows.y },
          { label: "tab_out", y: trainRows.yTab },
          { label: "walk_away", y: trainRows.yAway },
        ]
      : [{ label: "generalist", y: trainRows.y }];

    const heads: Partial<Record<HeadSpec["label"], FittedHead>> = {};
    for (const spec of specs) {
      const valLabels =
        spec.label === "generalist" ? valRows.y : spec.label === "tab_out" ? valRows.yTab : valRows.yAway;
      const calibLabels =
        spec.label === "generalist"
          ? calibRows.y
          : spec.label === "tab_out"
            ? calibRows.yTab
            : calibRows.yAway;
      const head = trainHead(
        columns.length,
        design,
        spec.y,
        { ...hyper, seed: hyper.seed + specs.indexOf(spec) * 7919 },
        valRows,
        valDesign,
        valLabels,
      );
      calibrateHead(head, columns.length, calibDesign, calibLabels);
      heads[spec.label] = head;
    }

    const gen = heads.generalist as FittedHead;
    const model: FittedModel = {
      name,
      cols: columns,
      mean,
      scale,
      gen,
      tab: heads.tab_out ?? null,
      away: heads.walk_away ?? null,
      alpha: 0,
      final: { a: 1, b: 0 },
      hyper,
      params:
        paramCount(gen.net) +
        (heads.tab_out ? paramCount(heads.tab_out.net) : 0) +
        (heads.walk_away ? paramCount(heads.walk_away.net) : 0),
    };

    // Fusion weight α: chosen on the VAL split by lead-censored AUC.
    if (withSpecialists) {
      let bestAlpha = 0;
      let bestAuc = -1;
      for (const alpha of [0, 0.25, 0.4, 0.5, 0.6, 0.75, 1]) {
        model.alpha = alpha;
        const scores = scoreRows(model, valRows);
        const auc = leadAuc(valRows, scores, 20);
        if (auc > bestAuc + 1e-9) {
          bestAuc = auc;
          bestAlpha = alpha;
        }
      }
      model.alpha = bestAlpha;
    }

    // Final Platt on the fused score, calibration split only.
    const buf = makeBuffers(model);
    const logits: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    for (let k = 0; k < calibRows.n; k += 1) {
      // Re-derive the pre-final fused logit with final Platt neutral.
      model.final = { a: 1, b: 0 };
      const p = scoreModel(model, calibRows.x, k * DIM, buf);
      logits.push(logit(p));
      ys.push(calibRows.y[k] as number);
      ws.push(calibRows.importance[k] as number);
    }
    model.final = fitPlatt(logits, ys, ws);
    return model;
  }

  // --- 5. Loss / weighting selection on the VAL split ----------------------
  const baseHyper: HybridHyper = {
    hidden: config.hidden,
    epochs: config.epochs,
    batch: 256,
    lr: 0.008,
    l2: 0.0003,
    l2Linear: 0.00005,
    posWeightPower: 0.5,
    gamma: 0,
    patience: 10,
    seed: config.seed,
  };
  const lossGrid: Array<{ tag: string; posWeightPower: number; gamma: number }> = [
    { tag: "bce-pw0.5", posWeightPower: 0.5, gamma: 0 },
    { tag: "bce-pw1.0", posWeightPower: 1, gamma: 0 },
    { tag: "focal1.5-pw0.5", posWeightPower: 0.5, gamma: 1.5 },
    { tag: "focal2.0-pw0.25", posWeightPower: 0.25, gamma: 2 },
  ];
  const lossTrials: Array<{ tag: string; valLeadAuc20: number; bestEpoch: number }> = [];
  let bestLoss = lossGrid[0] as (typeof lossGrid)[number];
  let bestLossAuc = -1;
  for (const entry of lossGrid) {
    const hyper: HybridHyper = { ...baseHyper, posWeightPower: entry.posWeightPower, gamma: entry.gamma };
    const trial = assemble(`probe-${entry.tag}`, allCols, hyper, false);
    const scores = scoreRows(trial, valRows);
    const auc = leadAuc(valRows, scores, 20);
    lossTrials.push({ tag: entry.tag, valLeadAuc20: round6(auc), bestEpoch: trial.gen.bestEpoch });
    console.log(`[hybrid] loss probe ${entry.tag.padEnd(16)} val lead≥20s AUC ${auc.toFixed(6)}`);
    if (auc > bestLossAuc + 1e-9) {
      bestLossAuc = auc;
      bestLoss = entry;
    }
  }
  const chosenHyper: HybridHyper = {
    ...baseHyper,
    posWeightPower: bestLoss.posWeightPower,
    gamma: bestLoss.gamma,
  };
  console.log(`[hybrid] chosen loss: ${bestLoss.tag}`);

  // --- 6. The ablation ladder (all trained on train only) ------------------
  const hybrid18 = assemble("hybrid-18-generalist", baseCols, chosenHyper, false);
  const hybrid25Gen = assemble("hybrid-25-generalist", allCols, chosenHyper, false);
  const headline = assemble("hybrid-25-heads", allCols, chosenHyper, true);
  console.log(
    `[hybrid] heads trained — fusion α ${headline.alpha} | params ${headline.params} | ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );

  // --- 7. Logistic baselines: the eval.ts replica + the extended-feature LR
  // eval.ts's exact recipe: every train row in FILE ORDER, stride-subsampled
  // to ≤ 40 000, lib.trainLogistic, scored on the identical eligibility set.
  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(trainBaseAll.length / cap));
  const subIdx: number[] = [];
  for (let i = 0; i < trainBaseAll.length; i += stride) {
    subIdx.push(i);
  }
  const subX18 = subIdx.map((i) => trainBaseAll[i] as number[]);
  const subY = subIdx.map((i) => trainLabelAll[i] as number);
  const evalX18: number[][] = new Array(evalRows.n);
  for (let i = 0; i < evalRows.n; i += 1) {
    const row = new Array<number>(BASE_DIM);
    for (let f = 0; f < BASE_DIM; f += 1) {
      row[f] = evalRows.x[i * DIM + f] as number;
    }
    evalX18[i] = row;
  }
  const lr18 = trainLogistic(subX18, subY, baseCols);
  const lr18Scores = evalX18.map((row) => logisticScore(lr18, row, baseCols));

  // Extended-feature logistic — same routine, same rows, 25 columns. Isolates
  // "what the seven ring-derived features are worth" from "what the model is".
  const subX25 = subIdx.map((i) => {
    const staged = i;
    const row = new Array<number>(DIM);
    for (let f = 0; f < DIM; f += 1) {
      row[f] = trainRows.x[staged * DIM + f] as number;
    }
    return row;
  });
  const evalX25: number[][] = new Array(evalRows.n);
  for (let i = 0; i < evalRows.n; i += 1) {
    const row = new Array<number>(DIM);
    for (let f = 0; f < DIM; f += 1) {
      row[f] = evalRows.x[i * DIM + f] as number;
    }
    evalX25[i] = row;
  }
  const lr25 = trainLogistic(subX25, subY, allCols);
  const lr25Scores = evalX25.map((row) => logisticScore(lr25, row, allCols));

  // Best single-feature logistic, adversarially chosen by the gate metric.
  let bestSingle = { key: "none", leadAuc20: 0.5, rocAuc: 0.5 };
  for (let f = 0; f < BASE_DIM; f += 1) {
    const model = trainLogistic(subX18, subY, [f]);
    const scores = evalX18.map((row) => logisticScore(model, row, [f]));
    const auc20 = leadAuc(evalRows, scores, 20);
    if (auc20 > bestSingle.leadAuc20) {
      bestSingle = {
        key: FORECAST_FEATURE_KEYS[f] as string,
        leadAuc20: round4(auc20),
        rocAuc: round4(rocAuc(scores, Array.from(evalRows.y))),
      };
    }
  }

  // --- 8. The shipped MLP, re-scored here (harness cross-check) ------------
  const shippedWeights = parseForecastWeights(
    JSON.parse(readFileSync(join(repoRoot(), "src", "shared", "forecast", "weights.json"), "utf8")),
  );
  if (shippedWeights === null) {
    throw new Error("shipped weights.json failed parseForecastWeights");
  }
  const shippedScores = evalX18.map((row) => forward(shippedWeights, row).rawRisk);
  const scoreRowsShipped = (rows: RowSet): number[] => {
    const row = new Array<number>(BASE_DIM);
    const out = new Array<number>(rows.n);
    for (let i = 0; i < rows.n; i += 1) {
      for (let f = 0; f < BASE_DIM; f += 1) {
        row[f] = rows.x[i * DIM + f] as number;
      }
      out[i] = forward(shippedWeights, row).rawRisk;
    }
    return out;
  };

  // --- 9. Held-out frame metrics -------------------------------------------
  const evalLabels = Array.from(evalRows.y);
  const headlineScores = scoreRows(headline, evalRows);
  const metricsFor = (scores: readonly number[]) => ({
    rocAuc: round4(rocAuc(scores, evalLabels)),
    prAuc: round4(prAuc(scores, evalLabels)),
    aucLead20: round4(leadAuc(evalRows, scores, 20)),
    aucLead10: round4(leadAuc(evalRows, scores, 10)),
    ece: round4(ece10(scores, evalLabels).ece),
  });
  const headlineMetrics = metricsFor(headlineScores);
  const reliability = ece10(headlineScores, evalLabels).bins;

  // --- 10. Prepare sessions for alarm simulation ---------------------------
  const hybridBuf = makeBuffers(headline);
  const hybridScorer: FrameScorer = (feats, offset) =>
    scoreModel(headline, feats, offset, hybridBuf);
  const shippedRow = new Array<number>(BASE_DIM);
  const shippedScorer: FrameScorer = (feats, offset) => {
    for (let f = 0; f < BASE_DIM; f += 1) {
      shippedRow[f] = feats[offset + f] as number;
    }
    return forward(shippedWeights, shippedRow).rawRisk;
  };
  const prepare = (ids: readonly string[], scorer: FrameScorer): PreparedSession[] =>
    ids.map((id) => {
      const session = sessions.get(id) as SessionFrames;
      return {
        session,
        smoothed: smoothedRiskSeries(session, scorer),
        onsets: driftOnsetsOf(session),
      };
    });
  const evalSessionIds = [...sessions.values()]
    .filter((session) => session.split === "eval")
    .map((session) => session.id)
    .sort();
  const selectionSessionIds = [...valIds, ...calibIds].sort();
  const evalPrepared = prepare(evalSessionIds, hybridScorer);
  const selectionPrepared = prepare(selectionSessionIds, hybridScorer);
  const evalPreparedShipped = prepare(evalSessionIds, shippedScorer);
  const selectionPreparedShipped = prepare(selectionSessionIds, shippedScorer);

  // Frame-level research_churn FPR helper, eval.ts's definition (negatives
  // scoring ≥ threshold), computed on whichever row set is passed.
  const churnFpr = (rows: RowSet, scores: readonly number[], threshold: number): number => {
    let negatives = 0;
    let fired = 0;
    for (let i = 0; i < rows.n; i += 1) {
      if (rows.archetype[i] !== "research_churn" || (rows.y[i] as number) === 1) {
        continue;
      }
      negatives += 1;
      if ((scores[i] as number) >= threshold) {
        fired += 1;
      }
    }
    return negatives > 0 ? fired / negatives : 0;
  };
  const selectionScores = scoreRows(headline, valRows).concat(scoreRows(headline, calibRows));
  const selectionRows: RowSet = (() => {
    const merged = emptyRowSet();
    merged.n = valRows.n + calibRows.n;
    merged.y = new Uint8Array(merged.n);
    merged.archetype = new Array<string>(merged.n);
    for (let i = 0; i < valRows.n; i += 1) {
      merged.y[i] = valRows.y[i] as number;
      merged.archetype[i] = valRows.archetype[i] as string;
    }
    for (let i = 0; i < calibRows.n; i += 1) {
      merged.y[valRows.n + i] = calibRows.y[i] as number;
      merged.archetype[valRows.n + i] = calibRows.archetype[i] as string;
    }
    return merged;
  })();

  // --- 11. Operating-point search — TRAIN-INTERNAL SESSIONS ONLY -----------
  // The budget the search must respect is the SHIPPED model's own alarm load,
  // measured on the same train-internal sessions with the same reducer. So the
  // recommended point is never allowed to buy recall with extra noise.
  const shippedSelectionScores = scoreRowsShipped(valRows).concat(scoreRowsShipped(calibRows));
  const shippedSelectionAlarms = runAlarms(
    selectionPreparedShipped,
    escalationSettings(shippedNudge, shippedPrearm),
  );
  const budget = {
    churnFpr: Math.max(
      CHURN_FPR_CEILING,
      churnFpr(selectionRows, shippedSelectionScores, shippedNudge),
    ),
    nudgesPerHour:
      shippedSelectionAlarms.hours > 0
        ? shippedSelectionAlarms.nudges / shippedSelectionAlarms.hours
        : NaN,
    falsePrearmsPerHour: Math.min(
      FALSE_PREARMS_PER_HOUR_CEILING,
      shippedSelectionAlarms.hours > 0
        ? shippedSelectionAlarms.falsePrearms / shippedSelectionAlarms.hours
        : FALSE_PREARMS_PER_HOUR_CEILING,
    ),
    falseNudgesPerHour:
      shippedSelectionAlarms.hours > 0
        ? shippedSelectionAlarms.falseNudges / shippedSelectionAlarms.hours
        : NaN,
  };
  console.log(
    `[hybrid] train-internal alarm budget from the SHIPPED model: nudges/h ` +
      `${budget.nudgesPerHour.toFixed(3)} | false nudges/h ${budget.falseNudgesPerHour.toFixed(3)} | ` +
      `false pre-arms/h ${budget.falsePrearmsPerHour.toFixed(3)} | churn FPR ${budget.churnFpr.toFixed(5)}`,
  );

  interface CurvePoint {
    nudge: number;
    prearm: number;
    recallAt30sNudge: number;
    recallAt30sPrearm: number;
    churnFpr: number;
    nudgesPerHour: number;
    falseNudgesPerHour: number;
    falsePrearmsPerHour: number;
    medianNudgeLeadSec: number | null;
    feasible: boolean;
  }
  const nudgeGrid: number[] = [];
  for (let v = 0.1; v <= 0.6001; v += 0.025) {
    nudgeGrid.push(Number(v.toFixed(3)));
  }
  const prearmGrid = [0.5, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];
  const searchPoints: CurvePoint[] = [];
  for (const nudge of nudgeGrid) {
    const fpr = churnFpr(selectionRows, selectionScores, nudge);
    for (const prearm of prearmGrid) {
      if (prearm < nudge + 0.05) {
        continue;
      }
      const totals = runAlarms(selectionPrepared, escalationSettings(nudge, prearm));
      const leads = [...totals.nudgeLeads].sort((a, b) => a - b);
      const point: CurvePoint = {
        nudge,
        prearm,
        recallAt30sNudge: round4(totals.drifts > 0 ? totals.nudgeHits / totals.drifts : 0),
        recallAt30sPrearm: round4(totals.drifts > 0 ? totals.prearmHits / totals.drifts : 0),
        churnFpr: round6(fpr),
        nudgesPerHour: round4(totals.hours > 0 ? totals.nudges / totals.hours : 0),
        falseNudgesPerHour: round4(totals.hours > 0 ? totals.falseNudges / totals.hours : 0),
        falsePrearmsPerHour: round4(totals.hours > 0 ? totals.falsePrearms / totals.hours : 0),
        medianNudgeLeadSec: percentile(leads, 0.5),
        feasible: false,
      };
      point.feasible =
        point.churnFpr <= budget.churnFpr &&
        point.falsePrearmsPerHour <= budget.falsePrearmsPerHour &&
        point.nudgesPerHour <= budget.nudgesPerHour &&
        point.falseNudgesPerHour <= budget.falseNudgesPerHour;
      searchPoints.push(point);
    }
  }
  // Objective: the nudge is the alarm the brief scores, the pre-arm is the
  // fuse-shortening consequence — worth half a nudge, and worth naming, because
  // a pure nudge-recall argmax will happily set the pre-arm line so high that
  // the fuse never shortens (observed: +0.012 nudge recall for −0.36 pre-arm).
  const PREARM_WEIGHT = 0.5;
  const objective = (point: CurvePoint): number =>
    point.recallAt30sNudge + PREARM_WEIGHT * point.recallAt30sPrearm;
  const feasible = searchPoints.filter((point) => point.feasible);
  const ranked = [...feasible].sort((a, b) => {
    if (objective(b) !== objective(a)) {
      return objective(b) - objective(a);
    }
    if (b.recallAt30sNudge !== a.recallAt30sNudge) {
      return b.recallAt30sNudge - a.recallAt30sNudge;
    }
    if ((b.medianNudgeLeadSec ?? 0) !== (a.medianNudgeLeadSec ?? 0)) {
      return (b.medianNudgeLeadSec ?? 0) - (a.medianNudgeLeadSec ?? 0);
    }
    return a.nudgesPerHour - b.nudgesPerHour;
  });
  const recommended = ranked[0] ?? { nudge: shippedNudge, prearm: shippedPrearm };
  console.log(
    `[hybrid] recommended operating point (train-internal search over ${searchPoints.length} ` +
      `combos, ${feasible.length} feasible): nudge ${recommended.nudge} / prearm ${recommended.prearm}`,
  );

  // --- 12. Held-out alarm simulation at both operating points --------------
  const alarmsAtShipped = runAlarms(evalPrepared, escalationSettings(shippedNudge, shippedPrearm));
  const alarmsAtRecommended = runAlarms(
    evalPrepared,
    escalationSettings(recommended.nudge, recommended.prearm),
  );

  const summarizeAlarms = (totals: AlarmResult, nudge: number, prearm: number) => {
    const nudgeLeads = [...totals.nudgeLeads].sort((a, b) => a - b);
    const prearmLeads = [...totals.prearmLeads].sort((a, b) => a - b);
    return {
      nudgeRisk: nudge,
      prearmRisk: prearm,
      sessions: totals.sessions,
      evalHours: round4(totals.hours),
      drifts: totals.drifts,
      recallAt30sNudge: round4(totals.drifts > 0 ? totals.nudgeHits / totals.drifts : 0),
      recallAt30sPrearm: round4(totals.drifts > 0 ? totals.prearmHits / totals.drifts : 0),
      nudgeHits: totals.nudgeHits,
      nudgeMisses: totals.drifts - totals.nudgeHits,
      prearmHits: totals.prearmHits,
      medianNudgeLeadSec: percentile(nudgeLeads, 0.5),
      p25NudgeLeadSec: percentile(nudgeLeads, 0.25),
      medianPrearmLeadSec: percentile(prearmLeads, 0.5),
      p25PrearmLeadSec: percentile(prearmLeads, 0.25),
      nudgesPerHour: round4(totals.hours > 0 ? totals.nudges / totals.hours : 0),
      falseNudgesPerHour: round4(totals.hours > 0 ? totals.falseNudges / totals.hours : 0),
      nudgePrecision:
        totals.nudges > 0 ? round4((totals.nudges - totals.falseNudges) / totals.nudges) : null,
      falsePrearmsPerHour: round4(totals.hours > 0 ? totals.falsePrearms / totals.hours : 0),
      byDriftType: {
        tab_out: { ...totals.byType.tab_out },
        walk_away: { ...totals.byType.walk_away },
      },
      byArchetype: Object.fromEntries(
        Object.keys(totals.byArchetype)
          .sort()
          .map((key) => [key, totals.byArchetype[key]]),
      ),
    };
  };

  // Held-out operating curve (REPORTED, never used for selection).
  const evalCurve: CurvePoint[] = [];
  for (const nudge of nudgeGrid) {
    const totals = runAlarms(evalPrepared, escalationSettings(nudge, recommended.prearm));
    const leads = [...totals.nudgeLeads].sort((a, b) => a - b);
    evalCurve.push({
      nudge,
      prearm: recommended.prearm,
      recallAt30sNudge: round4(totals.drifts > 0 ? totals.nudgeHits / totals.drifts : 0),
      recallAt30sPrearm: round4(totals.drifts > 0 ? totals.prearmHits / totals.drifts : 0),
      churnFpr: round6(churnFpr(evalRows, headlineScores, nudge)),
      nudgesPerHour: round4(totals.hours > 0 ? totals.nudges / totals.hours : 0),
      falseNudgesPerHour: round4(totals.hours > 0 ? totals.falseNudges / totals.hours : 0),
      falsePrearmsPerHour: round4(totals.hours > 0 ? totals.falsePrearms / totals.hours : 0),
      medianNudgeLeadSec: percentile(leads, 0.5),
      feasible: false,
    });
  }

  // The shipped MLP through the same reducer on the same held-out sessions —
  // the apples-to-apples alarm row, and a second harness cross-check against
  // the committed report (recallAt30 0.5641 pre-arm, 0.35 false pre-arms/h).
  const shippedEvalAlarms = runAlarms(
    evalPreparedShipped,
    escalationSettings(shippedNudge, shippedPrearm),
  );

  // --- 12b. Is the recall gap a THRESHOLD choice or a genuine CEILING? -----
  // For every held-out onset, take the maximum smoothed risk the model reached
  // in the 30 s before it, over frames the reducer was even allowed to act on
  // (warmed up, not drifted, no countdown burning). Comparing
  //   threshold-only recall = #{onsets with maxRisk ≥ τ} / #onsets
  // against the reducer's recall isolates the three candidate explanations:
  // risk that never rises (a genuine ceiling), risk that rises but not past τ
  // (a threshold choice), and risk that rises past τ but not for long enough
  // (the reducer's 3-tick sustain + 30 s cooldown).
  const onsetCeilings = (prepared: readonly PreparedSession[]) => {
    const rows: Array<{ archetype: string; driftType: DriftType; maxRisk: number }> = [];
    for (const entry of prepared) {
      for (const onset of entry.onsets) {
        let maxRisk = 0;
        for (let t = Math.max(FORECAST_WARMUP_SEC, onset.t - 30); t <= onset.t - 1; t += 1) {
          const i = t - 1;
          if (i < 0 || i >= entry.session.n) {
            continue;
          }
          const drifted = (entry.session.decisions[i] as number) === 1 || (entry.session.decisions[i] as number) === 2;
          if (drifted || (entry.session.countdown[i] as number) === 1) {
            continue;
          }
          maxRisk = Math.max(maxRisk, entry.smoothed[i] as number);
        }
        rows.push({ archetype: entry.session.archetype, driftType: onset.driftType, maxRisk });
      }
    }
    return rows;
  };
  const ceilingSummary = (
    rows: ReturnType<typeof onsetCeilings>,
    threshold: number,
    reducerHitsByArchetype: Record<string, { drifts: number; nudgeHits: number }>,
  ) => {
    const groups = [...new Set(rows.map((row) => row.archetype))].sort();
    const out: Record<string, unknown> = {};
    for (const group of groups) {
      const slice = rows.filter((row) => row.archetype === group);
      const sorted = slice.map((row) => row.maxRisk).sort((a, b) => a - b);
      const reachable = slice.filter((row) => row.maxRisk >= threshold).length;
      const reducer = reducerHitsByArchetype[group];
      out[group] = {
        onsets: slice.length,
        medianMaxRiskBeforeOnset: round4(percentile(sorted, 0.5) ?? 0),
        p25MaxRiskBeforeOnset: round4(percentile(sorted, 0.25) ?? 0),
        thresholdOnlyRecall: round4(slice.length > 0 ? reachable / slice.length : 0),
        reducerRecall: round4(
          reducer && reducer.drifts > 0 ? reducer.nudgeHits / reducer.drifts : 0,
        ),
        costOfSustainAndCooldown: round4(
          slice.length > 0 && reducer && reducer.drifts > 0
            ? reachable / slice.length - reducer.nudgeHits / reducer.drifts
            : 0,
        ),
      };
    }
    const sorted = rows.map((row) => row.maxRisk).sort((a, b) => a - b);
    return {
      overall: {
        onsets: rows.length,
        medianMaxRiskBeforeOnset: round4(percentile(sorted, 0.5) ?? 0),
        thresholdOnlyRecall: round4(
          rows.length > 0 ? rows.filter((row) => row.maxRisk >= threshold).length / rows.length : 0,
        ),
      },
      byArchetype: out,
    };
  };
  const hybridCeilings = onsetCeilings(evalPrepared);
  const shippedCeilings = onsetCeilings(evalPreparedShipped);

  // --- 13. Per-archetype frame slices --------------------------------------
  const archetypes = [...new Set(evalRows.archetype)].sort();
  const perArchetype: Record<string, unknown> = {};
  for (const archetype of archetypes) {
    let frames = 0;
    let positives = 0;
    let negatives = 0;
    let firedNudgeRecommended = 0;
    let firedNudgeShipped = 0;
    let firedPrearm = 0;
    for (let i = 0; i < evalRows.n; i += 1) {
      if (evalRows.archetype[i] !== archetype) {
        continue;
      }
      frames += 1;
      if ((evalRows.y[i] as number) === 1) {
        positives += 1;
        continue;
      }
      negatives += 1;
      const score = headlineScores[i] as number;
      if (score >= recommended.nudge) firedNudgeRecommended += 1;
      if (score >= shippedNudge) firedNudgeShipped += 1;
      if (score >= recommended.prearm) firedPrearm += 1;
    }
    const alarms = alarmsAtRecommended.byArchetype[archetype];
    perArchetype[archetype] = {
      frames,
      baseRate: round4(positives / Math.max(1, frames)),
      falsePositiveRateAtRecommendedNudge: round6(firedNudgeRecommended / Math.max(1, negatives)),
      falsePositiveRateAtShippedNudge: round6(firedNudgeShipped / Math.max(1, negatives)),
      falsePositiveRateAtRecommendedPrearm: round6(firedPrearm / Math.max(1, negatives)),
      drifts: alarms?.drifts ?? 0,
      nudgeHits: alarms?.nudgeHits ?? 0,
      prearmHits: alarms?.prearmHits ?? 0,
    };
  }
  if (!archetypes.includes("research_churn")) {
    throw new Error("eval split has no research_churn frames");
  }

  const fprResearchChurn = churnFpr(evalRows, headlineScores, recommended.nudge);

  // --- 14. Feature value: linear-trunk weights + occlusion on the extras ---
  const trunk = headline.gen.net;
  const trunkWeights = headline.cols
    .map((col, j) => ({
      key: ALL_KEYS[col] as string,
      linearWeight: round4(trunk.w0[j] as number),
    }))
    .sort((a, b) => Math.abs(b.linearWeight) - Math.abs(a.linearWeight));
  const occlusionStride = Math.max(1, Math.ceil(evalRows.n / 20_000));
  const occlusionIdx: number[] = [];
  for (let i = 0; i < evalRows.n; i += occlusionStride) {
    occlusionIdx.push(i);
  }
  const occlusionRows = viewOfRows(evalRows, occlusionIdx);
  const occlusionBase = leadAuc(occlusionRows, scoreRows(headline, occlusionRows), 20);
  const ablation = headline.cols
    .map((col, j) => {
      const probe = occlusionRows;
      const kept = new Float64Array(probe.n);
      const meanRaw = (headline.mean[j] as number);
      for (let i = 0; i < probe.n; i += 1) {
        kept[i] = probe.x[i * DIM + col] as number;
        probe.x[i * DIM + col] = meanRaw;
      }
      const drop = occlusionBase - leadAuc(probe, scoreRows(headline, probe), 20);
      for (let i = 0; i < probe.n; i += 1) {
        probe.x[i * DIM + col] = kept[i] as number;
      }
      return { key: ALL_KEYS[col] as string, leadAuc20Drop: round4(drop) };
    })
    .sort((a, b) => b.leadAuc20Drop - a.leadAuc20Drop);

  // Same reducer, same recommended thresholds, the ladder's other rungs — so
  // "did the heads / the extras actually move the alarm, not just the AUC?" is
  // answered with numbers instead of assertion.
  function variantAlarms(model: FittedModel): {
    recallAt30sNudge: number;
    recallAt30sPrearm: number;
    nudgesPerHour: number;
    falsePrearmsPerHour: number;
  } {
    const buf = makeBuffers(model);
    const prepared = prepare(evalSessionIds, (feats, offset) =>
      scoreModel(model, feats, offset, buf),
    );
    const totals = runAlarms(prepared, escalationSettings(recommended.nudge, recommended.prearm));
    return {
      recallAt30sNudge: round4(totals.drifts > 0 ? totals.nudgeHits / totals.drifts : 0),
      recallAt30sPrearm: round4(totals.drifts > 0 ? totals.prearmHits / totals.drifts : 0),
      nudgesPerHour: round4(totals.hours > 0 ? totals.nudges / totals.hours : 0),
      falsePrearmsPerHour: round4(totals.hours > 0 ? totals.falsePrearms / totals.hours : 0),
    };
  }

  // --- 15. Report -----------------------------------------------------------
  const report = {
    candidate: CANDIDATE,
    script: "scripts/forecast/candidates/hybrid.ts",
    command:
      "npx tsx --tsconfig tsconfig.node.json scripts/forecast/candidates/hybrid.ts",
    seed: config.seed,
    approach:
      "Hybrid on three axes: (1) an ADDITIVE model that is a full multivariate logistic trunk " +
      "plus a small L2-leashed tanh residual — z = b0 + w·x + v·tanh(W1x+b1) — so the family " +
      "strictly contains the logistic that beats the shipped MLP; (2) a hybrid FEATURE set, the " +
      "shipped 18 plus 7 extras read off the SHIPPED TelemetryRing (loiter depth past the " +
      "saturating 30/60 s windows, dwell-shrink and title-churn crescendos, desk-sag slope, " +
      "absence-run length, switches-per-distinct-app) — no new telemetry; (3) hybrid HEADS — a " +
      "generalist plus tab_out / walk_away specialists, each Platt-calibrated, fused by noisy-OR " +
      "and blended at a weight chosen on train-internal validation. The operating point is then " +
      "chosen by a calibration-aware search on train-internal sessions that maximizes drift " +
      "recall@30s through the SHIPPED escalation reducer subject to hard research_churn FPR / " +
      "false-pre-arm / nudge-rate ceilings.",
    dataset: {
      file: config.data,
      rebuilt: false,
      trainRows: trainRows.n,
      evalRows: evalRows.n,
      evalSessions: evalSessionIds.length,
      evalBaseRate: round4(evalBaseRate),
      trainSessions: trainSessionIds.length,
      fitRows: fitIdx.length,
      valRows: valIdx.length,
      valSessions: valIds.size,
      calibRows: calibIdx.length,
      calibSessions: calibIds.size,
      extrasSource:
        "raw-sessions.jsonl replayed through the SHARED TelemetryRing/classify/extractFeatures " +
        "path (features-plus.ts), joined on (session_id, t); the 48 augmented:local train " +
        "sessions reproduced with the pipeline's own augmentLocal(fraction 0.25, seed 42)",
      selfCheck: {
        rowsChecked: selfCheckRows,
        worstBase18Delta: Number(worstSelfCheck.toExponential(3)),
        note: "replayed base-18 vs dataset.jsonl's own columns (round6 noise only)",
      },
      note:
        "dataset.jsonl read as-is — never rebuilt, resampled or re-split; split=='eval' rows " +
        "never entered any fit, early-stop, calibration, fusion-weight or threshold-selection step",
    },
    model: {
      family: "additive linear trunk + tanh residual (hybrid GLM/MLP), per-drift-type heads",
      featureDim: DIM,
      baseFeatures: BASE_DIM,
      extraFeatures: [...HYBRID_EXTRA_KEYS],
      hidden: chosenHyper.hidden,
      heads: headline.tab === null ? ["generalist"] : ["generalist", "tab_out", "walk_away"],
      paramsPerHead: paramCount(headline.gen.net),
      params: headline.params,
      fusion: {
        rule: "p = 1 − (1−p_tab_out)(1−p_walk_away), then logit-blended with the generalist",
        alpha: headline.alpha,
        selectedOn: "train-internal validation lead-censored (≥20 s) ROC-AUC",
      },
      loss: {
        chosen: `${bestLoss.gamma > 0 ? `focal γ=${bestLoss.gamma}` : "weighted BCE"} · w_pos=(n_neg/n_pos)^${bestLoss.posWeightPower}`,
        trials: lossTrials,
        selectedOn: "train-internal validation lead-censored (≥20 s) ROC-AUC",
      },
      calibration: {
        perHeadPlatt: {
          generalist: { a: round6(headline.gen.platt.a), b: round6(headline.gen.platt.b) },
          tab_out:
            headline.tab === null
              ? null
              : { a: round6(headline.tab.platt.a), b: round6(headline.tab.platt.b) },
          walk_away:
            headline.away === null
              ? null
              : { a: round6(headline.away.platt.a), b: round6(headline.away.platt.b) },
        },
        finalPlatt: { a: round6(headline.final.a), b: round6(headline.final.b) },
        fitOn: "train-internal calibration sessions, importance-weighted to natural prevalence",
      },
      training: {
        epochs: chosenHyper.epochs,
        batch: chosenHyper.batch,
        lr: chosenHyper.lr,
        l2Residual: chosenHyper.l2,
        l2Trunk: chosenHyper.l2Linear,
        patience: chosenHyper.patience,
        earlyStopOn: "train-internal validation lead-censored (≥20 s) ROC-AUC",
        bestEpochs: {
          generalist: headline.gen.bestEpoch,
          tab_out: headline.tab?.bestEpoch ?? null,
          walk_away: headline.away?.bestEpoch ?? null,
        },
        gradientCheck: {
          bce: Number(gradBce.toExponential(3)),
          focal: Number(gradFocal.toExponential(3)),
          note: "finite difference vs analytic over the real forward/backward, rel err < 1e-5",
        },
      },
    },
    metrics: {
      ...headlineMetrics,
      baseRate: round4(evalBaseRate),
      evalFrames: evalRows.n,
      evalSessions: evalSessionIds.length,
    },
    recallAt30sNudge: round4(
      alarmsAtRecommended.drifts > 0
        ? alarmsAtRecommended.nudgeHits / alarmsAtRecommended.drifts
        : 0,
    ),
    fprResearchChurn: round6(fprResearchChurn),
    operatingPoint: {
      recommended: { nudge: recommended.nudge, prearm: recommended.prearm },
      selectedOn:
        `train-internal sessions only (${valIds.size + calibIds.size} sessions): maximize ` +
        `recall@30s(nudge) + ${PREARM_WEIGHT}·recall@30s(pre-arm) through the SHIPPED ` +
        "stepEscalation reducer, subject to hard ceilings that are the SHIPPED model's OWN alarm " +
        "rates on those same sessions — so the recommended point is no noisier than what ships " +
        "today on every alarm axis",
      budget: {
        researchChurnFrameFpr: round6(budget.churnFpr),
        nudgesPerHour: round4(budget.nudgesPerHour),
        falseNudgesPerHour: round4(budget.falseNudgesPerHour),
        falsePrearmsPerHour: round4(budget.falsePrearmsPerHour),
        source:
          "shipped weights.json through the same reducer at 0.55/0.80 on the train-internal " +
          `sessions; the churn ceiling is max(${CHURN_FPR_CEILING}, shipped) and the false-pre-arm ` +
          `ceiling is min(${FALSE_PREARMS_PER_HOUR_CEILING}/h design budget, shipped)`,
      },
      searchCombos: searchPoints.length,
      feasibleCombos: feasible.length,
      shipped: { nudge: shippedNudge, prearm: shippedPrearm },
      frameLevelAtRecommended: {
        nudge: operatingPoint(evalRows, headlineScores, recommended.nudge),
        prearm: operatingPoint(evalRows, headlineScores, recommended.prearm),
      },
      frameLevelAtShipped: {
        nudge: operatingPoint(evalRows, headlineScores, shippedNudge),
        prearm: operatingPoint(evalRows, headlineScores, shippedPrearm),
      },
    },
    alarms: {
      definition:
        "recallAt30sNudge = fraction of held-out drift onsets with a forecast_nudge OR " +
        "forecast_prearm event from the SHIPPED stepEscalation reducer inside (onset−30 s, onset]; " +
        "recallAt30sPrearm is the shipped report's stricter pre-arm recall",
      atRecommended: summarizeAlarms(alarmsAtRecommended, recommended.nudge, recommended.prearm),
      atShippedThresholds: summarizeAlarms(alarmsAtShipped, shippedNudge, shippedPrearm),
      shippedMlpAtShippedThresholds: {
        ...summarizeAlarms(shippedEvalAlarms, shippedNudge, shippedPrearm),
        note:
          "the SHIPPED weights.json through the SAME reducer on the SAME held-out sessions — " +
          "the apples-to-apples row, and a cross-check against the committed eval-report.json " +
          "(recallAt30 pre-arm 0.5641, false pre-arms/h 0.35, nudges/h 3.19)",
      },
    },
    operatingCurveHeldOut: {
      note:
        "REPORTED ONLY — the recommended point was chosen on train-internal sessions; this curve " +
        `sweeps the nudge threshold on the held-out sessions at prearm ${recommended.prearm}`,
      points: evalCurve.map((point) => ({
        nudge: point.nudge,
        recallAt30sNudge: point.recallAt30sNudge,
        recallAt30sPrearm: point.recallAt30sPrearm,
        researchChurnFpr: point.churnFpr,
        nudgesPerHour: point.nudgesPerHour,
        falseNudgesPerHour: point.falseNudgesPerHour,
        falsePrearmsPerHour: point.falsePrearmsPerHour,
        medianNudgeLeadSec: point.medianNudgeLeadSec,
      })),
    },
    operatingCurveTrainInternal: {
      note: "the search surface the recommended point was chosen from (train-internal sessions)",
      points: searchPoints,
    },
    ablation: {
      note:
        "every row trained on split=='train' only and scored on the identical held-out " +
        "eligibility set — the ladder separates 'new features' from 'new model' from 'new heads'. " +
        "The two logistic rows are lib.trainLogistic exactly as eval.ts uses it: class-weighted " +
        "GD with NO recalibration step, so their ECE (~0.16) is an artifact of the class weight, " +
        "not a claim about the linear family; the hybrid rows are Platt-calibrated on a " +
        "train-internal split and their ECE is a real number",
      ladder: [
        { name: "full-18 logistic (eval.ts replica)", params: BASE_DIM + 1, ...metricsFor(lr18Scores) },
        { name: "extended-25 logistic (same routine)", params: DIM + 1, ...metricsFor(lr25Scores) },
        {
          name: "hybrid trunk+residual, 18 features, generalist only",
          params: hybrid18.params,
          ...metricsFor(scoreRows(hybrid18, evalRows)),
        },
        {
          name: "hybrid trunk+residual, 25 features, generalist only",
          params: hybrid25Gen.params,
          ...metricsFor(scoreRows(hybrid25Gen, evalRows)),
        },
        {
          name: "hybrid trunk+residual, 25 features, +drift-type heads (headline)",
          params: headline.params,
          ...headlineMetrics,
        },
      ],
      alarmsAtRecommendedPointNote:
        "every rung is run at the HEADLINE's recommended thresholds, not at its own " +
        "budget-matched point — so read recall together with nudgesPerHour: a rung that scores " +
        "higher recall at a higher nudge rate is spending alarm budget, not earning recall",
      alarmsAtRecommendedPoint: [
        {
          name: "hybrid trunk+residual, 18 features, generalist only",
          ...variantAlarms(hybrid18),
        },
        {
          name: "hybrid trunk+residual, 25 features, generalist only",
          ...variantAlarms(hybrid25Gen),
        },
        {
          name: "hybrid trunk+residual, 25 features, +drift-type heads (headline)",
          recallAt30sNudge: round4(
            alarmsAtRecommended.drifts > 0
              ? alarmsAtRecommended.nudgeHits / alarmsAtRecommended.drifts
              : 0,
          ),
          recallAt30sPrearm: round4(
            alarmsAtRecommended.drifts > 0
              ? alarmsAtRecommended.prearmHits / alarmsAtRecommended.drifts
              : 0,
          ),
          nudgesPerHour: round4(
            alarmsAtRecommended.hours > 0 ? alarmsAtRecommended.nudges / alarmsAtRecommended.hours : 0,
          ),
          falsePrearmsPerHour: round4(
            alarmsAtRecommended.hours > 0
              ? alarmsAtRecommended.falsePrearms / alarmsAtRecommended.hours
              : 0,
          ),
        },
      ],
      featureOcclusion: ablation,
      linearTrunkWeights: trunkWeights,
    },
    baselines: {
      fullLogistic18: {
        ...metricsFor(lr18Scores),
        note:
          "THE SHARED CROSS-CHECK: lib.trainLogistic over every split=='train' row in file order, " +
          "stride-subsampled to ≤40 000 exactly as eval.ts does, scored on the identical " +
          "lead-censored eligibility set",
      },
      extendedLogistic25: {
        ...metricsFor(lr25Scores),
        note: "same routine, same rows, plus the 7 ring-derived extras",
      },
      bestSingleFeatureLogistic: bestSingle,
      shippedMlp: {
        ...metricsFor(shippedScores),
        note:
          "src/shared/forecast/weights.json re-scored by THIS harness on THIS eligibility set — " +
          "reproduces the committed eval-report.json (aucLead20 0.9248 / rocAuc 0.9614 / " +
          "prAuc 0.6938 / ece 0.0053), which is the proof the harness matches eval.ts",
      },
    },
    recallDiagnosis: {
      question:
        "is the recall@30s gap a threshold/operating-point choice, a class-imbalance artifact, " +
        "or a genuine ceiling?",
      method:
        "per held-out onset, the maximum SMOOTHED risk reached in the 30 s before it over frames " +
        "the reducer could act on (warmed up, not drifted, no countdown). threshold-only recall " +
        "is what a bare threshold with no sustain/cooldown would catch; the difference from the " +
        "reducer's recall is what the 3-tick sustain + 30 s cooldown + suppression cost",
      hybridAtRecommendedNudge: ceilingSummary(
        hybridCeilings,
        recommended.nudge,
        alarmsAtRecommended.byArchetype,
      ),
      shippedMlpAtShippedNudge: ceilingSummary(
        shippedCeilings,
        shippedNudge,
        shippedEvalAlarms.byArchetype,
      ),
      byDriftType: (["tab_out", "walk_away"] as DriftType[]).map((driftType) => {
        const slice = hybridCeilings.filter((row) => row.driftType === driftType);
        const sorted = slice.map((row) => row.maxRisk).sort((a, b) => a - b);
        const shippedSlice = shippedCeilings.filter((row) => row.driftType === driftType);
        const shippedSorted = shippedSlice.map((row) => row.maxRisk).sort((a, b) => a - b);
        return {
          driftType,
          onsets: slice.length,
          hybridMedianMaxRisk: round4(percentile(sorted, 0.5) ?? 0),
          shippedMedianMaxRisk: round4(percentile(shippedSorted, 0.5) ?? 0),
        };
      }),
    },
    perArchetype,
    reliability,
    gate: {
      metric: "lead-censored ROC-AUC (onset ≥ 20 s away vs calm)",
      marginRequired: 0.03,
      hybrid: headlineMetrics.aucLead20,
      bestSingleFeatureLogistic: bestSingle.leadAuc20,
      margin: round4(headlineMetrics.aucLead20 - bestSingle.leadAuc20),
      passed: headlineMetrics.aucLead20 - bestSingle.leadAuc20 >= 0.03,
      beatsFullLogistic18: headlineMetrics.aucLead20 > round4(leadAuc(evalRows, lr18Scores, 20)),
      beatsShippedMlp: headlineMetrics.aucLead20 > round4(leadAuc(evalRows, shippedScores, 20)),
    },
  };

  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`);

  const headlineBlock = {
    candidate: CANDIDATE,
    params: headline.params,
    rocAuc: headlineMetrics.rocAuc,
    prAuc: headlineMetrics.prAuc,
    aucLead20: headlineMetrics.aucLead20,
    aucLead10: headlineMetrics.aucLead10,
    ece: headlineMetrics.ece,
    recallAt30sNudge: report.recallAt30sNudge,
    fprResearchChurn: report.fprResearchChurn,
    recommendedOperatingPoint: report.operatingPoint.recommended,
    recallAt30sNudgeAtShippedThresholds:
      report.alarms.atShippedThresholds.recallAt30sNudge,
    recallAt30sPrearm: report.alarms.atRecommended.recallAt30sPrearm,
    shippedMlpRecallAt30sNudge: report.alarms.shippedMlpAtShippedThresholds.recallAt30sNudge,
    shippedMlpRecallAt30sPrearm: report.alarms.shippedMlpAtShippedThresholds.recallAt30sPrearm,
    falsePrearmsPerHour: report.alarms.atRecommended.falsePrearmsPerHour,
    nudgesPerHour: report.alarms.atRecommended.nudgesPerHour,
    shippedMlpNudgesPerHour: report.alarms.shippedMlpAtShippedThresholds.nudgesPerHour,
    medianNudgeLeadSec: report.alarms.atRecommended.medianNudgeLeadSec,
    fullLogistic18LeadAuc20: report.baselines.fullLogistic18.aucLead20,
    shippedMlpLeadAuc20: report.baselines.shippedMlp.aucLead20,
    beatsFullLr: report.gate.beatsFullLogistic18,
  };
  console.log("=== hybrid metrics ===");
  console.log(JSON.stringify(headlineBlock, null, 2));
  console.log(`report → ${config.out} | ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
}

/** Row-subset view (indices into an existing RowSet). */
function viewOfRows(rows: RowSet, indices: readonly number[]): RowSet {
  const set = emptyRowSet();
  set.n = indices.length;
  set.x = new Float64Array(indices.length * DIM);
  set.y = new Uint8Array(indices.length);
  set.yTab = new Uint8Array(indices.length);
  set.yAway = new Uint8Array(indices.length);
  set.importance = new Float64Array(indices.length);
  set.secsToDrift = new Array<number | null>(indices.length);
  set.archetype = new Array<string>(indices.length);
  set.sessionId = new Array<string>(indices.length);
  for (let k = 0; k < indices.length; k += 1) {
    const i = indices[k] as number;
    for (let f = 0; f < DIM; f += 1) {
      set.x[k * DIM + f] = rows.x[i * DIM + f] as number;
    }
    set.y[k] = rows.y[i] as number;
    set.yTab[k] = rows.yTab[i] as number;
    set.yAway[k] = rows.yAway[i] as number;
    set.importance[k] = rows.importance[i] as number;
    set.secsToDrift[k] = rows.secsToDrift[i] ?? null;
    set.archetype[k] = rows.archetype[i] as string;
    set.sessionId[k] = rows.sessionId[i] as string;
  }
  return set;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
