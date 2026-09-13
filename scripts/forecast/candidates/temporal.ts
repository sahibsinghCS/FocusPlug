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
import { findDriftOnsets, type DecisionFrame, type DriftOnset } from "../../../src/shared/forecast/labels";
import { forward as mlpForward, parseForecastWeights } from "../../../src/shared/forecast/model";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_WARMUP_SEC,
  type ForecastEvent,
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
  prAuc,
  percentile,
  readJsonl,
  repoRoot,
  replaySession,
  rocAuc,
  round4,
  round6,
  shuffled,
  splitForSession,
  stringArg,
  thresholdDefaults,
  trainLogistic,
  type DatasetRow,
  type RawSession,
  type ReplayFrame,
} from "../lib";
import {
  CHANNEL_COUNT,
  CONTEXT_FEATURE_INDEX,
  CONTEXT_KEYS,
  TEMPORAL_CHANNEL_KEYS,
  buildChannels,
} from "./temporal/channels";
import {
  Adam,
  TemporalNet,
  bceGrad,
  gradientCheck,
  type TemporalArch,
  type TemporalGrads,
} from "./temporal/convnet";
import {
  TEMPORAL_MODEL_VERSION,
  parseTemporalWeights,
  temporalEnsembleForward,
  type TemporalWeightsFile,
} from "./temporal/forward";

/**
 * GAUNTLET CONTENDER — "temporal".
 *
 * Thesis: the shipped 18→12→1 MLP loses to a plain 18-feature logistic
 * regression (0.9248 vs 0.9325 lead-censored AUC) because it is fed
 * PRE-DIGESTED window aggregates. Eighteen hand-picked statistics over
 * hand-picked 15/30/60 s windows are already an almost-linear summary of the
 * world, so a 241-param net on top of them has nothing left to learn that a
 * GLM cannot. The fix is not a bigger head — it is a rawer INPUT.
 *
 * This contender feeds the network the last 120 SECONDS of the 1 Hz telemetry
 * itself (12 channels: focus-class one-hot, per-second process switches,
 * per-second title-hash changes, dwell, webcam-on, policy presence verdicts,
 * desk confidence, drifted flag) and learns its own temporal filters with a
 * hand-rolled strided 1-D CNN (forward + backward + Adam in float64, no new
 * dependencies; a portable pure-TS forward pass is exported for the browser).
 * A convolution can see a RAMP — desk confidence sagging, dwell shrinking,
 * title churn accelerating — which a mean-over-30 s structurally cannot.
 *
 * Honesty protocol (identical to the shipped pipeline):
 *  - `data/forecast/dataset.jsonl` is read as-is: never rebuilt, resampled or
 *    re-split. Rows with `split:"eval"` are scored and NOTHING else;
 *  - sequence context comes from replaying the SAME raw sessions the dataset
 *    was built from through the SHARED ring/extractor (`replaySession`), and
 *    the replayed 18-feature vectors are asserted equal to the dataset's own
 *    columns before anything is trained;
 *  - the 48 `augmented:local` train sessions are reproduced deterministically
 *    with the shared `augmentLocal` (verified against the dataset's own rows),
 *    so this contender trains on exactly the rows train.ts trains on;
 *  - every selection decision (epoch, variant, ensemble, operating point) is
 *    made on a train-internal validation split of 20 % of TRAIN sessions, and
 *    `--tune` mode does not score the eval split at all;
 *  - metrics reuse `lib.ts` (`rocAuc`, `prAuc`, `ece10`) and eval.ts's
 *    lead-censored eligibility rule verbatim;
 *  - the full-18 logistic is re-fit here exactly the way eval.ts fits it, as
 *    the shared cross-check number, and the shipped weights.json is re-scored
 *    here too rather than quoted from the committed report;
 *  - the headline AUC ships with a SESSION-clustered bootstrap CI, because 48
 *    held-out sessions carrying 78 drift episodes cannot resolve small gaps.
 *
 * Three input variants are trained (pure sequence / + 4 session-scale scalars
 * / + all 18 shipped aggregates) and the val split also ranks their mean-risk
 * ensemble; whichever wins on val is the headline. Every variant, and the
 * ensemble, is reported.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/candidates/temporal.ts
 *   …--tune  → train + print VAL metrics only (eval split never scored)
 */

const CANDIDATE = "temporal";
const GATE_MARGIN = 0.03;
const LEAD_SEC = 20;

interface Config {
  data: string;
  raw: string;
  outDir: string;
  seed: number;
  seqLen: number;
  epochs: number;
  batch: number;
  lr: number;
  lrFloor: number;
  l2: number;
  patience: number;
  negRate: number;
  valFraction: number;
  posWeightPower: number;
  filters: number;
  kernel1: number;
  stride1: number;
  variants: string[];
  seeds: number[];
  tune: boolean;
}

function readConfig(): Config {
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    outDir: stringArg("--out", join(forecastDataRoot(), "candidates", CANDIDATE)),
    seed: numberArg("--seed", 42),
    seqLen: numberArg("--seq-len", 120),
    epochs: numberArg("--epochs", 14),
    batch: numberArg("--batch", 96),
    lr: numberArg("--lr", 0.004),
    // Cosine decay floor — the tail of the schedule is what stops the val
    // curve from thrashing, so the last epochs are a stable place to stop.
    lrFloor: numberArg("--lr-floor", 0.04),
    l2: numberArg("--l2", 0.00003),
    patience: numberArg("--patience", 8),
    // Fraction of fit-split negatives drawn per epoch (each carries weight
    // 1/negRate, so the expected loss equals the full-data loss).
    negRate: numberArg("--neg-rate", 0.35),
    // 20 % (not train.ts's 10 %): EVERY selection here — epoch, variant,
    // ensemble, operating point — is made on this split, and 24 sessions
    // hold too few drift episodes to choose on.
    valFraction: numberArg("--val", 0.2),
    posWeightPower: numberArg("--pos-weight-power", 0.5),
    filters: numberArg("--filters", 16),
    kernel1: numberArg("--k1", 10),
    stride1: numberArg("--s1", 5),
    variants: stringArg("--variants", "seq,seq+ctx,seq+f18").split(","),
    seeds: stringArg("--seeds", "42")
      .split(",")
      .map((s) => Number(s.trim()))
      .filter((s) => Number.isFinite(s)),
    // Tuning mode stops after training and prints VAL metrics only — the
    // held-out split is not even scored, so hyperparameters cannot be
    // chosen on it, not even by accident.
    tune: process.argv.includes("--tune"),
  };
}

// ---------------------------------------------------------------------------
// Session store: replayed frames + raw per-second channels
// ---------------------------------------------------------------------------

interface SessionData {
  id: string;
  archetype: string;
  source: string;
  split: "train" | "eval";
  duration: number;
  /** (seqLen-1 + duration) × CHANNEL_COUNT, row-major, z-scored in place. */
  channels: Float64Array;
  /** duration × 18 encoded features (pre-normalization), from the shared extractor. */
  feats: Float64Array;
  decisions: Decision[];
  countdown: Uint8Array;
  onsets: DriftOnset[];
}

function buildSessionData(
  session: RawSession,
  split: "train" | "eval",
  pad: number,
): SessionData {
  const frames: ReplayFrame[] = replaySession(session);
  const duration = frames.length;
  const feats = new Float64Array(duration * FORECAST_FEATURE_KEYS.length);
  const decisions: Decision[] = new Array<Decision>(duration);
  const countdown = new Uint8Array(duration);
  const decisionFrames: DecisionFrame[] = [];
  for (let i = 0; i < duration; i += 1) {
    const frame = frames[i] as ReplayFrame;
    for (let f = 0; f < FORECAST_FEATURE_KEYS.length; f += 1) {
      feats[i * FORECAST_FEATURE_KEYS.length + f] = frame.values[f] as number;
    }
    decisions[i] = frame.decision;
    countdown[i] = frame.countdownActive ? 1 : 0;
    decisionFrames.push({ t: frame.t, decision: frame.decision, countdownActive: frame.countdownActive });
  }
  return {
    id: session.id,
    archetype: session.archetype,
    source: session.source,
    split,
    duration,
    channels: buildChannels(session, frames, pad),
    feats,
    decisions,
    countdown,
    onsets: findDriftOnsets(decisionFrames),
  };
}

// ---------------------------------------------------------------------------
// Variants: what the dense head sees beside the learned sequence embedding
// ---------------------------------------------------------------------------

interface VariantSpec {
  name: string;
  /** Indices into FORECAST_FEATURE_KEYS appended to the pooled embedding. */
  extraFeatureIndex: number[];
  extraKeys: string[];
  note: string;
}

function variantSpec(name: string): VariantSpec {
  if (name === "seq") {
    return {
      name,
      extraFeatureIndex: [],
      extraKeys: [],
      note: "pure sequence — zero hand-engineered features reach the model",
    };
  }
  if (name === "seq+ctx") {
    return {
      name,
      extraFeatureIndex: [...CONTEXT_FEATURE_INDEX],
      extraKeys: [...CONTEXT_KEYS],
      note: "sequence + 4 session-scale scalars the window cannot contain",
    };
  }
  if (name === "seq+f18") {
    return {
      name,
      extraFeatureIndex: FORECAST_FEATURE_KEYS.map((_, i) => i),
      extraKeys: [...FORECAST_FEATURE_KEYS],
      note: "sequence fused with all 18 shipped aggregates (late fusion)",
    };
  }
  throw new Error(`unknown variant ${name}`);
}

