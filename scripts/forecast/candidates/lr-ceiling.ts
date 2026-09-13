import { mkdirSync, writeFileSync } from "node:fs";
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
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_WARMUP_SEC,
  type ForecastEvent,
} from "../../../src/shared/forecast/types";
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
} from "../lib";
import {
  applyStandardizer,
  buildDesign,
  columnQuantiles,
  compileSpec,
  expandRow,
  fitLogisticL2,
  fitPlatt,
  fitStandardizer,
  rowLogit,
  sigmoidStable,
  termName,
  type CompiledSpec,
  type Standardizer,
  type Term,
} from "./lr-ceiling/linear";

/**
 * GAUNTLET CONTENDER: `lr-ceiling` — the TRUE linear ceiling.
 *
 * The shipped gate only compares the TinyMLP against the best SINGLE-feature
 * logistic (0.7734 lead-censored AUC). That is a strawman. This script builds
 * the strongest honest LINEAR-FAMILY contender it can and reports it on the
 * shared, fixed eligibility set so the MLP has something real to beat:
 *
 *   A  lr18            18 encoded features, L2 tuned on a train-internal val split
 *   B  lr18+pairwise   + all 171 pairwise products & squares
 *   C  lr18+splines    + quantile hinge (piecewise-linear spline) bases on the
 *                        strongest features
 *   D  lr18+splines+pairwise  the union
 *
 * Everything is still a GLM: the model is linear in its (expanded) basis, so
 * the whole family is "logistic regression a judge would recognise".
 *
 * HONESTY PROTOCOL
 * - The dataset is read as-is. Nothing is rebuilt, resampled or re-split.
 * - `split === "eval"` rows are NEVER used for fitting, hyperparameter
 *   selection, variant selection, knot placement, standardization, Platt
 *   calibration, or operating-point choice. The train-internal validation
 *   split is 10 % of TRAIN sessions, chosen with exactly train.ts's seeded
 *   procedure (so it is the same val split the shipped MLP used).
 * - Metrics use scripts/forecast/lib.ts helpers verbatim: `rocAuc`
 *   (Mann-Whitney with tie ranks), `prAuc`, `ece10`, and eval.ts's
 *   lead-censored eligibility rule (positive ⇔ label 1 and onset ≥ lead s
 *   away; negative ⇔ calm frame with no onset, or onset ≥ lead s away).
 * - The alarm simulation runs the SHIPPED escalation reducer
 *   (`stepEscalation` + `smoothRisk`) over the held-out RAW sessions.
 * - The eval.ts full-18-feature logistic baseline is reproduced verbatim
 *   (same `trainLogistic`, same 40 k stride subsample) as a cross-check
 *   number every contender can print.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/candidates/lr-ceiling.ts
 */

const CANDIDATE = "lr-ceiling";
const BASE_DIM = FORECAST_FEATURE_KEYS.length; // 18
const LEAD_SEC = 20;

interface Config {
  data: string;
  raw: string;
  outDir: string;
  seed: number;
  valFraction: number;
  maxIters: number;
  topFeatures: number;
}

function readConfig(): Config {
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    outDir: stringArg("--out", join(forecastDataRoot(), "candidates", CANDIDATE)),
    seed: numberArg("--seed", 42),
    // Mirrors train.ts --val so the val split is identical to the MLP's.
    valFraction: numberArg("--val", 0.1),
    maxIters: numberArg("--iters", 300),
    topFeatures: numberArg("--top", 10),
  };
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface Loaded {
  trainBase: Float32Array; // nTrain × 18, encoded (pre-standardization)
  trainY: Uint8Array;
  trainSecs: Float64Array; // NaN ⇒ no onset ahead
  trainImportance: Float64Array; // 1 / keep-probability
  trainSessionOf: Int32Array;
  trainSessions: string[];
  evalBase: Float32Array; // nEval × 18
  evalY: Uint8Array;
  evalSecs: Float64Array;
  evalArchetype: string[];
  evalSessionIds: string[];
  /** eval.ts's baseline inputs: ALL train rows in file order. */
  evalTsTrainX: number[][];
  evalTsTrainY: number[];
}