// ---------------------------------------------------------------------------
// Metrics helpers (eval.ts's rules, verbatim)
// ---------------------------------------------------------------------------

interface ScoreRow {
  sessionIdx: number;
  t: number;
  label: 0 | 1;
  secsToDrift: number | null;
  archetype: string;
}

function leadAuc(rows: readonly ScoreRow[], scores: readonly number[], leadSec: number): number {
  const s: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as ScoreRow;
    if (row.secsToDrift === null || row.secsToDrift >= leadSec) {
      s.push(scores[i] as number);
      y.push(row.label);
    }
  }
  return rocAuc(s, y);
}

function operatingPoint(
  rows: readonly ScoreRow[],
  scores: readonly number[],
  threshold: number,
): { threshold: number; precision: number | null; recall: number; fpr: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const fired = (scores[i] as number) >= threshold;
    if ((rows[i] as ScoreRow).label === 1) {
      fired ? (tp += 1) : (fn += 1);
    } else {
      fired ? (fp += 1) : (tn += 1);
    }
  }
  return {
    threshold,
    precision: tp + fp > 0 ? round4(tp / (tp + fp)) : null,
    recall: round4(tp + fn > 0 ? tp / (tp + fn) : 0),
    fpr: round4(fp + tn > 0 ? fp / (fp + tn) : 0),
  };
}

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/** Importance-weighted Platt scaling (Newton) — same fit train.ts uses. */
function fitPlatt(
  logits: readonly number[],
  labels: readonly number[],
  weights: readonly number[],
): { a: number; b: number } {
  let a = 1;
  let b = 0;
  for (let iter = 0; iter < 100; iter += 1) {
    let ga = 0;
    let gb = 0;
    let haa = 1e-9;
    let hab = 0;
    let hbb = 1e-9;
    for (let i = 0; i < logits.length; i += 1) {
      const z = logits[i] as number;
      const w = weights[i] as number;
      const p = sigmoid(a * z + b);
      const err = w * (p - (labels[i] as number));
      ga += err * z;
      gb += err;
      const curv = w * p * (1 - p);
      haa += curv * z * z;
      hab += curv * z;
      hbb += curv;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) {
      break;
    }
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) < 1e-10 && Math.abs(db) < 1e-10) {
      break;
    }
  }
  return { a, b };
}

// ---------------------------------------------------------------------------
// Alarm simulation through the SHIPPED escalation reducer
// ---------------------------------------------------------------------------

interface AlarmTotals {
  sessions: number;
  hours: number;
  drifts: number;
  prearmHits: number;
  /** Onsets with the reducer's band ≥ elevated at some tick in the prior 30 s. */
  nudgeHits: number;
  /** Onsets with a nudge/pre-arm EVENT emitted in the prior 30 s. */
  nudgeEventHits: number;
  leads: number[];
  falsePrearms: number;
  nudges: number;
  prearms: number;
}

function newTotals(): AlarmTotals {
  return {
    sessions: 0,
    hours: 0,
    drifts: 0,
    prearmHits: 0,
    nudgeHits: 0,
    nudgeEventHits: 0,
    leads: [],
    falsePrearms: 0,
    nudges: 0,
    prearms: 0,
  };
}

function addTotals(target: AlarmTotals, add: AlarmTotals): void {
  target.sessions += add.sessions;
  target.hours += add.hours;
  target.drifts += add.drifts;
  target.prearmHits += add.prearmHits;
  target.nudgeHits += add.nudgeHits;
  target.nudgeEventHits += add.nudgeEventHits;
  target.leads.push(...add.leads);
  target.falsePrearms += add.falsePrearms;
  target.nudges += add.nudges;
  target.prearms += add.prearms;
}

/**
 * Replays one session's per-second risk through the SHIPPED reducer at the
 * given thresholds. Hit definitions:
 *  - `prearmHits` — eval.ts's rule verbatim (reducer receipt at onset, or a
 *    pre-arm fired within the prior 30 s);
 *  - `nudgeHits`  — the reducer's band was elevated or pre-armed at ANY tick
 *    in the 30 s before onset (i.e. the UI was already warning);
 *  - `nudgeEventHits` — a forecast_nudge/forecast_prearm EVENT was emitted in
 *    that window (stricter: the 30 s nudge cooldown can suppress the toast
 *    while the band stays up).
 */
function simulateSession(
  data: SessionData,
  risks: Float64Array,
  settings: EscalationSettings,
): AlarmTotals {
  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  const events: ForecastEvent[] = [];
  const bandUp = new Uint8Array(data.duration + 1);
  for (let i = 0; i < data.duration; i += 1) {
    const t = i + 1;
    smoothed = smoothRisk(smoothed, risks[i] as number);
    const stepped = stepEscalation(state, {
      ts: t * 1000,
      risk: smoothed,
      ready: t >= FORECAST_WARMUP_SEC,
      decision: data.decisions[i] as Decision,
      countdownActive: data.countdown[i] === 1,
      policySignal: null,
      settings,
    });
    state = stepped.state;
    events.push(...stepped.events);
    bandUp[t] = state.band === "calm" ? 0 : 1;
  }

  const totals = newTotals();
  totals.sessions = 1;
  totals.hours = data.duration / 3600;
  totals.drifts = data.onsets.length;
  const prearmEvents = events.filter((event) => event.type === "forecast_prearm");
  const hitEvents = events.filter((event) => event.type === "forecast_hit");
  const escalationEvents = events.filter(
    (event) => event.type === "forecast_nudge" || event.type === "forecast_prearm",
  );
  totals.nudges = events.filter((event) => event.type === "forecast_nudge").length;
  totals.prearms = prearmEvents.length;

  for (const onset of data.onsets) {
    const receipt = hitEvents.find(
      (event) => event.type === "forecast_hit" && Math.abs(event.ts / 1000 - onset.t) <= 1.5,
    );
    if (receipt !== undefined && receipt.type === "forecast_hit") {
      totals.prearmHits += 1;
      totals.leads.push(receipt.leadSec);
    } else {
      const candidates = prearmEvents.filter(
        (event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30,
      );
      const last = candidates[candidates.length - 1];
      if (last !== undefined) {
        totals.prearmHits += 1;
        totals.leads.push(onset.t - last.ts / 1000);
      }
    }
    let banded = false;
    for (let t = Math.max(1, onset.t - 30); t < onset.t; t += 1) {
      if (bandUp[t] === 1) {
        banded = true;
        break;
      }
    }
    if (banded) {
      totals.nudgeHits += 1;
    }
    if (
      escalationEvents.some(
        (event) => event.ts / 1000 < onset.t && onset.t - event.ts / 1000 <= 30,
      )
    ) {
      totals.nudgeEventHits += 1;
    }
  }
  totals.falsePrearms = events.filter(
    (event) =>
      event.type === "forecast_clear" &&
      event.wasPrearmed &&
      !data.onsets.some((onset) => onset.t >= event.ts / 1000 && onset.t - event.ts / 1000 <= 30),
  ).length;
  return totals;
}

interface AlarmSummary {
  nudgeRisk: number;
  prearmRisk: number;
  recallAt30sNudge: number | null;
  recallAt30sNudgeEvent: number | null;
  recallAt30sPrearm: number | null;
  medianLeadSec: number | null;
  p25LeadSec: number | null;
  falsePrearmsPerHour: number | null;
  nudgesPerHour: number | null;
  drifts: number;
  nudgeHits: number;
  prearmHits: number;
  hours: number;
  perArchetype: Record<string, unknown>;
}

function summarize(
  totals: AlarmTotals,
  byArchetype: Map<string, AlarmTotals>,
): AlarmSummary {
  totals.leads.sort((a, b) => a - b);
  const perArchetype: Record<string, unknown> = {};
  for (const key of [...byArchetype.keys()].sort()) {
    const bucket = byArchetype.get(key) as AlarmTotals;
    perArchetype[key] = {
      sessions: bucket.sessions,
      drifts: bucket.drifts,
      nudgeHits: bucket.nudgeHits,
      prearmHits: bucket.prearmHits,
      nudgesPerHour: bucket.hours > 0 ? round4(bucket.nudges / bucket.hours) : 0,
      falsePrearmsPerHour: bucket.hours > 0 ? round4(bucket.falsePrearms / bucket.hours) : 0,
    };
  }
  return {
    nudgeRisk: 0,
    prearmRisk: 0,
    recallAt30sNudge: totals.drifts > 0 ? round4(totals.nudgeHits / totals.drifts) : null,
    recallAt30sNudgeEvent: totals.drifts > 0 ? round4(totals.nudgeEventHits / totals.drifts) : null,
    recallAt30sPrearm: totals.drifts > 0 ? round4(totals.prearmHits / totals.drifts) : null,
    medianLeadSec: percentile(totals.leads, 0.5),
    p25LeadSec: percentile(totals.leads, 0.25),
    falsePrearmsPerHour: totals.hours > 0 ? round4(totals.falsePrearms / totals.hours) : null,
    nudgesPerHour: totals.hours > 0 ? round4(totals.nudges / totals.hours) : null,
    drifts: totals.drifts,
    nudgeHits: totals.nudgeHits,
    prearmHits: totals.prearmHits,
    hours: round4(totals.hours),
    perArchetype,
  };
}

function runAlarms(
  sessions: readonly SessionData[],
  risksBySession: ReadonlyMap<number, Float64Array>,
  indices: readonly number[],
  nudgeRisk: number,
  prearmRisk: number,
): AlarmSummary {
  const settings: EscalationSettings = {
    nudgeRisk,
    prearmRisk,
    prearmEnabled: true,
    prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };
  const totals = newTotals();
  const byArchetype = new Map<string, AlarmTotals>();
  for (const index of indices) {
    const data = sessions[index] as SessionData;
    const risks = risksBySession.get(index) as Float64Array;
    const result = simulateSession(data, risks, settings);
    addTotals(totals, result);
    const bucket = byArchetype.get(data.archetype) ?? newTotals();
    addTotals(bucket, result);
    byArchetype.set(data.archetype, bucket);
  }
  const summary = summarize(totals, byArchetype);
  summary.nudgeRisk = nudgeRisk;
  summary.prearmRisk = prearmRisk;
  return summary;
}

// ---------------------------------------------------------------------------

/** One trained network: a (variant, seed) pair, Platt-calibrated on val. */
interface Member {
  spec: VariantSpec;
  seed: number;
  name: string;
  net: TemporalNet;
  arch: TemporalArch;
  paramCount: number;
  calibration: { a: number; b: number };
  bestEpoch: number;
  epochsRan: number;
  valLeadAuc20: number;
  trainSeconds: number;
  extraMean: Float64Array;
  extraScale: Float64Array;
}

/** A scoring candidate: one member, or the mean-risk ensemble of several. */
interface Scorer {
  name: string;
  kind: "member" | "ensemble";
  members: Member[];
  params: number;
}

// ---------------------------------------------------------------------------
// Session-clustered bootstrap for the lead-censored AUC
// ---------------------------------------------------------------------------

/**
 * The eval split holds 48 sessions but only ~78 drift episodes, and frames
 * inside one session are anything but independent — so the honest error bar
 * on a lead-censored AUC is a CLUSTER bootstrap over sessions, not over
 * frames. Scores are bucketed by rank once (ties inside a bucket are handled
 * with the standard ½-credit rule), which turns each resample into a sum of
 * precomputed per-session histograms: 2 000 resamples in ~a second, and the
 * bucketed AUC is asserted against the exact Mann-Whitney value from lib.ts.
 */
interface BootstrapInput {
  sessionOf: number[];
  bucketOf: number[];
  label: number[];
  sessions: number[];
  buckets: number;
}

function prepareBootstrap(
  rows: readonly ScoreRow[],
  scores: readonly number[],
  leadSec: number,
  buckets: number,
): BootstrapInput {
  const keep: number[] = [];
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i] as ScoreRow;
    if (row.secsToDrift === null || row.secsToDrift >= leadSec) {
      keep.push(i);
    }
  }
  const order = [...keep].sort((a, b) => (scores[a] as number) - (scores[b] as number));
  const bucketOf = new Array<number>(rows.length).fill(-1);
  const perBucket = Math.max(1, Math.ceil(order.length / buckets));
  let bucket = 0;
  let inBucket = 0;
  for (let k = 0; k < order.length; k += 1) {
    const i = order[k] as number;
    const prev = k > 0 ? (order[k - 1] as number) : -1;
    const sameScore = prev >= 0 && (scores[i] as number) === (scores[prev] as number);
    if (!sameScore && inBucket >= perBucket) {
      bucket += 1;
      inBucket = 0;
    }
    bucketOf[i] = bucket;
    inBucket += 1;
  }
  const sessions = [...new Set(keep.map((i) => (rows[i] as ScoreRow).sessionIdx))].sort(
    (a, b) => a - b,
  );
  return {
    sessionOf: keep.map((i) => (rows[i] as ScoreRow).sessionIdx),
    bucketOf: keep.map((i) => bucketOf[i] as number),
    label: keep.map((i) => (rows[i] as ScoreRow).label),
    sessions,
    buckets: bucket + 1,
  };
}

/** Per-session (bucket × {neg,pos}) histograms — the bootstrap's building block. */
function sessionHistograms(input: BootstrapInput): Map<number, Float64Array> {
  const out = new Map<number, Float64Array>();
  for (const session of input.sessions) {
    out.set(session, new Float64Array(input.buckets * 2));
  }
  for (let i = 0; i < input.sessionOf.length; i += 1) {
    const hist = out.get(input.sessionOf[i] as number) as Float64Array;
    hist[(input.bucketOf[i] as number) * 2 + (input.label[i] as number)] += 1;
  }
  return out;
}

function aucFromHistogram(hist: Float64Array, buckets: number): number {
  let negBelow = 0;
  let positives = 0;
  let negatives = 0;
  let acc = 0;
  for (let b = 0; b < buckets; b += 1) {
    const neg = hist[b * 2] as number;
    const pos = hist[b * 2 + 1] as number;
    acc += pos * (negBelow + neg / 2);
    negBelow += neg;
    positives += pos;
    negatives += neg;
  }
  return positives > 0 && negatives > 0 ? acc / (positives * negatives) : 0.5;
}

interface BootstrapSummary {
  point: number;
  bucketedPoint: number;
  lo95: number;
  hi95: number;
  resamples: number;
}

function bootstrapAuc(
  input: BootstrapInput,
  histograms: Map<number, Float64Array>,
  point: number,
  resamples: number,
  rand: () => number,
): { summary: BootstrapSummary; draws: number[] } {
  const total = new Float64Array(input.buckets * 2);
  for (const session of input.sessions) {
    const hist = histograms.get(session) as Float64Array;
    for (let i = 0; i < total.length; i += 1) {
      total[i] = (total[i] as number) + (hist[i] as number);
    }
  }
  const bucketedPoint = aucFromHistogram(total, input.buckets);
  const draws: number[] = [];
  const scratch = new Float64Array(input.buckets * 2);
  const count = input.sessions.length;
  for (let r = 0; r < resamples; r += 1) {
    scratch.fill(0);
    for (let s = 0; s < count; s += 1) {
      const pick = input.sessions[Math.floor(rand() * count)] as number;
      const hist = histograms.get(pick) as Float64Array;
      for (let i = 0; i < scratch.length; i += 1) {
        scratch[i] = (scratch[i] as number) + (hist[i] as number);
      }
    }
    draws.push(aucFromHistogram(scratch, input.buckets));
  }
  const sorted = [...draws].sort((a, b) => a - b);
  return {
    summary: {
      point: round4(point),
      bucketedPoint: round4(bucketedPoint),
      lo95: round4(percentile(sorted, 0.025) ?? bucketedPoint),
      hi95: round4(percentile(sorted, 0.975) ?? bucketedPoint),
      resamples,
    },
    draws,
  };
}

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  mkdirSync(config.outDir, { recursive: true });
  console.log(
    `[${CANDIDATE}] seed ${config.seed} | seqLen ${config.seqLen}s × ${CHANNEL_COUNT}ch | ` +
      `variants ${config.variants.join(", ")}`,
  );

  const worstGradError = gradientCheck(mulberry32(config.seed ^ 0x5eed));
  console.log(
    `[${CANDIDATE}] gradient check ok (strided conv stack + mean/max/last pool + extras, worst rel err ${worstGradError.toExponential(2)})`,
  );

  // --- 1. dataset.jsonl, read as-is ----------------------------------------
  const trainRowSession: string[] = [];
  const trainRowT: number[] = [];
  const trainRowLabel: number[] = [];
  const trainRowSecs: Array<number | null> = [];
  const trainFeatures: number[][] = [];
  const evalRowSession: string[] = [];
  const evalRowT: number[] = [];
  const evalRowLabel: number[] = [];
  const evalRowSecs: Array<number | null> = [];
  const evalRowArchetype: string[] = [];
  const evalFeatures: number[][] = [];
  const trainSessionOrder: string[] = [];
  const seenTrainSession = new Set<string>();
  for await (const row of readJsonl<DatasetRow>(config.data)) {
    if (row.split === "eval") {
      if (row.source !== "synthetic" && row.source !== "recorded") {
        throw new Error(`eval split contains ${row.source} row (${row.session_id})`);
      }
      evalRowSession.push(row.session_id);
      evalRowT.push(row.t);
      evalRowLabel.push(row.label);
      evalRowSecs.push(row.secs_to_drift);
      evalRowArchetype.push(row.archetype);
      evalFeatures.push(row.features);
    } else {
      if (!seenTrainSession.has(row.session_id)) {
        seenTrainSession.add(row.session_id);
        trainSessionOrder.push(row.session_id);
      }
      trainRowSession.push(row.session_id);
      trainRowT.push(row.t);
      trainRowLabel.push(row.label);
      trainRowSecs.push(row.secs_to_drift);
      trainFeatures.push(row.features);
    }
  }
  console.log(
    `[${CANDIDATE}] dataset: ${trainRowLabel.length} train rows / ${trainSessionOrder.length} sessions, ` +
      `${evalRowLabel.length} eval rows / ${new Set(evalRowSession).size} sessions ` +
      `(${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  );

  // --- 2. raw sessions → replay → per-second channels -----------------------
  const pad = config.seqLen - 1;
  const rawSessions: RawSession[] = [];
  for await (const session of readJsonl<RawSession>(config.raw)) {
    rawSessions.push(session);
  }
  const sessions: SessionData[] = [];
  const sessionIndex = new Map<string, number>();
  const rawTrainPool: RawSession[] = [];
  for (const session of rawSessions) {
    const split = splitForSession(session.id, config.seed);
    sessionIndex.set(session.id, sessions.length);
    sessions.push(buildSessionData(session, split, pad));
    if (split === "train") {
      rawTrainPool.push(session);
    }
  }
  // The 48 augmented:local train sessions are reproduced with the SHARED
  // augmenter at the dataset's own parameters (--augment-fraction 0.25,
  // seed 42) — verified below against the dataset's own feature columns.
  const augmented = augmentLocal(rawTrainPool, { fraction: 0.25, seed: config.seed });
  for (const session of augmented) {
    sessionIndex.set(session.id, sessions.length);
    sessions.push(buildSessionData(session, "train", pad));
  }
  console.log(
    `[${CANDIDATE}] replayed ${sessions.length} sessions ` +
      `(${rawSessions.length} synthetic + ${augmented.length} reproduced augmented:local), ` +
      `${sessions.reduce((sum, s) => sum + s.duration, 0)} frames ` +
      `(${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  );

  // --- 3. Self-check: replayed features === the dataset's own columns -------
  let checked = 0;
  let worstFeatureDelta = 0;
  const checkStride = Math.max(1, Math.floor(trainRowLabel.length / 400));
  const checkOne = (sessionId: string, t: number, features: number[]): void => {
    const index = sessionIndex.get(sessionId);
    if (index === undefined) {
      throw new Error(`dataset row references unknown session ${sessionId}`);
    }
    const data = sessions[index] as SessionData;
    if (t < 1 || t > data.duration) {
      throw new Error(`dataset row ${sessionId}@${t} outside replayed duration ${data.duration}`);
    }
    for (let f = 0; f < FORECAST_FEATURE_KEYS.length; f += 1) {
      const delta = Math.abs(
        (data.feats[(t - 1) * FORECAST_FEATURE_KEYS.length + f] as number) - (features[f] as number),
      );
      worstFeatureDelta = Math.max(worstFeatureDelta, delta);
    }
    checked += 1;
  };
  for (let i = 0; i < trainRowLabel.length; i += checkStride) {
    checkOne(trainRowSession[i] as string, trainRowT[i] as number, trainFeatures[i] as number[]);
  }
  for (let i = 0; i < evalRowLabel.length; i += Math.max(1, Math.floor(evalRowLabel.length / 400))) {
    checkOne(evalRowSession[i] as string, evalRowT[i] as number, evalFeatures[i] as number[]);
  }
  if (worstFeatureDelta > 1e-5) {
    throw new Error(
      `replay drifted from dataset.jsonl: worst |Δfeature| ${worstFeatureDelta.toExponential(3)} — refusing to train`,
    );
  }
  console.log(
    `[${CANDIDATE}] replay↔dataset self-check ok on ${checked} rows ` +
      `(worst |Δfeature| ${worstFeatureDelta.toExponential(2)}, round6 noise) — ` +
      `augmented sessions reproduce exactly`,
  );

  // --- 4. Samples + fit/val split (10% of TRAIN sessions, seeded) ----------
  const rand = mulberry32(config.seed);
  const shuffledSessions = shuffled(
    Array.from({ length: trainSessionOrder.length }, (_, i) => i),
    rand,
  );
  const valSessionCount = Math.max(1, Math.round(trainSessionOrder.length * config.valFraction));
  const valSessionIds = new Set<string>(
    shuffledSessions.slice(0, valSessionCount).map((i) => trainSessionOrder[i] as string),
  );

  const trainSamples: ScoreRow[] = [];
  const trainImportance: number[] = [];
  for (let i = 0; i < trainRowLabel.length; i += 1) {
    const sessionId = trainRowSession[i] as string;
    trainSamples.push({
      sessionIdx: sessionIndex.get(sessionId) as number,
      t: trainRowT[i] as number,
      label: (trainRowLabel[i] as number) === 1 ? 1 : 0,
      secsToDrift: trainRowSecs[i] ?? null,
      archetype: "",
    });
    trainImportance.push(1 / keepProbability((trainRowLabel[i] as number) === 1 ? 1 : 0, trainRowSecs[i] ?? null));
  }
  const fitIdx: number[] = [];
  const valIdx: number[] = [];
  for (let i = 0; i < trainSamples.length; i += 1) {
    (valSessionIds.has(trainRowSession[i] as string) ? valIdx : fitIdx).push(i);
  }
  const fitPos = fitIdx.filter((i) => (trainSamples[i] as ScoreRow).label === 1);
  const fitNeg = fitIdx.filter((i) => (trainSamples[i] as ScoreRow).label === 0);
  const wPos = Math.pow(fitNeg.length / Math.max(1, fitPos.length), config.posWeightPower);
  const wNeg = 1 / config.negRate;
  console.log(
    `[${CANDIDATE}] fit ${fitIdx.length} rows (${fitPos.length} pos, w_pos ${wPos.toFixed(2)}) | ` +
      `val ${valIdx.length} rows / ${valSessionCount} sessions | ` +
      `${Math.round(fitNeg.length * config.negRate)} negatives drawn per epoch (w_neg ${wNeg.toFixed(2)})`,
  );

  const evalRows: ScoreRow[] = evalRowLabel.map((label, i) => ({
    sessionIdx: sessionIndex.get(evalRowSession[i] as string) as number,
    t: evalRowT[i] as number,
    label: label === 1 ? 1 : 0,
    secsToDrift: evalRowSecs[i] ?? null,
    archetype: evalRowArchetype[i] as string,
  }));
  const evalLabels = evalRows.map((row) => row.label);
  const evalBaseRate = evalLabels.reduce<number>((sum, y) => sum + y, 0) / evalLabels.length;

  // --- 5. Channel z-scoring, fit on FIT sessions only ----------------------
  const fitSessionIds = new Set<string>(
    trainSessionOrder.filter((id) => !valSessionIds.has(id)),
  );
  const chMean = new Float64Array(CHANNEL_COUNT);
  const chScale = new Float64Array(CHANNEL_COUNT);
  let chCount = 0;
  for (const data of sessions) {
    if (!fitSessionIds.has(data.id)) {
      continue;
    }
    for (let t = 1; t <= data.duration; t += 1) {
      const at = (pad + t - 1) * CHANNEL_COUNT;
      for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        chMean[c] = (chMean[c] as number) + (data.channels[at + c] as number);
      }
    }
    chCount += data.duration;
  }
  for (let c = 0; c < CHANNEL_COUNT; c += 1) {
    chMean[c] = (chMean[c] as number) / Math.max(1, chCount);
  }
  for (const data of sessions) {
    if (!fitSessionIds.has(data.id)) {
      continue;
    }
    for (let t = 1; t <= data.duration; t += 1) {
      const at = (pad + t - 1) * CHANNEL_COUNT;
      for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        const d = (data.channels[at + c] as number) - (chMean[c] as number);
        chScale[c] = (chScale[c] as number) + d * d;
      }
    }
  }
  for (let c = 0; c < CHANNEL_COUNT; c += 1) {
    const s = Math.sqrt((chScale[c] as number) / Math.max(1, chCount));
    chScale[c] = s > 1e-6 ? s : 1;
  }
  // Applied to EVERY row including the zero left-padding, so the portable
  // forward (which normalizes a zero-padded window the same way) matches.
  for (const data of sessions) {
    const buffer = data.channels;
    for (let i = 0; i < buffer.length; i += CHANNEL_COUNT) {
      for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        buffer[i + c] = ((buffer[i + c] as number) - (chMean[c] as number)) / (chScale[c] as number);
      }
    }
  }

  // --- 6. Train every (variant × seed) member -------------------------------
  const windowSize = config.seqLen * CHANNEL_COUNT;
  const members: Member[] = [];
  for (const variantName of config.variants) {
    const spec = variantSpec(variantName.trim());
    const extraCount = spec.extraFeatureIndex.length;

    // Extra scalars are z-scored on FIT rows only (shared across seeds).
    const extraMean = new Float64Array(Math.max(1, extraCount));
    const extraScale = new Float64Array(Math.max(1, extraCount)).fill(1);
    if (extraCount > 0) {
      for (const i of fitIdx) {
        const sample = trainSamples[i] as ScoreRow;
        const data = sessions[sample.sessionIdx] as SessionData;
        const base = (sample.t - 1) * FORECAST_FEATURE_KEYS.length;
        for (let e = 0; e < extraCount; e += 1) {
          extraMean[e] =
            (extraMean[e] as number) + (data.feats[base + (spec.extraFeatureIndex[e] as number)] as number);
        }
      }
      for (let e = 0; e < extraCount; e += 1) {
        extraMean[e] = (extraMean[e] as number) / fitIdx.length;
      }
      const acc = new Float64Array(extraCount);
      for (const i of fitIdx) {
        const sample = trainSamples[i] as ScoreRow;
        const data = sessions[sample.sessionIdx] as SessionData;
        const base = (sample.t - 1) * FORECAST_FEATURE_KEYS.length;
        for (let e = 0; e < extraCount; e += 1) {
          const d =
            (data.feats[base + (spec.extraFeatureIndex[e] as number)] as number) - (extraMean[e] as number);
          acc[e] = (acc[e] as number) + d * d;
        }
      }
      for (let e = 0; e < extraCount; e += 1) {
        const s = Math.sqrt((acc[e] as number) / fitIdx.length);
        extraScale[e] = s > 1e-6 ? s : 1;
      }
    }

    const extraBuf = new Float64Array(Math.max(1, extraCount));
    const fillExtras = (sessionIdx: number, t: number, buf: Float64Array): void => {
      if (extraCount === 0) {
        return;
      }
      const data = sessions[sessionIdx] as SessionData;
      const base = (t - 1) * FORECAST_FEATURE_KEYS.length;
      for (let e = 0; e < extraCount; e += 1) {
        buf[e] =
          ((data.feats[base + (spec.extraFeatureIndex[e] as number)] as number) - (extraMean[e] as number)) /
          (extraScale[e] as number);
      }
    };

    const p1 = Math.floor((config.seqLen - config.kernel1) / config.stride1) + 1;
    const arch: TemporalArch = {
      seqLen: config.seqLen,
      inChannels: CHANNEL_COUNT,
      convs: [
        { kernel: config.kernel1, stride: config.stride1, out: config.filters },
        { kernel: 5, stride: 2, out: config.filters },
        { kernel: 3, stride: 1, out: config.filters },
      ],
      extras: extraCount,
      hidden: 16,
    };
    if (p1 < 9) {
      throw new Error(`first conv leaves ${p1} positions — widen --seq-len or shrink --s1`);
    }

    for (const memberSeed of config.seeds) {
      const netRand = mulberry32(memberSeed * 7919 + spec.name.length * 131 + config.seqLen);
      const net = new TemporalNet(arch, netRand);
      const params = net.paramArrays();
      const grads: TemporalGrads = net.newGrads();
      const gradArrays = net.gradArrays(grads);
      const optimizer = new Adam(params, config.lr, config.l2);
      const paramCount = net.paramCount();
      const name = config.seeds.length > 1 ? `${spec.name}@${memberSeed}` : spec.name;

      const valLogitsNow = (): number[] => {
        const out: number[] = [];
        for (const i of valIdx) {
          const sample = trainSamples[i] as ScoreRow;
          fillExtras(sample.sessionIdx, sample.t, extraBuf);
          out.push(
            net.forward(
              (sessions[sample.sessionIdx] as SessionData).channels,
              (sample.t - 1) * CHANNEL_COUNT,
              extraBuf,
              0,
            ),
          );
        }
        return out;
      };

      const variantStart = Date.now();
      const epochRand = mulberry32((memberSeed ^ 0x51ce) + spec.name.length * 977);
      let best = { auc: -1, epoch: -1, snapshot: net.snapshot() };
      let sinceBest = 0;
      let epochsRan = 0;
      const valRowsSubset = valIdx.map((i) => trainSamples[i] as ScoreRow);
      for (let epoch = 0; epoch < config.epochs; epoch += 1) {
        epochsRan = epoch + 1;
        // Cosine decay: a stable tail beats a lucky epoch.
        const lrScale =
          config.lrFloor +
          (1 - config.lrFloor) *
            0.5 *
            (1 + Math.cos((Math.PI * epoch) / Math.max(1, config.epochs - 1)));
        const negatives = shuffled(fitNeg, epochRand).slice(
          0,
          Math.round(fitNeg.length * config.negRate),
        );
        const order = shuffled([...fitPos, ...negatives], epochRand);
        for (let start = 0; start < order.length; start += config.batch) {
          const end = Math.min(order.length, start + config.batch);
          net.zeroGrads(grads);
          let batchWeight = 0;
          for (let k = start; k < end; k += 1) {
            const i = order[k] as number;
            const sample = trainSamples[i] as ScoreRow;
            const data = sessions[sample.sessionIdx] as SessionData;
            const offset = (sample.t - 1) * CHANNEL_COUNT;
            fillExtras(sample.sessionIdx, sample.t, extraBuf);
            const logit = net.forward(data.channels, offset, extraBuf, 0);
            const weight = sample.label === 1 ? wPos : wNeg;
            batchWeight += weight;
            net.backward(bceGrad(logit, sample.label, weight), data.channels, offset, grads);
          }
          if (batchWeight <= 0) {
            continue;
          }
          optimizer.update(params, gradArrays, 1 / batchWeight, lrScale);
        }
        const auc = leadAuc(valRowsSubset, valLogitsNow(), LEAD_SEC);
        if (auc > best.auc + 1e-6) {
          best = { auc, epoch, snapshot: net.snapshot() };
          sinceBest = 0;
        } else {
          sinceBest += 1;
        }
        console.log(
          `[${CANDIDATE}] ${name} epoch ${String(epoch).padStart(2)} | lr×${lrScale.toFixed(2)} | ` +
            `val lead≥20s AUC ${auc.toFixed(5)}${sinceBest === 0 ? " *" : ""} | ` +
            `${((Date.now() - variantStart) / 1000).toFixed(0)}s`,
        );
        if (sinceBest >= config.patience) {
          console.log(`[${CANDIDATE}] ${name} early stop at epoch ${epoch} (best ${best.epoch})`);
          break;
        }
      }
      net.restore(best.snapshot);

      const valLogits = valLogitsNow();
      const valLabels = valIdx.map((i) => (trainSamples[i] as ScoreRow).label);
      const valWeights = valIdx.map((i) => trainImportance[i] as number);
      const calibration = fitPlatt(valLogits, valLabels, valWeights);
      members.push({
        spec,
        seed: memberSeed,
        name,
        net,
        arch,
        paramCount,
        calibration,
        bestEpoch: best.epoch,
        epochsRan,
        valLeadAuc20: best.auc,
        trainSeconds: (Date.now() - variantStart) / 1000,
        extraMean,
        extraScale,
      });
      console.log(
        `[${CANDIDATE}] ${name}: ${paramCount} params | best epoch ${best.epoch}/${epochsRan} | ` +
          `val lead≥20s ${best.auc.toFixed(4)} | Platt a ${calibration.a.toFixed(4)} b ${calibration.b.toFixed(4)} | ` +
          `${((Date.now() - variantStart) / 1000).toFixed(0)}s`,
      );
    }
  }

  // --- 7. Scorers: each member, plus the mean-risk ensemble -----------------
  const memberBuf = new Map<string, Float64Array>();
  for (const member of members) {
    memberBuf.set(member.name, new Float64Array(Math.max(1, member.spec.extraFeatureIndex.length)));
  }
  const memberRisk = (member: Member, sessionIdx: number, t: number): number => {
    const data = sessions[sessionIdx] as SessionData;
    const buf = memberBuf.get(member.name) as Float64Array;
    const base = (t - 1) * FORECAST_FEATURE_KEYS.length;
    for (let e = 0; e < member.spec.extraFeatureIndex.length; e += 1) {
      buf[e] =
        ((data.feats[base + (member.spec.extraFeatureIndex[e] as number)] as number) -
          (member.extraMean[e] as number)) /
        (member.extraScale[e] as number);
    }
    const logit = member.net.forward(data.channels, (t - 1) * CHANNEL_COUNT, buf, 0);
    return sigmoid(member.calibration.a * logit + member.calibration.b);
  };
  const scorerRisk = (scorer: Scorer, sessionIdx: number, t: number): number => {
    let sum = 0;
    for (const member of scorer.members) {
      sum += memberRisk(member, sessionIdx, t);
    }
    return sum / scorer.members.length;
  };
  /** Per-member risks for a row set, computed once and shared by every scorer. */
  const scoreRowsPerMember = (rows: readonly ScoreRow[]): Map<string, number[]> => {
    const cache = new Map<string, number[]>();
    for (const member of members) {
      cache.set(
        member.name,
        rows.map((row) => memberRisk(member, row.sessionIdx, row.t)),
      );
    }
    return cache;
  };
  const combine = (scorer: Scorer, cache: Map<string, number[]>): number[] => {
    const columns = scorer.members.map((member) => cache.get(member.name) as number[]);
    const rows = (columns[0] as number[]).length;
    const out = new Array<number>(rows);
    for (let i = 0; i < rows; i += 1) {
      let sum = 0;
      for (const column of columns) {
        sum += column[i] as number;
      }
      out[i] = sum / columns.length;
    }
    return out;
  };

  const scorers: Scorer[] = members.map((member) => ({
    name: member.name,
    kind: "member" as const,
    members: [member],
    params: member.paramCount,
  }));
  if (members.length > 1) {
    scorers.push({
      name: `ensemble(${members.map((m) => m.name).join("+")})`,
      kind: "ensemble",
      members: [...members],
      params: members.reduce((sum, m) => sum + m.paramCount, 0),
    });
  }

  // Every scorer is ranked on the TRAIN-INTERNAL validation split.
  const valRows = valIdx.map((i) => trainSamples[i] as ScoreRow);
  const valMemberScores = scoreRowsPerMember(valRows);
  const scorerVal = scorers.map((scorer) => ({
    scorer,
    valLeadAuc20: leadAuc(valRows, combine(scorer, valMemberScores), LEAD_SEC),
  }));
  for (const entry of scorerVal) {
    console.log(
      `[${CANDIDATE}] candidate '${entry.scorer.name}' (${entry.scorer.params} params) ` +
        `val lead≥20s ${entry.valLeadAuc20.toFixed(5)}`,
    );
  }
  const picked = [...scorerVal].sort((a, b) => b.valLeadAuc20 - a.valLeadAuc20)[0];
  if (picked === undefined) {
    throw new Error("no scorers");
  }

  if (config.tune) {
    console.log("\n===== TUNING MODE (val only — eval split not scored) =====");
    console.log(
      JSON.stringify(
        {
          seqLen: config.seqLen,
          filters: config.filters,
          kernel1: config.kernel1,
          stride1: config.stride1,
          lr: config.lr,
          epochs: config.epochs,
          valSessions: valSessionCount,
          members: members.map((m) => ({
            name: m.name,
            params: m.paramCount,
            bestEpoch: m.bestEpoch,
            epochsRan: m.epochsRan,
            valLeadAuc20: round6(m.valLeadAuc20),
            trainSeconds: round4(m.trainSeconds),
          })),
          candidates: scorerVal.map((e) => ({
            name: e.scorer.name,
            params: e.scorer.params,
            valLeadAuc20: round6(e.valLeadAuc20),
          })),
          bestOnVal: picked.scorer.name,
          runtimeSeconds: round4((Date.now() - startedAt) / 1000),
        },
        null,
        2,
      ),
    );
    return;
  }

  // --- 8. Held-out scoring (eval split touched for the FIRST time here) -----
  const evalMemberScores = scoreRowsPerMember(evalRows);
  const scoredVariants = scorers.map((scorer) => {
    const scores = combine(scorer, evalMemberScores);
    const calibration = ece10(scores, evalLabels);
    const valEntry = scorerVal.find((e) => e.scorer.name === scorer.name);
    return {
      scorer,
      scores,
      reliability: calibration.bins,
      report: {
        name: scorer.name,
        kind: scorer.kind,
        params: scorer.params,
        valLeadAuc20: round6(valEntry?.valLeadAuc20 ?? 0),
        evalLeadAuc20: round4(leadAuc(evalRows, scores, 20)),
        evalLeadAuc10: round4(leadAuc(evalRows, scores, 10)),
        evalRocAuc: round4(rocAuc(scores, evalLabels)),
        evalPrAuc: round4(prAuc(scores, evalLabels)),
        ece: round4(calibration.ece),
      },
    };
  });
  const headline = scoredVariants.find((entry) => entry.scorer.name === picked.scorer.name);
  if (headline === undefined) {
    throw new Error("headline scorer missing");
  }
  const headlineScores = headline.scores;
  console.log(
    `[${CANDIDATE}] selected '${headline.scorer.name}' by val lead≥20s ${picked.valLeadAuc20.toFixed(4)} ` +
      `→ eval lead≥20s ${headline.report.evalLeadAuc20}`,
  );

  // --- 9. Shared cross-checks: full-18 logistic + best single feature + MLP --
  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(trainFeatures.length / cap));
  const subX: number[][] = [];
  const subY: number[] = [];
  for (let i = 0; i < trainFeatures.length; i += stride) {
    subX.push(trainFeatures[i] as number[]);
    subY.push(trainRowLabel[i] as number);
  }
  const allColumns = FORECAST_FEATURE_KEYS.map((_, i) => i);
  const fullLogistic = trainLogistic(subX, subY, allColumns);
  const fullLogisticScores = evalFeatures.map((f) => logisticScore(fullLogistic, f, allColumns));
  const fullLogisticLead20 = leadAuc(evalRows, fullLogisticScores, 20);
  const fullLogisticLead10 = leadAuc(evalRows, fullLogisticScores, 10);
  const fullLogisticRoc = rocAuc(fullLogisticScores, evalLabels);

  const singleFeature: Array<{ key: string; leadAuc20: number; auc: number }> = [];
  let bestSingle = { key: "none", leadAuc20: 0.5, auc: 0.5 };
  for (let f = 0; f < FORECAST_FEATURE_KEYS.length; f += 1) {
    const model = trainLogistic(subX, subY, [f]);
    const scores = evalFeatures.map((row) => logisticScore(model, row, [f]));
    const entry = {
      key: FORECAST_FEATURE_KEYS[f] as string,
      leadAuc20: round4(leadAuc(evalRows, scores, 20)),
      auc: round4(rocAuc(scores, evalLabels)),
    };
    singleFeature.push(entry);
    if (entry.leadAuc20 > bestSingle.leadAuc20) {
      bestSingle = entry;
    }
  }

  const shippedWeights = parseForecastWeights(
    JSON.parse(readFileSync(join(repoRoot(), "src", "shared", "forecast", "weights.json"), "utf8")),
  );
  if (shippedWeights === null) {
    throw new Error("shipped weights.json failed parseForecastWeights");
  }
  const mlpScores = evalFeatures.map((f) => mlpForward(shippedWeights, f).rawRisk);
  const mlpLead20 = leadAuc(evalRows, mlpScores, 20);
  const mlpLead10 = leadAuc(evalRows, mlpScores, 10);
  const mlpRoc = rocAuc(mlpScores, evalLabels);
  const mlpPr = prAuc(mlpScores, evalLabels);
  const mlpEce = ece10(mlpScores, evalLabels).ece;
  console.log(
    `[${CANDIDATE}] cross-checks (lead≥20s): shipped MLP ${round4(mlpLead20)} | ` +
      `full-18 logistic ${round4(fullLogisticLead20)} | best single (${bestSingle.key}) ${bestSingle.leadAuc20}`,
  );

  // --- 10. Session-clustered bootstrap (the noise floor of this eval set) ----
  const BOOT = 2000;
  const bootstrapFor = (scores: readonly number[], point: number): { summary: BootstrapSummary; draws: number[] } => {
    const input = prepareBootstrap(evalRows, scores, LEAD_SEC, 8192);
    const histograms = sessionHistograms(input);
    // Same seed ⇒ same resampled session sets for every model ⇒ the paired
    // differences below are honest paired comparisons.
    return bootstrapAuc(input, histograms, point, BOOT, mulberry32(config.seed ^ 0xb007));
  };
  const bootTemporal = bootstrapFor(headlineScores, headline.report.evalLeadAuc20 as number);
  const bootLogistic = bootstrapFor(fullLogisticScores, round4(fullLogisticLead20));
  const bootMlp = bootstrapFor(mlpScores, round4(mlpLead20));
  const pairedDiff = (a: number[], b: number[], point: number): Record<string, number> => {
    const diffs = a.map((v, i) => v - (b[i] as number)).sort((x, y) => x - y);
    return {
      point: round4(point),
      lo95: round4(percentile(diffs, 0.025) ?? 0),
      hi95: round4(percentile(diffs, 0.975) ?? 0),
      pWorseOrEqual: round4(diffs.filter((d) => d <= 0).length / diffs.length),
    };
  };
  const bucketError = Math.max(
    Math.abs(bootTemporal.summary.point - bootTemporal.summary.bucketedPoint),
    Math.abs(bootLogistic.summary.point - bootLogistic.summary.bucketedPoint),
    Math.abs(bootMlp.summary.point - bootMlp.summary.bucketedPoint),
  );
  if (bucketError > 0.001) {
    throw new Error(`bucketed AUC drifted from the exact Mann-Whitney value by ${bucketError}`);
  }
  console.log(
    `[${CANDIDATE}] session bootstrap (${BOOT}×): temporal ${bootTemporal.summary.point} ` +
      `[${bootTemporal.summary.lo95}, ${bootTemporal.summary.hi95}] | ` +
      `logistic ${bootLogistic.summary.point} [${bootLogistic.summary.lo95}, ${bootLogistic.summary.hi95}]`,
  );

  // --- 11. Alarm simulation through the shipped reducer ---------------------
  const thresholds = await thresholdDefaults();
  const evalSessionIdx: number[] = [];
  const valSessionIdx: number[] = [];
  for (let i = 0; i < sessions.length; i += 1) {
    const data = sessions[i] as SessionData;
    if (data.split === "eval") {
      evalSessionIdx.push(i);
    } else if (valSessionIds.has(data.id) && data.source === "synthetic") {
      valSessionIdx.push(i);
    }
  }
  const perSecondRisks = (scorer: Scorer, indices: readonly number[]): Map<number, Float64Array> => {
    const out = new Map<number, Float64Array>();
    for (const index of indices) {
      const data = sessions[index] as SessionData;
      const risks = new Float64Array(data.duration);
      for (let t = 1; t <= data.duration; t += 1) {
        risks[t - 1] = scorerRisk(scorer, index, t);
      }
      out.set(index, risks);
    }
    return out;
  };

  const evalRisks = perSecondRisks(headline.scorer, evalSessionIdx);
  const alarmsRecommended = runAlarms(
    sessions,
    evalRisks,
    evalSessionIdx,
    thresholds.nudge,
    thresholds.prearm,
  );

  // Operating-point alternatives are chosen on VAL sessions only.
  const valRisks = perSecondRisks(headline.scorer, valSessionIdx);
  const grid = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55];
  const valSweep = grid.map((nudge) => {
    const summary = runAlarms(sessions, valRisks, valSessionIdx, nudge, thresholds.prearm);
    const churn = summary.perArchetype["research_churn"] as { nudgesPerHour: number } | undefined;
    return {
      nudgeRisk: nudge,
      recallAt30sNudge: summary.recallAt30sNudge,
      nudgesPerHour: summary.nudgesPerHour,
      churnNudgesPerHour: churn?.nudgesPerHour ?? 0,
    };
  });
  const affordable = valSweep.filter(
    (entry) => (entry.nudgesPerHour ?? 99) <= 6 && entry.churnNudgesPerHour <= 0.5,
  );
  const valPick =
    [...affordable].sort(
      (a, b) => (b.recallAt30sNudge ?? 0) - (a.recallAt30sNudge ?? 0) || a.nudgeRisk - b.nudgeRisk,
    )[0] ?? valSweep[valSweep.length - 1];
  const alternativePoint =
    valPick !== undefined && valPick.nudgeRisk !== thresholds.nudge
      ? runAlarms(sessions, evalRisks, evalSessionIdx, valPick.nudgeRisk, thresholds.prearm)
      : null;

  // The SHIPPED MLP through the identical simulation, so the nudge-recall
  // number has an apples-to-apples reference (the committed report prints
  // only the pre-arm recall).
  const mlpRisks = new Map<number, Float64Array>();
  for (const index of evalSessionIdx) {
    const data = sessions[index] as SessionData;
    const risks = new Float64Array(data.duration);
    const probe = new Array<number>(FORECAST_FEATURE_KEYS.length);
    for (let t = 1; t <= data.duration; t += 1) {
      const base = (t - 1) * FORECAST_FEATURE_KEYS.length;
      for (let f = 0; f < FORECAST_FEATURE_KEYS.length; f += 1) {
        probe[f] = data.feats[base + f] as number;
      }
      risks[t - 1] = mlpForward(shippedWeights, probe).rawRisk;
    }
    mlpRisks.set(index, risks);
  }
  const mlpAlarms = runAlarms(sessions, mlpRisks, evalSessionIdx, thresholds.nudge, thresholds.prearm);

  // --- 12. Per-archetype frame slices (research_churn is load-bearing) ------
  const perArchetypeFrames: Record<string, unknown> = {};
  const archetypes = [...new Set(evalRows.map((row) => row.archetype))].sort();
  for (const archetype of archetypes) {
    const idx = evalRows
      .map((row, i) => ({ row, i }))
      .filter((entry) => entry.row.archetype === archetype);
    const negatives = idx.filter((entry) => entry.row.label === 0);
    const fpAt = (threshold: number, source: readonly number[]): number =>
      negatives.length > 0
        ? negatives.filter((entry) => (source[entry.i] as number) >= threshold).length / negatives.length
        : 0;
    perArchetypeFrames[archetype] = {
      frames: idx.length,
      baseRate: round4(idx.reduce((sum, entry) => sum + entry.row.label, 0) / Math.max(1, idx.length)),
      falsePositiveRateAtNudge: round4(fpAt(thresholds.nudge, headlineScores)),
      falsePositiveRateAtPrearm: round4(fpAt(thresholds.prearm, headlineScores)),
      shippedMlpFalsePositiveRateAtNudge: round4(fpAt(thresholds.nudge, mlpScores)),
    };
  }
  const churnFrames = perArchetypeFrames["research_churn"] as
    | { falsePositiveRateAtNudge: number; falsePositiveRateAtPrearm: number }
    | undefined;
  if (churnFrames === undefined) {
    throw new Error("eval split has no research_churn frames — the anti-if-else slice is empty");
  }

  // --- 13. Portable pure-TS forward: parity + per-inference cost ------------
  const exported = {
    version: TEMPORAL_MODEL_VERSION,
    kind: headline.scorer.kind,
    createdBy: `scripts/forecast/candidates/${CANDIDATE}.ts`,
    seed: config.seed,
    members: headline.scorer.members.map((member) =>
      exportMember(member, config, thresholds, chMean, chScale),
    ),
  };
  const parsedMembers = exported.members.map((member) => {
    const parsed = parseTemporalWeights(JSON.parse(JSON.stringify(member)));
    if (parsed === null) {
      throw new Error("exported temporal weights failed parseTemporalWeights — refusing to write");
    }
    return parsed;
  });

  const rawWindow = new Float64Array(windowSize);
  const raw18 = new Float64Array(FORECAST_FEATURE_KEYS.length);
  let worstPortableDelta = 0;
  const parityStride = Math.max(1, Math.floor(evalRows.length / 250));
  for (let i = 0; i < evalRows.length; i += parityStride) {
    const row = evalRows[i] as ScoreRow;
    const data = sessions[row.sessionIdx] as SessionData;
    // Undo the in-place z-scoring so the portable pass gets RAW channels.
    const offset = (row.t - 1) * CHANNEL_COUNT;
    for (let p = 0; p < config.seqLen; p += 1) {
      for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        rawWindow[p * CHANNEL_COUNT + c] =
          (data.channels[offset + p * CHANNEL_COUNT + c] as number) * (chScale[c] as number) +
          (chMean[c] as number);
      }
    }
    const base = (row.t - 1) * FORECAST_FEATURE_KEYS.length;
    for (let f = 0; f < FORECAST_FEATURE_KEYS.length; f += 1) {
      raw18[f] = data.feats[base + f] as number;
    }
    const portable = temporalEnsembleForward(parsedMembers, rawWindow, raw18);
    worstPortableDelta = Math.max(
      worstPortableDelta,
      Math.abs(portable.rawRisk - (headlineScores[i] as number)),
    );
  }
  if (worstPortableDelta > 1e-9) {
    throw new Error(
      `portable forward disagrees with the trainer by ${worstPortableDelta.toExponential(3)} — train/serve skew`,
    );
  }
  const timingIterations = 2000;
  const timingStart = process.hrtime.bigint();
  let timingSink = 0;
  for (let i = 0; i < timingIterations; i += 1) {
    timingSink += temporalEnsembleForward(parsedMembers, rawWindow, raw18).rawRisk;
  }
  const timingNs = Number(process.hrtime.bigint() - timingStart) / timingIterations;
  if (!Number.isFinite(timingSink)) {
    throw new Error("timing sink diverged");
  }

  // --- 14. Report -------------------------------------------------------------
  const headlineReport = headline.report;
  const gateMargin = (headlineReport.evalLeadAuc20 as number) - bestSingle.leadAuc20;
  const p1 = Math.floor((config.seqLen - config.kernel1) / config.stride1) + 1;
  const p2 = Math.floor((p1 - 5) / 2) + 1;
  const p3 = p2 - 2;
  const metrics = {
    candidate: CANDIDATE,
    approach:
      `Causal 1-D temporal CNN over the last ${config.seqLen} s of RAW 1 Hz telemetry ` +
      `(${CHANNEL_COUNT} channels: focus-class one-hot, per-second process switches, title-hash changes, ` +
      `dwell, webcam-on, policy presence verdicts, desk confidence, drifted flag) — ` +
      `conv(k${config.kernel1},s${config.stride1},${config.filters}) → conv(k5,s2,${config.filters}) → ` +
      `conv(k3,s1,${config.filters}) → mean⊕max⊕last pooling → tanh dense(16) → logit. ` +
      `Hand-rolled forward+backward+Adam in float64 (finite-difference gradient-checked); inference is a ` +
      `pure-TS forward pass (scripts/forecast/candidates/temporal/forward.ts) — no tfjs, no runtime dependency.`,
    seed: config.seed,
    createdBy: `scripts/forecast/candidates/${CANDIDATE}.ts`,
    command: `npx tsx --tsconfig tsconfig.node.json scripts/forecast/candidates/${CANDIDATE}.ts`,
    config: {
      seqLen: config.seqLen,
      channels: CHANNEL_COUNT,
      filters: config.filters,
      kernel1: config.kernel1,
      stride1: config.stride1,
      convPositions: [p1, p2, p3],
      epochs: config.epochs,
      batch: config.batch,
      lr: config.lr,
      lrSchedule: `cosine to ×${config.lrFloor}`,
      l2: config.l2,
      negRatePerEpoch: config.negRate,
      posWeightPower: config.posWeightPower,
      valFraction: config.valFraction,
      seeds: config.seeds,
    },
    dataset: {
      file: config.data,
      rebuilt: false,
      trainRows: trainRowLabel.length,
      trainSessions: trainSessionOrder.length,
      evalRows: evalRows.length,
      evalSessions: new Set(evalRowSession).size,
      evalBaseRate: round4(evalBaseRate),
      evalDriftOnsets: alarmsRecommended.drifts,
      fitRows: fitIdx.length,
      valRows: valIdx.length,
      valSessions: valSessionCount,
      sequenceSource:
        "raw-sessions.jsonl replayed through the SHARED ring/extractor (lib.replaySession); the 48 " +
        "augmented:local train sessions reproduced with the shared augmentLocal(fraction 0.25, seed 42)",
      selfCheck: {
        rowsChecked: checked,
        worstFeatureDelta: Number(worstFeatureDelta.toExponential(3)),
        note: "replayed 18-feature vectors vs dataset.jsonl's own columns (round6 noise only)",
      },
      note: "dataset.jsonl read as-is; split=='eval' rows never touched by any fit or selection step",
    },
    headline: {
      name: headlineReport.name,
      kind: headlineReport.kind,
      seqLenSec: config.seqLen,
      channels: [...TEMPORAL_CHANNEL_KEYS],
      members: headline.scorer.members.map((member) => ({
        name: member.name,
        extras: member.spec.extraKeys,
        params: member.paramCount,
        bestEpoch: member.bestEpoch,
        valLeadAuc20: round6(member.valLeadAuc20),
      })),
      params: headline.scorer.params,
      selectedOn: "train-internal validation lead-censored (≥20 s) ROC-AUC",
      metrics: {
        aucLead20: headlineReport.evalLeadAuc20,
        aucLead10: headlineReport.evalLeadAuc10,
        rocAuc: headlineReport.evalRocAuc,
        prAuc: headlineReport.evalPrAuc,
        ece: headlineReport.ece,
      },
      inference: {
        nanosPerForward: Math.round(timingNs),
        microsPerForward: round4(timingNs / 1000),
        iterations: timingIterations,
        cpuDutyCycleAt1Hz: round6(timingNs / 1e9),
        portableForwardMaxAbsDelta: Number(worstPortableDelta.toExponential(3)),
        note: "pure-TS portable forward over the whole headline model, one 1 Hz tick, this machine",
      },
    },
    variants: scoredVariants.map((entry) => entry.report),
    reliability: headline.reliability,
    uncertainty: {
      method:
        "session-clustered bootstrap (resample the 48 eval sessions with replacement, 2 000 draws, " +
        "identical resamples across models so the differences are paired)",
      note:
        "the eval split holds 48 sessions and only " +
        `${alarmsRecommended.drifts} drift episodes — differences below ~±0.02 lead-censored AUC are inside the noise floor`,
      temporal: bootTemporal.summary,
      fullLogistic18: bootLogistic.summary,
      shippedMlp: bootMlp.summary,
      temporalMinusFullLogistic18: pairedDiff(
        bootTemporal.draws,
        bootLogistic.draws,
        (headlineReport.evalLeadAuc20 as number) - round4(fullLogisticLead20),
      ),
      temporalMinusShippedMlp: pairedDiff(
        bootTemporal.draws,
        bootMlp.draws,
        (headlineReport.evalLeadAuc20 as number) - round4(mlpLead20),
      ),
    },
    operatingPoints: {
      recommended: {
        nudge: thresholds.nudge,
        prearm: thresholds.prearm,
        source: thresholds.source,
        why:
          "the SHIPPED DEFAULT_SETTINGS thresholds — kept for operating-point parity with eval.ts and " +
          "the committed report, so every alarm number below is directly comparable to the shipped model",
      },
      frameNudge: operatingPoint(evalRows, headlineScores, thresholds.nudge),
      framePrearm: operatingPoint(evalRows, headlineScores, thresholds.prearm),
      valSweep,
      valSelectedAlternative:
        valPick === undefined
          ? null
          : {
              nudgeRisk: valPick.nudgeRisk,
              chosenOn: "val sessions only (nudges/h ≤ 6 and research_churn nudges/h ≤ 0.5)",
              evalAlarms: alternativePoint,
            },
    },
    alarms: {
      atRecommended: alarmsRecommended,
      shippedMlpSameSimulation: mlpAlarms,
      definitions: {
        recallAt30sNudge:
          "fraction of held-out drift onsets where the SHIPPED escalation reducer's band was elevated " +
          "or pre-armed at some tick in the 30 s before onset (i.e. at least a nudge was up)",
        recallAt30sNudgeEvent:
          "stricter: a forecast_nudge/forecast_prearm EVENT was emitted in that 30 s window (the " +
          "reducer's 30 s nudge cooldown can keep the band up without re-emitting a toast)",
        recallAt30sPrearm: "eval.ts's alarms.recallAt30 rule verbatim (pre-arm based)",
      },
    },
    perArchetypeFrames,
    fprResearchChurn: {
      atNudge: churnFrames.falsePositiveRateAtNudge,
      atPrearm: churnFrames.falsePositiveRateAtPrearm,
      shippedMlpAtNudge: (
        perArchetypeFrames["research_churn"] as { shippedMlpFalsePositiveRateAtNudge: number }
      ).shippedMlpFalsePositiveRateAtNudge,
      note: "frame-level FPR over research_churn eval frames (zero drifts by construction) — eval.ts's own definition",
    },
    crossCheck: {
      fullLogistic18: {
        leadAuc20: round4(fullLogisticLead20),
        leadAuc10: round4(fullLogisticLead10),
        rocAuc: round4(fullLogisticRoc),
        note: "eval.ts's fullLogistic18 baseline reproduced verbatim (lib.trainLogistic, 40k stride subsample, class-weighted GD) on the identical eligibility set",
      },
      bestSingleFeatureLogistic: {
        feature: bestSingle.key,
        leadAuc20: bestSingle.leadAuc20,
        note: "gate baseline — chosen adversarially by held-out lead-censored AUC",
      },
      shippedMlp: {
        leadAuc20: round4(mlpLead20),
        leadAuc10: round4(mlpLead10),
        rocAuc: round4(mlpRoc),
        prAuc: round4(mlpPr),
        ece: round4(mlpEce),
        note: "src/shared/forecast/weights.json re-scored here on the identical eligibility set (not quoted from the committed report)",
      },
      singleFeature,
    },
    gate: {
      metric: "lead-censored ROC-AUC (onset ≥ 20 s away vs calm)",
      marginRequired: GATE_MARGIN,
      candidateLeadAuc20: headlineReport.evalLeadAuc20,
      baselineFeature: bestSingle.key,
      baselineLeadAuc20: bestSingle.leadAuc20,
      margin: round4(gateMargin),
      passed: gateMargin >= GATE_MARGIN,
      beatsFullLogistic18: (headlineReport.evalLeadAuc20 as number) > round4(fullLogisticLead20),
      beatsShippedMlp: (headlineReport.evalLeadAuc20 as number) > round4(mlpLead20),
    },
    runtimeSeconds: round4((Date.now() - startedAt) / 1000),
  };

  writeFileSync(join(config.outDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);
  writeFileSync(join(config.outDir, "weights.json"), `${JSON.stringify(exported)}\n`);

  console.log("\n===== TEMPORAL CANDIDATE METRICS (JSON) =====");
  console.log(
    JSON.stringify(
      {
        candidate: CANDIDATE,
        approach: metrics.approach,
        headline: headlineReport.name,
        params: headline.scorer.params,
        seqLenSec: config.seqLen,
        channels: CHANNEL_COUNT,
        aucLead20: headlineReport.evalLeadAuc20,
        aucLead10: headlineReport.evalLeadAuc10,
        rocAuc: headlineReport.evalRocAuc,
        prAuc: headlineReport.evalPrAuc,
        ece: headlineReport.ece,
        recallAt30sNudge: alarmsRecommended.recallAt30sNudge,
        recallAt30sNudgeEvent: alarmsRecommended.recallAt30sNudgeEvent,
        recallAt30sPrearm: alarmsRecommended.recallAt30sPrearm,
        fprResearchChurn: churnFrames.falsePositiveRateAtNudge,
        operatingPoint: { nudge: thresholds.nudge, prearm: thresholds.prearm },
        falsePrearmsPerHour: alarmsRecommended.falsePrearmsPerHour,
        nudgesPerHour: alarmsRecommended.nudgesPerHour,
        medianLeadSec: alarmsRecommended.medianLeadSec,
        fullLogistic18LeadAuc20: round4(fullLogisticLead20),
        shippedMlpLeadAuc20: round4(mlpLead20),
        bestSingleFeatureLeadAuc20: bestSingle.leadAuc20,
        gateMargin: round4(gateMargin),
        shippedMlpRecallAt30sNudge: mlpAlarms.recallAt30sNudge,
        shippedMlpRecallAt30sPrearm: mlpAlarms.recallAt30sPrearm,
        bootstrap95: {
          temporal: [bootTemporal.summary.lo95, bootTemporal.summary.hi95],
          fullLogistic18: [bootLogistic.summary.lo95, bootLogistic.summary.hi95],
          temporalMinusFullLogistic18: metrics.uncertainty.temporalMinusFullLogistic18,
        },
        nanosPerForward: Math.round(timingNs),
        variants: scoredVariants.map((entry) => ({
          name: entry.report.name,
          params: entry.report.params,
          valLeadAuc20: round4(entry.report.valLeadAuc20 as number),
          evalLeadAuc20: entry.report.evalLeadAuc20,
        })),
        runtimeSeconds: round4((Date.now() - startedAt) / 1000),
      },
      null,
      2,
    ),
  );
  console.log(`\n[${CANDIDATE}] metrics → ${join(config.outDir, "metrics.json")}`);
  console.log(`[${CANDIDATE}] weights → ${join(config.outDir, "weights.json")}`);
}