async function load(file: string): Promise<Loaded> {
  const trainBase: number[] = [];
  const trainY: number[] = [];
  const trainSecs: number[] = [];
  const trainImportance: number[] = [];
  const trainSessionOf: number[] = [];
  const trainSessions: string[] = [];
  const sessionIndex = new Map<string, number>();
  const evalBase: number[] = [];
  const evalY: number[] = [];
  const evalSecs: number[] = [];
  const evalArchetype: string[] = [];
  const evalSessionIds: string[] = [];
  const evalTsTrainX: number[][] = [];
  const evalTsTrainY: number[] = [];

  for await (const row of readJsonl<DatasetRow>(file)) {
    if (row.split === "eval") {
      for (let i = 0; i < BASE_DIM; i += 1) {
        evalBase.push(row.features[i] ?? 0);
      }
      evalY.push(row.label);
      evalSecs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
      evalArchetype.push(row.archetype);
      evalSessionIds.push(row.session_id);
      continue;
    }
    let index = sessionIndex.get(row.session_id);
    if (index === undefined) {
      index = trainSessions.length;
      sessionIndex.set(row.session_id, index);
      trainSessions.push(row.session_id);
    }
    for (let i = 0; i < BASE_DIM; i += 1) {
      trainBase.push(row.features[i] ?? 0);
    }
    trainY.push(row.label);
    trainSecs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
    trainImportance.push(1 / keepProbability(row.label, row.secs_to_drift));
    trainSessionOf.push(index);
    evalTsTrainX.push(row.features);
    evalTsTrainY.push(row.label);
  }

  return {
    trainBase: Float32Array.from(trainBase),
    trainY: Uint8Array.from(trainY),
    trainSecs: Float64Array.from(trainSecs),
    trainImportance: Float64Array.from(trainImportance),
    trainSessionOf: Int32Array.from(trainSessionOf),
    trainSessions,
    evalBase: Float32Array.from(evalBase),
    evalY: Uint8Array.from(evalY),
    evalSecs: Float64Array.from(evalSecs),
    evalArchetype,
    evalSessionIds,
    evalTsTrainX,
    evalTsTrainY,
  };
}

// ---------------------------------------------------------------------------
// Lead-censored AUC — identical rule to eval.ts `leadEligible` / `leadAuc`
// ---------------------------------------------------------------------------

function leadEligible(secs: number, leadSec: number): boolean {
  return Number.isNaN(secs) || secs >= leadSec;
}

function leadAucOn(
  scores: readonly number[],
  y: Uint8Array | readonly number[],
  secs: Float64Array,
  rows: Int32Array | null,
  leadSec: number,
): number {
  const s: number[] = [];
  const l: number[] = [];
  const n = rows === null ? scores.length : rows.length;
  for (let k = 0; k < n; k += 1) {
    const row = rows === null ? k : (rows[k] as number);
    if (leadEligible(secs[row] as number, leadSec)) {
      s.push(scores[k] as number);
      l.push((y as Uint8Array)[row] as number);
    }
  }
  return rocAuc(s, l);
}

// ---------------------------------------------------------------------------
// Variant specs
// ---------------------------------------------------------------------------

function linTerms(): Term[] {
  return Array.from({ length: BASE_DIM }, (_, i) => ({ t: "lin", i }) as Term);
}

function pairwiseTerms(): Term[] {
  const terms: Term[] = [];
  for (let i = 0; i < BASE_DIM; i += 1) {
    for (let j = i; j < BASE_DIM; j += 1) {
      terms.push({ t: "prod", i, j });
    }
  }
  return terms;
}

/** Hinge bases at interior quantile knots of the strongest features. */
function splineTerms(
  base: Float32Array,
  fitIdx: Int32Array,
  features: readonly number[],
  quantiles: readonly number[],
): Term[] {
  const terms: Term[] = [];
  for (const feature of features) {
    const knots = columnQuantiles(base, BASE_DIM, fitIdx, feature, quantiles);
    const seen = new Set<number>();
    for (const knot of knots) {
      const key = Math.round(knot * 1e6);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      terms.push({ t: "hinge", i: feature, knot });
    }
  }
  return terms;
}

// ---------------------------------------------------------------------------
// Fitting one variant: L2 (and, for the base variant, class-weight) sweep
// selected on the train-internal validation split
// ---------------------------------------------------------------------------

const LAMBDAS = [1, 1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6];

interface FittedVariant {
  spec: CompiledSpec;
  standardizer: Standardizer;
  theta: Float64Array;
  calibration: { a: number; b: number };
  lambda: number;
  posPower: number;
  valLeadAuc20: number;
  valRocAuc: number;
  params: number;
  sweep: Array<{ lambda: number; posPower: number; valLeadAuc20: number; iters: number }>;
}

function sampleWeightsFor(
  importance: Float64Array,
  y: Uint8Array,
  fitIdx: Int32Array,
  posPower: number,
): Float64Array {
  let wPos = 0;
  let wNeg = 0;
  for (let k = 0; k < fitIdx.length; k += 1) {
    const i = fitIdx[k] as number;
    if ((y[i] as number) === 1) {
      wPos += importance[i] as number;
    } else {
      wNeg += importance[i] as number;
    }
  }
  const cw = wPos > 0 ? Math.pow(wNeg / wPos, posPower) : 1;
  const out = new Float64Array(importance.length);
  for (let i = 0; i < importance.length; i += 1) {
    out[i] = (importance[i] as number) * ((y[i] as number) === 1 ? cw : 1);
  }
  return out;
}