function exportMember(
  member: Member,
  config: Config,
  thresholds: { nudge: number; prearm: number; clear: number },
  chMean: Float64Array,
  chScale: Float64Array,
): TemporalWeightsFile {
  // No digit trimming anywhere: the exported file must reproduce the
  // trainer's forward pass bit-for-bit, which the parity assert checks.
  const extraCount = member.spec.extraFeatureIndex.length;
  return {
    version: TEMPORAL_MODEL_VERSION,
    variant: member.name,
    seqLen: config.seqLen,
    channelKeys: [...TEMPORAL_CHANNEL_KEYS],
    extraKeys: [...member.spec.extraKeys],
    extraFeatureIndex: [...member.spec.extraFeatureIndex],
    norm: { mean: [...chMean], scale: [...chScale] },
    extraNorm: {
      mean: [...member.extraMean].slice(0, extraCount),
      scale: [...member.extraScale].slice(0, extraCount),
    },
    convs: member.arch.convs.map((spec, l) => ({
      kernel: spec.kernel,
      stride: spec.stride,
      out: spec.out,
      W: [...(member.net.W[l] as Float64Array)],
      b: [...(member.net.b[l] as Float64Array)],
    })),
    head: { W: [...member.net.Wh], b: [...member.net.bh] },
    out: { W: [...member.net.Wo], b: member.net.bo[0] as number },
    calibration: { a: member.calibration.a, b: member.calibration.b },
    horizonSec: 30,
    thresholds,
    paramCount: member.paramCount,
  };
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