function fitVariant(
  spec: CompiledSpec,
  trainDesign: Float32Array,
  standardizer: Standardizer,
  data: Loaded,
  fitIdx: Int32Array,
  valIdx: Int32Array,
  posPowers: readonly number[],
  maxIters: number,
): FittedVariant {
  const d = spec.dim;
  const sweep: FittedVariant["sweep"] = [];
  let best: { theta: Float64Array; lambda: number; posPower: number; auc: number } | null = null;

  for (const posPower of posPowers) {
    const sw = sampleWeightsFor(data.trainImportance, data.trainY, fitIdx, posPower);
    let warm: Float64Array | undefined;
    // Regularization path from strong → weak; warm starts keep it fast and
    // deterministic (the path is a fixed sequence, no randomness anywhere).
    for (const lambda of LAMBDAS) {
      const fit = fitLogisticL2(trainDesign, d, fitIdx, data.trainY, sw, lambda, maxIters, warm);
      warm = fit.theta;
      const valScores = new Array<number>(valIdx.length);
      for (let k = 0; k < valIdx.length; k += 1) {
        valScores[k] = rowLogit(trainDesign, d, valIdx[k] as number, fit.theta);
      }
      const auc = leadAucOn(valScores, data.trainY, data.trainSecs, valIdx, LEAD_SEC);
      sweep.push({ lambda, posPower, valLeadAuc20: round6(auc), iters: fit.iters });
      if (best === null || auc > best.auc) {
        best = { theta: Float64Array.from(fit.theta), lambda, posPower, auc };
      }
    }
  }
  const chosen = best as { theta: Float64Array; lambda: number; posPower: number; auc: number };

  // Platt on the val split only, importance-weighted so calibration targets
  // natural prevalence rather than the builder's downsampled file.
  const valLogits: number[] = [];
  const valLabels: number[] = [];
  const valWeights: number[] = [];
  for (let k = 0; k < valIdx.length; k += 1) {
    const i = valIdx[k] as number;
    valLogits.push(rowLogit(trainDesign, d, i, chosen.theta));
    valLabels.push(data.trainY[i] as number);
    valWeights.push(data.trainImportance[i] as number);
  }
  const calibration = fitPlatt(valLogits, valLabels, valWeights);

  return {
    spec,
    standardizer,
    theta: chosen.theta,
    calibration,
    lambda: chosen.lambda,
    posPower: chosen.posPower,
    valLeadAuc20: round6(chosen.auc),
    valRocAuc: round6(rocAuc(valLogits, valLabels)),
    params: d + 1,
    sweep,
  };
}

/** Calibrated risk for one raw ENCODED 18-vector (the runtime input shape). */
function makeScorer(variant: FittedVariant): (encoded: readonly number[]) => number {
  const { spec, standardizer, theta, calibration } = variant;
  const d = spec.dim;
  const buf = new Float64Array(d);
  return (encoded: readonly number[]): number => {
    expandRow(spec, encoded, buf);
    let z = theta[d] as number;
    for (let j = 0; j < d; j += 1) {
      z +=
        (theta[j] as number) *
        (((buf[j] as number) - (standardizer.mean[j] as number)) / (standardizer.std[j] as number));
    }
    return sigmoidStable(calibration.a * z + calibration.b);
  };
}

// ---------------------------------------------------------------------------
// Alarm simulation through the SHIPPED escalation reducer
// ---------------------------------------------------------------------------

interface SessionTrace {
  id: string;
  archetype: string;
  durationSec: number;
  risks: Float64Array; // calibrated raw risk per 1 Hz frame
  frames: DecisionFrame[];
  onsets: ReturnType<typeof findDriftOnsets>;
}

function traceSession(session: RawSession, score: (encoded: readonly number[]) => number): SessionTrace {
  const frames = replaySession(session);
  const decisions: DecisionFrame[] = frames.map((frame) => ({
    t: frame.t,
    decision: frame.decision,
    countdownActive: frame.countdownActive,
  }));
  const risks = new Float64Array(frames.length);
  for (let i = 0; i < frames.length; i += 1) {
    risks[i] = score((frames[i] as { values: number[] }).values);
  }
  return {
    id: session.id,
    archetype: session.archetype,
    durationSec: session.durationSec,
    risks,
    frames: decisions,
    onsets: findDriftOnsets(decisions),
  };
}

interface AlarmResult {
  drifts: number;
  /** onsets with a nudge-or-higher alarm raised in the 30 s before onset */
  nudgeHits: number;
  /** onsets pre-armed at/just before onset (the shipped eval's recall@30s rule) */
  prearmHits: number;
  prearmLeads: number[];
  nudgeLeads: number[];
  nudges: number;
  prearms: number;
  falsePrearms: number;
  hours: number;
}

function runEscalation(trace: SessionTrace, settings: EscalationSettings): AlarmResult {
  let state: EscalationState = { ...INITIAL_ESCALATION_STATE };
  let smoothed: number | null = null;
  const events: ForecastEvent[] = [];
  for (let i = 0; i < trace.frames.length; i += 1) {
    const frame = trace.frames[i] as DecisionFrame;
    smoothed = smoothRisk(smoothed, trace.risks[i] as number);
    const stepped = stepEscalation(state, {
      ts: frame.t * 1000,
      risk: smoothed,
      ready: frame.t >= FORECAST_WARMUP_SEC,
      decision: frame.decision,
      countdownActive: frame.countdownActive,
      policySignal: null,
      settings,
    });
    state = stepped.state;
    events.push(...stepped.events);
  }

  const nudgeOrHigher = events
    .filter((event) => event.type === "forecast_nudge" || event.type === "forecast_prearm")
    .map((event) => event.ts / 1000);
  const prearms = events.filter((event) => event.type === "forecast_prearm");
  const hitEvents = events.filter((event) => event.type === "forecast_hit");

  let nudgeHits = 0;
  let prearmHits = 0;
  const nudgeLeads: number[] = [];
  const prearmLeads: number[] = [];
  for (const onset of trace.onsets) {
    // "at least a nudge in the 30 s before onset": any nudge or pre-arm event
    // the reducer emitted inside (onset − 30 s, onset].
    const inWindow = nudgeOrHigher.filter((t) => t <= onset.t && onset.t - t <= 30);
    if (inWindow.length > 0) {
      nudgeHits += 1;
      nudgeLeads.push(onset.t - (inWindow[0] as number));
    }
    // Shipped eval.ts rule, kept for apples-to-apples with the MLP's 0.5641.
    const receipt = hitEvents.find(
      (event) => event.type === "forecast_hit" && Math.abs(event.ts / 1000 - onset.t) <= 1.5,
    );
    if (receipt !== undefined && receipt.type === "forecast_hit") {
      prearmHits += 1;
      prearmLeads.push(receipt.leadSec);
      continue;
    }
    const candidates = prearms.filter(
      (event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30,
    );
    const last = candidates[candidates.length - 1];
    if (last !== undefined) {
      prearmHits += 1;
      prearmLeads.push(onset.t - last.ts / 1000);
    }
  }
  const falsePrearms = events.filter(
    (event) =>
      event.type === "forecast_clear" &&
      event.wasPrearmed &&
      !trace.onsets.some((onset) => onset.t >= event.ts / 1000 && onset.t - event.ts / 1000 <= 30),
  ).length;

  return {
    drifts: trace.onsets.length,
    nudgeHits,
    prearmHits,
    prearmLeads,
    nudgeLeads,
    nudges: events.filter((event) => event.type === "forecast_nudge").length,
    prearms: prearms.length,
    falsePrearms,
    hours: trace.durationSec / 3600,
  };
}

interface AlarmTotals {
  drifts: number;
  nudgeHits: number;
  prearmHits: number;
  nudges: number;
  prearms: number;
  falsePrearms: number;
  hours: number;
  sessions: number;
  prearmLeads: number[];
  nudgeLeads: number[];
}

function emptyTotals(): AlarmTotals {
  return {
    drifts: 0,
    nudgeHits: 0,
    prearmHits: 0,
    nudges: 0,
    prearms: 0,
    falsePrearms: 0,
    hours: 0,
    sessions: 0,
    prearmLeads: [],
    nudgeLeads: [],
  };
}

function accumulate(target: AlarmTotals, result: AlarmResult): void {
  target.drifts += result.drifts;
  target.nudgeHits += result.nudgeHits;
  target.prearmHits += result.prearmHits;
  target.nudges += result.nudges;
  target.prearms += result.prearms;
  target.falsePrearms += result.falsePrearms;
  target.hours += result.hours;
  target.sessions += 1;
  target.prearmLeads.push(...result.prearmLeads);
  target.nudgeLeads.push(...result.nudgeLeads);
}

// ---------------------------------------------------------------------------

function operatingPoint(
  scores: readonly number[],
  y: Uint8Array,
  threshold: number,
): { threshold: number; precision: number | null; recall: number; fpr: number } {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;
  for (let i = 0; i < scores.length; i += 1) {
    const fired = (scores[i] as number) >= threshold;
    if ((y[i] as number) === 1) {
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

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  mkdirSync(config.outDir, { recursive: true });

  console.log(`[${CANDIDATE}] loading ${config.data} …`);
  const data = await load(config.data);
  const nTrain = data.trainY.length;
  const nEval = data.evalY.length;
  console.log(
    `[${CANDIDATE}] train rows ${nTrain} (${data.trainSessions.length} sessions) | eval rows ${nEval}`,
  );

  // --- Train-internal val split: EXACTLY train.ts's procedure ---------------
  const rand = mulberry32(config.seed);
  const sessionOrder = shuffled(
    Array.from({ length: data.trainSessions.length }, (_, i) => i),
    rand,
  );
  const valSessionCount = Math.max(
    1,
    Math.round(data.trainSessions.length * config.valFraction),
  );
  const valSessions = new Set<number>(sessionOrder.slice(0, valSessionCount));
  const fitList: number[] = [];
  const valList: number[] = [];
  for (let i = 0; i < nTrain; i += 1) {
    (valSessions.has(data.trainSessionOf[i] as number) ? valList : fitList).push(i);
  }
  const fitIdx = Int32Array.from(fitList);
  const valIdx = Int32Array.from(valList);
  console.log(
    `[${CANDIDATE}] fit ${fitIdx.length} rows | val ${valIdx.length} rows ` +
      `(${valSessionCount}/${data.trainSessions.length} train sessions, seed ${config.seed})`,
  );

  // --- Strongest features, ranked on the FIT subset only --------------------
  const univariate = FORECAST_FEATURE_KEYS.map((key, f) => {
    const scores = new Array<number>(fitIdx.length);
    for (let k = 0; k < fitIdx.length; k += 1) {
      scores[k] = data.trainBase[(fitIdx[k] as number) * BASE_DIM + f] as number;
    }
    const auc = leadAucOn(scores, data.trainY, data.trainSecs, fitIdx, LEAD_SEC);
    return { key, index: f, fitLeadAuc20: round6(auc), strength: Math.abs(auc - 0.5) };
  }).sort((a, b) => b.strength - a.strength);
  const topFeatures = univariate.slice(0, config.topFeatures).map((entry) => entry.index);
  console.log(
    `[${CANDIDATE}] strongest features (train-fit lead≥20s AUC): ` +
      univariate
        .slice(0, config.topFeatures)
        .map((entry) => `${entry.key} ${entry.fitLeadAuc20.toFixed(4)}`)
        .join(", "),
  );

  const knotQuantiles = [1 / 6, 2 / 6, 3 / 6, 4 / 6, 5 / 6];
  const splines = splineTerms(data.trainBase, fitIdx, topFeatures, knotQuantiles);
  const pairwise = pairwiseTerms();

  const specs: CompiledSpec[] = [
    compileSpec("lr18", BASE_DIM, linTerms()),
    compileSpec("lr18+pairwise", BASE_DIM, [...linTerms(), ...pairwise]),
    compileSpec("lr18+splines", BASE_DIM, [...linTerms(), ...splines]),
    compileSpec("lr18+splines+pairwise", BASE_DIM, [...linTerms(), ...pairwise, ...splines]),
  ];

  // --- Fit every variant -----------------------------------------------------
  const fitted: FittedVariant[] = [];
  let bestPosPower = 0.5;
  for (let v = 0; v < specs.length; v += 1) {
    const spec = specs[v] as CompiledSpec;
    const t0 = Date.now();
    const trainDesign = buildDesign(data.trainBase, nTrain, spec);
    const standardizer = fitStandardizer(trainDesign, spec.dim, fitIdx);
    applyStandardizer(trainDesign, spec.dim, standardizer);
    // Class-weight power is tuned once, on the cheap base variant, then held
    // fixed for the expansions (keeps the sweep honest and the runtime sane).
    const posPowers = v === 0 ? [0, 0.5, 1] : [bestPosPower];
    const variant = fitVariant(
      spec,
      trainDesign,
      standardizer,
      data,
      fitIdx,
      valIdx,
      posPowers,
      config.maxIters,
    );
    if (v === 0) {
      bestPosPower = variant.posPower;
    }
    fitted.push(variant);
    console.log(
      `[${CANDIDATE}] ${spec.name.padEnd(22)} d=${String(spec.dim).padStart(3)} ` +
        `λ=${variant.lambda} posPow=${variant.posPower} ` +
        `VAL lead≥20s ${variant.valLeadAuc20.toFixed(4)} | ${((Date.now() - t0) / 1000).toFixed(1)}s`,
    );
  }

  // --- Variant selection on VAL (never eval) --------------------------------
  let headline = fitted[0] as FittedVariant;
  for (const variant of fitted) {
    if (variant.valLeadAuc20 > headline.valLeadAuc20) {
      headline = variant;
    }
  }
  console.log(`[${CANDIDATE}] variant selected on VAL: ${headline.spec.name}`);

  // --- Held-out scoring for EVERY variant (transparency) ---------------------
  const evalRowIdx = null;
  const variantReports = fitted.map((variant) => {
    const design = buildDesign(data.evalBase, nEval, variant.spec);
    applyStandardizer(design, variant.spec.dim, variant.standardizer);
    const logits = new Array<number>(nEval);
    for (let i = 0; i < nEval; i += 1) {
      logits[i] = rowLogit(design, variant.spec.dim, i, variant.theta);
    }
    const risks = logits.map((z) =>
      sigmoidStable(variant.calibration.a * z + variant.calibration.b),
    );
    const calib = ece10(risks, Array.from(data.evalY));
    return {
      variant,
      risks,
      report: {
        name: variant.spec.name,
        params: variant.params,
        lambda: variant.lambda,
        posWeightPower: variant.posPower,
        valLeadAuc20: variant.valLeadAuc20,
        evalLeadAuc20: round4(leadAucOn(logits, data.evalY, data.evalSecs, evalRowIdx, 20)),
        evalLeadAuc10: round4(leadAucOn(logits, data.evalY, data.evalSecs, evalRowIdx, 10)),
        evalRocAuc: round4(rocAuc(logits, Array.from(data.evalY))),
        evalPrAuc: round4(prAuc(risks, Array.from(data.evalY))),
        ece: round4(calib.ece),
      },
    };
  });
  for (const entry of variantReports) {
    const r = entry.report;
    console.log(
      `[${CANDIDATE}] EVAL ${r.name.padEnd(22)} lead≥20s ${r.evalLeadAuc20.toFixed(4)} | ` +
        `ROC ${r.evalRocAuc.toFixed(4)} | PR ${r.evalPrAuc.toFixed(4)} | ECE ${r.ece.toFixed(4)} | ` +
        `${r.params} params`,
    );
  }
  const headlineEntry = variantReports.find((entry) => entry.variant === headline) as
    (typeof variantReports)[number];
  const headlineRisks = headlineEntry.risks;

  // --- eval.ts's own full-18 logistic baseline, reproduced verbatim ---------
  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(data.evalTsTrainX.length / cap));
  const subX: number[][] = [];
  const subY: number[] = [];
  for (let i = 0; i < data.evalTsTrainX.length; i += stride) {
    subX.push(data.evalTsTrainX[i] as number[]);
    subY.push(data.evalTsTrainY[i] as number);
  }
  const allColumns = FORECAST_FEATURE_KEYS.map((_, i) => i);
  const evalTsFull = trainLogistic(subX, subY, allColumns);
  const evalTsScores: number[] = [];
  for (let i = 0; i < nEval; i += 1) {
    const row: number[] = [];
    for (let f = 0; f < BASE_DIM; f += 1) {
      row.push(data.evalBase[i * BASE_DIM + f] as number);
    }
    evalTsScores.push(logisticScore(evalTsFull, row, allColumns));
  }
  const evalTsFullLeadAuc20 = round4(
    leadAucOn(evalTsScores, data.evalY, data.evalSecs, evalRowIdx, 20),
  );
  const evalTsFullRoc = round4(rocAuc(evalTsScores, Array.from(data.evalY)));
  console.log(
    `[${CANDIDATE}] eval.ts fullLogistic18 replica: lead≥20s ${evalTsFullLeadAuc20} | ROC ${evalTsFullRoc}`,
  );

  // --- Alarm simulation over held-out RAW sessions ---------------------------
  const thresholds = await thresholdDefaults();
  const score = makeScorer(headline);
  const traces: SessionTrace[] = [];
  for await (const session of readJsonl<RawSession>(config.raw)) {
    if (session.source !== "synthetic" || splitForSession(session.id, config.seed) !== "eval") {
      continue;
    }
    traces.push(traceSession(session, score));
  }
  console.log(`[${CANDIDATE}] traced ${traces.length} held-out raw sessions`);

  const simulateAt = (
    nudgeRisk: number,
    prearmRisk: number,
  ): { totals: AlarmTotals; byArchetype: Map<string, AlarmTotals> } => {
    const settings: EscalationSettings = {
      nudgeRisk,
      prearmRisk,
      prearmEnabled: true,
      prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
      baseFuseSec: DEFAULT_SETTINGS.countdownSec,
    };
    const totals = emptyTotals();
    const byArchetype = new Map<string, AlarmTotals>();
    for (const trace of traces) {
      const result = runEscalation(trace, settings);
      accumulate(totals, result);
      const bucket = byArchetype.get(trace.archetype) ?? emptyTotals();
      accumulate(bucket, result);
      byArchetype.set(trace.archetype, bucket);
    }
    return { totals, byArchetype };
  };

  // Recommended operating point = the SHIPPED defaults (nudge 0.55 / pre-arm
  // 0.80). Keeping them makes every number here directly comparable to the
  // shipped report and keeps operating-point parity with DEFAULT_SETTINGS.
  const recommended = { nudge: thresholds.nudge, prearm: thresholds.prearm };
  const atRecommended = simulateAt(recommended.nudge, recommended.prearm);
  const totals = atRecommended.totals;
  totals.prearmLeads.sort((a, b) => a - b);
  totals.nudgeLeads.sort((a, b) => a - b);

  // Diagnostic sweep (reported, NOT used to pick the recommendation).
  const sweep = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7].map((nudge) => {
    const run = simulateAt(nudge, recommended.prearm);
    const churn = run.byArchetype.get("research_churn");
    return {
      nudgeRisk: nudge,
      prearmRisk: recommended.prearm,
      recallAt30sNudge: run.totals.drifts > 0 ? round4(run.totals.nudgeHits / run.totals.drifts) : null,
      recallAt30sPrearm:
        run.totals.drifts > 0 ? round4(run.totals.prearmHits / run.totals.drifts) : null,
      nudgesPerHour: run.totals.hours > 0 ? round4(run.totals.nudges / run.totals.hours) : null,
      researchChurnNudgesPerHour:
        churn && churn.hours > 0 ? round4(churn.nudges / churn.hours) : 0,
    };
  });

  // --- Per-archetype frame slices (same computation as eval.ts) --------------
  const archetypes = [...new Set(data.evalArchetype)].sort();
  const perArchetype: Record<string, unknown> = {};
  for (const archetype of archetypes) {
    let frames = 0;
    let positives = 0;
    let negatives = 0;
    let fpNudge = 0;
    let fpPrearm = 0;
    for (let i = 0; i < nEval; i += 1) {
      if (data.evalArchetype[i] !== archetype) {
        continue;
      }
      frames += 1;
      if ((data.evalY[i] as number) === 1) {
        positives += 1;
        continue;
      }
      negatives += 1;
      const risk = headlineRisks[i] as number;
      if (risk >= recommended.nudge) fpNudge += 1;
      if (risk >= recommended.prearm) fpPrearm += 1;
    }
    const alarms = atRecommended.byArchetype.get(archetype);
    perArchetype[archetype] = {
      frames,
      baseRate: round4(positives / Math.max(1, frames)),
      falsePositiveRateAtNudge: round4(fpNudge / Math.max(1, negatives)),
      falsePositiveRateAtPrearm: round4(fpPrearm / Math.max(1, negatives)),
      sessions: alarms?.sessions ?? 0,
      drifts: alarms?.drifts ?? 0,
      nudgeHits: alarms?.nudgeHits ?? 0,
      prearmHits: alarms?.prearmHits ?? 0,
      nudgesPerHour: alarms && alarms.hours > 0 ? round4(alarms.nudges / alarms.hours) : 0,
      falsePrearmsPerHour:
        alarms && alarms.hours > 0 ? round4(alarms.falsePrearms / alarms.hours) : 0,
    };
  }
  const churnSlice = perArchetype["research_churn"] as { falsePositiveRateAtNudge: number };

  // --- Coefficients of the headline model (top magnitudes) -------------------
  const coefficients = Array.from({ length: headline.spec.dim }, (_, j) => ({
    term: termName(headline.spec.terms[j] as Term, FORECAST_FEATURE_KEYS),
    weight: round6(headline.theta[j] as number),
  }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
    .slice(0, 25);

  const headlineReport = headlineEntry.report;
  const bestLinearLead20 = Math.max(
    ...variantReports.map((entry) => entry.report.evalLeadAuc20),
  );

  const metrics = {
    candidate: CANDIDATE,
    approach:
      "L2-tuned multivariate logistic regression (GLM) on the 18 shipped encoded features, " +
      "plus pairwise-interaction and quantile-hinge-spline basis expansions; L-BFGS, " +
      "importance-weighted, Platt-calibrated on a train-internal validation split.",
    seed: config.seed,
    createdBy: "scripts/forecast/candidates/lr-ceiling.ts",
    dataset: {
      file: config.data,
      trainRows: nTrain,
      trainSessions: data.trainSessions.length,
      evalRows: nEval,
      evalSessions: new Set(data.evalSessionIds).size,
      evalBaseRate: round4(
        Array.from(data.evalY).reduce<number>((sum, v) => sum + v, 0) / Math.max(1, nEval),
      ),
      fitRows: fitIdx.length,
      valRows: valIdx.length,
      valSessions: valSessionCount,
      rebuilt: false,
      note: "dataset.jsonl read as-is; split=='eval' rows never touched by any fit or selection step",
    },
    headline: {
      variant: headline.spec.name,
      params: headline.params,
      lambda: headline.lambda,
      posWeightPower: headline.posPower,
      calibration: { a: round6(headline.calibration.a), b: round6(headline.calibration.b) },
      selectedOn: "train-internal validation lead-censored (≥20 s) ROC-AUC",
      metrics: {
        aucLead20: headlineReport.evalLeadAuc20,
        aucLead10: headlineReport.evalLeadAuc10,
        rocAuc: headlineReport.evalRocAuc,
        prAuc: headlineReport.evalPrAuc,
        ece: headlineReport.ece,
      },
    },
    variants: variantReports.map((entry) => entry.report),
    bestLinearFamilyLeadAuc20: round4(bestLinearLead20),
    crossCheck: {
      fullLogistic18_evalTsReplica: {
        leadAuc20: evalTsFullLeadAuc20,
        rocAuc: evalTsFullRoc,
        note:
          "verbatim reproduction of eval.ts's fullLogistic18 baseline (lib.trainLogistic, " +
          "40k stride subsample, class-weighted GD) — the shared cross-check number",
      },
      fullLogistic18_tuned: {
        leadAuc20: (variantReports[0] as (typeof variantReports)[number]).report.evalLeadAuc20,
        rocAuc: (variantReports[0] as (typeof variantReports)[number]).report.evalRocAuc,
        note: "same 18 features, but L-BFGS to convergence with L2 tuned on the val split",
      },
      shippedMlp: {
        leadAuc20: 0.9248,
        rocAuc: 0.9614,
        note: "quoted from src/shared/forecast/eval-report.json for orientation; not recomputed here",
      },
    },
    univariate: univariate.map((entry) => ({
      key: entry.key,
      fitLeadAuc20: entry.fitLeadAuc20,
    })),
    operatingPoint: {
      recommended,
      rationale:
        "the SHIPPED defaults (DEFAULT_SETTINGS forecastNudgeRisk/forecastPrearmRisk) — the model " +
        "is Platt-calibrated to natural prevalence, so the frozen thresholds stay meaningful and " +
        "every number is directly comparable with the shipped report",
      source: thresholds.source,
      frameLevel: {
        nudge: operatingPoint(headlineRisks, data.evalY, recommended.nudge),
        prearm: operatingPoint(headlineRisks, data.evalY, recommended.prearm),
      },
    },
    alarms: {
      rule:
        "recallAt30sNudge = fraction of held-out drift onsets with a forecast_nudge or " +
        "forecast_prearm event from the SHIPPED stepEscalation reducer inside (onset−30 s, onset]",
      sessions: totals.sessions,
      evalHours: round4(totals.hours),
      drifts: totals.drifts,
      recallAt30sNudge: totals.drifts > 0 ? round4(totals.nudgeHits / totals.drifts) : null,
      nudgeHits: totals.nudgeHits,
      nudgeMisses: totals.drifts - totals.nudgeHits,
      medianNudgeLeadSec: percentile(totals.nudgeLeads, 0.5),
      recallAt30sPrearm: totals.drifts > 0 ? round4(totals.prearmHits / totals.drifts) : null,
      prearmHits: totals.prearmHits,
      medianPrearmLeadSec: percentile(totals.prearmLeads, 0.5),
      p25PrearmLeadSec: percentile(totals.prearmLeads, 0.25),
      nudgesPerHour: totals.hours > 0 ? round4(totals.nudges / totals.hours) : null,
      falsePrearmsPerHour: totals.hours > 0 ? round4(totals.falsePrearms / totals.hours) : null,
      settings: {
        nudgeRisk: recommended.nudge,
        prearmRisk: recommended.prearm,
        prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
        baseFuseSec: DEFAULT_SETTINGS.countdownSec,
      },
    },
    thresholdSweep: sweep,
    researchChurn: {
      fprAtNudge: churnSlice.falsePositiveRateAtNudge,
      note: "frame-level false-positive rate on research_churn eval frames (zero drifts) at the recommended nudge threshold — same computation as eval.ts perArchetype",
    },
    perArchetype,
    headlineCoefficients: coefficients,
  };
  // Wall clock is deliberately kept OUT of the artifact: two runs at the same
  // seed must produce a byte-identical metrics.json.
  const runtimeSec = round4((Date.now() - startedAt) / 1000);

  const outFile = join(config.outDir, "metrics.json");
  writeFileSync(outFile, `${JSON.stringify(metrics, null, 2)}\n`);

  console.log("\n===== lr-ceiling METRICS (JSON) =====");
  console.log(
    JSON.stringify(
      {
        candidate: CANDIDATE,
        headlineVariant: metrics.headline.variant,
        params: metrics.headline.params,
        aucLead20: metrics.headline.metrics.aucLead20,
        aucLead10: metrics.headline.metrics.aucLead10,
        rocAuc: metrics.headline.metrics.rocAuc,
        prAuc: metrics.headline.metrics.prAuc,
        ece: metrics.headline.metrics.ece,
        recallAt30sNudge: metrics.alarms.recallAt30sNudge,
        recallAt30sPrearm: metrics.alarms.recallAt30sPrearm,
        fprResearchChurn: metrics.researchChurn.fprAtNudge,
        fullLogistic18_evalTsReplica_leadAuc20: evalTsFullLeadAuc20,
        fullLogistic18_tuned_leadAuc20: metrics.crossCheck.fullLogistic18_tuned.leadAuc20,
        bestLinearFamilyLeadAuc20: metrics.bestLinearFamilyLeadAuc20,
        operatingPoint: recommended,
      },
      null,
      2,
    ),
  );
  console.log(`\n[${CANDIDATE}] wrote ${outFile} in ${runtimeSec}s`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
