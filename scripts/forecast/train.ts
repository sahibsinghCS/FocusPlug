import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
import {
  INITIAL_ESCALATION_STATE,
  smoothRisk,
  stepEscalation,
  type EscalationSettings,
  type EscalationState,
} from "../../src/shared/forecast/escalate";
import { findDriftOnsets, type DecisionFrame } from "../../src/shared/forecast/labels";
import {
  FORECAST_BASIS,
  FORECAST_BASIS_SHA,
  FORECAST_INPUT_DIM,
  FORECAST_PARAM_COUNT,
  FORECAST_TERM_COUNT,
  FORECAST_TERM_KEYS,
  forward,
  parseForecastWeights,
} from "../../src/shared/forecast/model";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  FORECAST_WARMUP_SEC,
  type ForecastEvent,
  type ForecastWeightsFile,
} from "../../src/shared/forecast/types";
import {
  ALARM_BUDGET_REFERENCE_NUDGE_RISK,
  ALARM_LOAD_ALLOWANCE,
  CHURN_FPR_CEILING,
  CONTRACT_PREARM_FUSE_SEC,
  DATASET_FILE,
  FALSE_PREARM_CEILING_PER_HOUR,
  MANIFEST_FILE,
  PROVENANCE_FILE,
  RAW_SESSIONS_FILE,
  canonicalJson,
  forecastDataRoot,
  keepProbability,
  mulberry32,
  numberArg,
  readJsonl,
  repoRoot,
  replaySession,
  rocAuc,
  round4,
  round6,
  sha256Hex,
  shuffled,
  splitForSession,
  stringArg,
  thresholdDefaults,
  type DatasetManifest,
  type DatasetRow,
  type RawSession,
} from "./lib";
import {
  applyStandardizer,
  buildBasisDesign,
  fitLogisticL2,
  fitPlatt,
  fitStandardizer,
  foldStandardizer,
  logisticObjective,
  rowLogit,
  type Standardizer,
} from "./linear";

/**
 * Deterministic trainer for the shipped Focus Forecast head: an
 * L2-regularized multivariate LOGISTIC REGRESSION over the encoded features
 * plus every pairwise product and square (`FORECAST_TERM_COUNT` terms,
 * `FORECAST_PARAM_COUNT` params), fitted with L-BFGS to convergence. Only `split: "train"` rows are ever read;
 * the held-out eval split is scored exclusively by eval.ts.
 *
 * WHY A GLM AND NOT THE OLD 18→12→1 MLP: the five-family bake-off in
 * `scripts/forecast/GAUNTLET.md` found that no non-linear model beat the
 * strongest linear-family result by a margin this eval set can resolve, while
 * a plain 19-parameter logistic already beat the shipped MLP on the headline
 * lead-censored metric. The convex model with the readable coefficients ships.
 *
 * Protocol (identical to the winning bake-off contender, `lr-ceiling`):
 * - val = 10 % of train SESSIONS (seeded, exactly the split the old trainer
 *   used), for hyper-parameter selection, Platt calibration and the operating
 *   point only — never a gradient update;
 * - the class-weight power is swept once on the CHEAP additive variant
 *   ({0, 0.5, 1}), then held fixed for the expansion;
 * - L2 λ is swept over a warm-started regularization path {1 … 1e-6}, and the
 *   winner is chosen by train-internal VAL lead-censored (≥ 20 s) ROC-AUC —
 *   the same metric eval.ts gates on, computed on rows eval.ts never sees;
 * - sample weights are 1/keep-probability (undoing the builder's train-only
 *   calm-negative downsampling) times the class weight, so Platt targets
 *   NATURAL prevalence rather than the rebalanced file;
 * - the fitted standardizer is FOLDED into the coefficients, so the artifact
 *   is `FORECAST_PARAM_COUNT` flat floats plus the Platt pair;
 * - the operating point is re-selected on train-internal VAL SESSIONS through
 *   the SHIPPED escalation reducer, under hard alarm ceilings (§ lib.ts), and
 *   compared against DEFAULT_SETTINGS with a loud WARN on disagreement;
 * - a finite-difference gradient check on the REAL objective closure runs
 *   before every training run (rel err < 1e-4) — the optimizer is proved, not
 *   presumed.
 *
 * The plain 19-parameter logistic is also fitted and recorded in provenance:
 * it is the "did you try logistic regression?" reference point, and it is the
 * baseline eval.ts's gate is anchored to.
 *
 * Output: src/shared/forecast/weights.json (must pass parseForecastWeights)
 * plus data/forecast/provenance.json, whose sha256 is embedded in the weights
 * and asserted by eval.ts (provenance can be skipped, never faked).
 *
 *   tsx scripts/forecast/train.ts --seed 42
 */

interface TrainConfig {
  data: string;
  raw: string;
  out: string;
  seed: number;
  iters: number;
  valFraction: number;
  posWeightPower: number | null;
}

function readConfig(): TrainConfig {
  const posPower = stringArg("--pos-weight-power", "sweep");
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    out: stringArg("--out", join(repoRoot(), "src", "shared", "forecast", "weights.json")),
    seed: numberArg("--seed", 42),
    iters: numberArg("--iters", 300),
    valFraction: numberArg("--val", 0.1),
    // w_pos = (Σw_neg/Σw_pos)^power. Default: swept over {0, 0.5, 1} on the
    // cheap additive variant and then held fixed for the pairwise expansion.
    posWeightPower: posPower === "sweep" ? null : Number(posPower),
  };
}

/** Name of the plain additive reference fit — the "did you try logistic regression?" model. */
const PLAIN_BASIS = `lr${FORECAST_INPUT_DIM}`;

/** Warm-started regularization path, strong → weak. */
const LAMBDAS = [1, 1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6];
const POS_POWERS = [0, 0.5, 1];
/** Lead-censoring used for MODEL SELECTION on val — the same rule eval.ts gates on. */
const SELECTION_LEAD_SEC = 20;
/** Candidate nudge thresholds for the train-internal operating-point search. */
const NUDGE_GRID = [0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7];

// ---------------------------------------------------------------------------
// Gradient check — finite difference vs analytic on the REAL objective
// ---------------------------------------------------------------------------

/**
 * Builds a tiny deterministic problem and finite-differences the exact
 * `fg` closure `fitLogisticL2` optimizes. Same code path, so a green check is
 * evidence about the shipped optimizer rather than about a toy copy of it.
 */
function gradientCheck(): void {
  const rand = mulberry32(1234);
  const n = 24;
  const d = 5;
  const X = new Float32Array(n * d);
  for (let i = 0; i < X.length; i += 1) {
    X[i] = rand() * 2 - 1;
  }
  const y = new Uint8Array(n);
  const weight = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    y[i] = rand() < 0.35 ? 1 : 0;
    weight[i] = 0.5 + rand() * 3;
  }
  const idx = Int32Array.from({ length: n }, (_, i) => i);
  const fg = logisticObjective(X, d, idx, y, weight, 3e-3);

  const theta = new Float64Array(d + 1);
  for (let j = 0; j <= d; j += 1) {
    theta[j] = rand() - 0.5;
  }
  const analytic = new Float64Array(d + 1);
  fg(theta, analytic);

  const scratch = new Float64Array(d + 1);
  const eps = 1e-6;
  let worst = 0;
  for (let j = 0; j <= d; j += 1) {
    const kept = theta[j] as number;
    theta[j] = kept + eps;
    const up = fg(theta, scratch);
    theta[j] = kept - eps;
    const down = fg(theta, scratch);
    theta[j] = kept;
    const numeric = (up - down) / (2 * eps);
    const rel =
      Math.abs(numeric - (analytic[j] as number)) /
      Math.max(1e-8, Math.abs(numeric) + Math.abs(analytic[j] as number));
    worst = Math.max(worst, rel);
  }
  if (worst > 1e-4) {
    throw new Error(`gradient check FAILED: worst relative error ${worst.toExponential(3)}`);
  }
  console.log(
    `gradient check ok (weighted L2 logistic objective, 6 params, worst rel err ${worst.toExponential(2)})`,
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface LoadedRows {
  base: Float32Array; // n × 18, encoded (pre-standardization)
  y: Uint8Array;
  secs: Float64Array; // NaN ⇒ no onset ahead
  importance: Float64Array; // 1/keep-probability
  sessionOf: Int32Array;
  sessions: string[];
}

async function loadTrainRows(file: string): Promise<LoadedRows> {
  const base: number[] = [];
  const y: number[] = [];
  const secs: number[] = [];
  const importance: number[] = [];
  const sessionOf: number[] = [];
  const sessions: string[] = [];
  const sessionIndex = new Map<string, number>();
  for await (const row of readJsonl<DatasetRow>(file)) {
    if (row.split !== "train") {
      continue;
    }
    let index = sessionIndex.get(row.session_id);
    if (index === undefined) {
      index = sessions.length;
      sessionIndex.set(row.session_id, index);
      sessions.push(row.session_id);
    }
    for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
      base.push(row.features[i] ?? 0);
    }
    y.push(row.label);
    secs.push(row.secs_to_drift === null ? Number.NaN : row.secs_to_drift);
    importance.push(1 / keepProbability(row.label, row.secs_to_drift));
    sessionOf.push(index);
  }
  return {
    base: Float32Array.from(base),
    y: Uint8Array.from(y),
    secs: Float64Array.from(secs),
    importance: Float64Array.from(importance),
    sessionOf: Int32Array.from(sessionOf),
    sessions,
  };
}

/** eval.ts's lead-censored eligibility, on train rows: onset ≥ lead s away, or calm. */
function leadAucOverRows(
  scores: readonly number[],
  rows: Int32Array,
  y: Uint8Array,
  secs: Float64Array,
  leadSec: number,
): number {
  const s: number[] = [];
  const l: number[] = [];
  for (let k = 0; k < rows.length; k += 1) {
    const row = rows[k] as number;
    const sec = secs[row] as number;
    if (Number.isNaN(sec) || sec >= leadSec) {
      s.push(scores[k] as number);
      l.push(y[row] as number);
    }
  }
  return rocAuc(s, l);
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

interface SweepEntry {
  lambda: number;
  posPower: number;
  valLeadAuc20: number;
  iters: number;
}

interface Fitted {
  name: string;
  dim: number;
  theta: Float64Array;
  standardizer: Standardizer;
  lambda: number;
  posPower: number;
  valLeadAuc20: number;
  valRocAuc: number;
  params: number;
  sweep: SweepEntry[];
}

/** L2 path (× class-weight powers) selected on the train-internal val split. */
function fitVariant(
  name: string,
  design: Float32Array,
  dim: number,
  standardizer: Standardizer,
  rows: LoadedRows,
  fitIdx: Int32Array,
  valIdx: Int32Array,
  posPowers: readonly number[],
  maxIters: number,
): Fitted {
  const sweep: SweepEntry[] = [];
  let best: { theta: Float64Array; lambda: number; posPower: number; auc: number } | null = null;
  for (const posPower of posPowers) {
    const sw = sampleWeightsFor(rows.importance, rows.y, fitIdx, posPower);
    let warm: Float64Array | undefined;
    for (const lambda of LAMBDAS) {
      const fit = fitLogisticL2(design, dim, fitIdx, rows.y, sw, lambda, maxIters, warm);
      warm = fit.theta;
      const valScores = new Array<number>(valIdx.length);
      for (let k = 0; k < valIdx.length; k += 1) {
        valScores[k] = rowLogit(design, dim, valIdx[k] as number, fit.theta);
      }
      const auc = leadAucOverRows(valScores, valIdx, rows.y, rows.secs, SELECTION_LEAD_SEC);
      sweep.push({ lambda, posPower, valLeadAuc20: round6(auc), iters: fit.iters });
      if (best === null || auc > best.auc) {
        best = { theta: Float64Array.from(fit.theta), lambda, posPower, auc };
      }
    }
  }
  const chosen = best as { theta: Float64Array; lambda: number; posPower: number; auc: number };
  const valLogits: number[] = [];
  const valLabels: number[] = [];
  for (let k = 0; k < valIdx.length; k += 1) {
    const i = valIdx[k] as number;
    valLogits.push(rowLogit(design, dim, i, chosen.theta));
    valLabels.push(rows.y[i] as number);
  }
  return {
    name,
    dim,
    theta: chosen.theta,
    standardizer,
    lambda: chosen.lambda,
    posPower: chosen.posPower,
    valLeadAuc20: round6(chosen.auc),
    valRocAuc: round6(rocAuc(valLogits, valLabels)),
    params: dim + 1,
    sweep,
  };
}

// ---------------------------------------------------------------------------
// Operating point: re-selected on CROSS-FITTED TRAIN sessions, through the
// SHIPPED escalation reducer, under the alarm budget in lib.ts.
// ---------------------------------------------------------------------------

interface SessionTrace {
  archetype: string;
  durationSec: number;
  risks: Float64Array;
  frames: DecisionFrame[];
  onsets: ReturnType<typeof findDriftOnsets>;
  labels: Int8Array; // 1 ⇒ onset within the horizon, 0 ⇒ negative frame
}

interface ThresholdRow {
  nudgeRisk: number;
  prearmRisk: number;
  recallAt30sNudge: number;
  recallAt30sPrearm: number;
  nudgesPerHour: number;
  falsePrearmsPerHour: number;
  researchChurnFprAtNudge: number;
  admissible?: boolean;
}

function traceForThresholds(session: RawSession, weights: ForecastWeightsFile): SessionTrace {
  const frames = replaySession(session);
  const decisions: DecisionFrame[] = frames.map((frame) => ({
    t: frame.t,
    decision: frame.decision,
    countdownActive: frame.countdownActive,
  }));
  const onsets = findDriftOnsets(decisions);
  const risks = new Float64Array(frames.length);
  const labels = new Int8Array(frames.length);
  for (let i = 0; i < frames.length; i += 1) {
    risks[i] = forward(weights, (frames[i] as { values: number[] }).values).rawRisk;
    const t = (frames[i] as { t: number }).t;
    const next = onsets.find((onset) => onset.t > t);
    labels[i] = next !== undefined && next.t - t <= FORECAST_HORIZON_SEC ? 1 : 0;
  }
  return { archetype: session.archetype, durationSec: session.durationSec, risks, frames: decisions, onsets, labels };
}

function scoreThreshold(
  traces: readonly SessionTrace[],
  nudgeRisk: number,
  prearmRisk: number,
): ThresholdRow {
  const settings: EscalationSettings = {
    nudgeRisk,
    prearmRisk,
    prearmEnabled: true,
    prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
    baseFuseSec: DEFAULT_SETTINGS.countdownSec,
  };
  let drifts = 0;
  let nudgeHits = 0;
  let prearmHits = 0;
  let nudges = 0;
  let falsePrearms = 0;
  let hours = 0;
  let churnNegatives = 0;
  let churnFires = 0;

  for (const trace of traces) {
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
      if (trace.archetype === "research_churn" && (trace.labels[i] as number) === 0) {
        churnNegatives += 1;
        if ((trace.risks[i] as number) >= nudgeRisk) {
          churnFires += 1;
        }
      }
    }
    const alarms = events
      .filter((event) => event.type === "forecast_nudge" || event.type === "forecast_prearm")
      .map((event) => event.ts / 1000);
    const prearms = events.filter((event) => event.type === "forecast_prearm");
    const hitEvents = events.filter((event) => event.type === "forecast_hit");
    for (const onset of trace.onsets) {
      drifts += 1;
      if (alarms.some((t) => t <= onset.t && onset.t - t <= 30)) {
        nudgeHits += 1;
      }
      const receipt = hitEvents.find(
        (event) => event.type === "forecast_hit" && Math.abs(event.ts / 1000 - onset.t) <= 1.5,
      );
      if (receipt !== undefined) {
        prearmHits += 1;
        continue;
      }
      if (prearms.some((event) => event.ts / 1000 <= onset.t && onset.t - event.ts / 1000 <= 30)) {
        prearmHits += 1;
      }
    }
    falsePrearms += events.filter(
      (event) =>
        event.type === "forecast_clear" &&
        event.wasPrearmed &&
        !trace.onsets.some((onset) => onset.t >= event.ts / 1000 && onset.t - event.ts / 1000 <= 30),
    ).length;
    nudges += events.filter((event) => event.type === "forecast_nudge").length;
    hours += trace.durationSec / 3600;
  }

  const nudgesPerHour = hours > 0 ? nudges / hours : 0;
  const falsePrearmsPerHour = hours > 0 ? falsePrearms / hours : 0;
  const churnFpr = churnNegatives > 0 ? churnFires / churnNegatives : 0;
  return {
    nudgeRisk,
    prearmRisk,
    recallAt30sNudge: round4(drifts > 0 ? nudgeHits / drifts : 0),
    recallAt30sPrearm: round4(drifts > 0 ? prearmHits / drifts : 0),
    nudgesPerHour: round4(nudgesPerHour),
    falsePrearmsPerHour: round4(falsePrearmsPerHour),
    researchChurnFprAtNudge: round6(churnFpr),
  };
}

// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  gradientCheck();

  const manifest = JSON.parse(
    readFileSync(join(forecastDataRoot(), MANIFEST_FILE), "utf8"),
  ) as DatasetManifest;
  const rows = await loadTrainRows(config.data);
  const n = rows.y.length;
  if (n === 0) {
    throw new Error("no train rows found — run build-dataset.ts first");
  }

  // Val = 10 % of train SESSIONS (seeded) — the identical procedure the old
  // MLP trainer used, so the split is comparable across the whole gauntlet.
  const rand = mulberry32(config.seed);
  const sessionOrder = shuffled(
    Array.from({ length: rows.sessions.length }, (_, i) => i),
    rand,
  );
  const valSessionCount = Math.max(1, Math.round(rows.sessions.length * config.valFraction));
  const valSessionIdx = new Set<number>(sessionOrder.slice(0, valSessionCount));
  const fitList: number[] = [];
  const valList: number[] = [];
  for (let i = 0; i < n; i += 1) {
    (valSessionIdx.has(rows.sessionOf[i] as number) ? valList : fitList).push(i);
  }
  const fitIdx = Int32Array.from(fitList);
  const valIdx = Int32Array.from(valList);
  let fitPositives = 0;
  for (const i of fitIdx) {
    fitPositives += rows.y[i] as number;
  }
  console.log(
    `train rows ${fitIdx.length} (${fitPositives} pos) | val rows ${valIdx.length} ` +
      `(${valSessionCount}/${rows.sessions.length} sessions) | seed ${config.seed}`,
  );

  // Feature-space statistics on the FIT subset only. `mean` ships as the
  // occlusion baseline the runtime attributions use; `scale` ships as
  // published dispersion (the model's own standardizer is folded into the
  // coefficients below, so the forward pass needs neither).
  const featureMean = new Float64Array(FORECAST_INPUT_DIM);
  const featureScale = new Float64Array(FORECAST_INPUT_DIM);
  for (const i of fitIdx) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      featureMean[f] = (featureMean[f] as number) + (rows.base[i * FORECAST_INPUT_DIM + f] as number);
    }
  }
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    featureMean[f] = (featureMean[f] as number) / fitIdx.length;
  }
  for (const i of fitIdx) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      const diff = (rows.base[i * FORECAST_INPUT_DIM + f] as number) - (featureMean[f] as number);
      featureScale[f] = (featureScale[f] as number) + diff * diff;
    }
  }
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    const s = Math.sqrt((featureScale[f] as number) / fitIdx.length);
    featureScale[f] = s > 1e-6 ? s : 1;
  }

  // --- A. Plain additive logistic (d + 1 params) ----------------------------
  // The "did you try logistic regression?" reference point, and the model
  // eval.ts's gate is anchored to. Also where the class-weight power is chosen.
  const plainDesign = Float32Array.from(rows.base);
  const plainStd = fitStandardizer(plainDesign, FORECAST_INPUT_DIM, fitIdx);
  applyStandardizer(plainDesign, FORECAST_INPUT_DIM, plainStd);
  const posPowers = config.posWeightPower === null ? POS_POWERS : [config.posWeightPower];
  const plain = fitVariant(
    PLAIN_BASIS,
    plainDesign,
    FORECAST_INPUT_DIM,
    plainStd,
    rows,
    fitIdx,
    valIdx,
    posPowers,
    config.iters,
  );
  console.log(
    `${PLAIN_BASIS.padEnd(15)} d=${String(plain.dim).padStart(3)} λ=${plain.lambda} posPow=${plain.posPower} ` +
      `VAL lead≥20s ${plain.valLeadAuc20.toFixed(4)} (${plain.params} params)`,
  );

  // --- B. The shipped basis: the linear terms + every pairwise product ------
  const design = buildBasisDesign(rows.base, n, FORECAST_INPUT_DIM, FORECAST_TERM_COUNT);
  const standardizer = fitStandardizer(design, FORECAST_TERM_COUNT, fitIdx);
  applyStandardizer(design, FORECAST_TERM_COUNT, standardizer);
  const headline = fitVariant(
    FORECAST_BASIS,
    design,
    FORECAST_TERM_COUNT,
    standardizer,
    rows,
    fitIdx,
    valIdx,
    [plain.posPower],
    config.iters,
  );
  console.log(
    `${FORECAST_BASIS.padEnd(15)} d=${String(headline.dim).padStart(3)} λ=${headline.lambda} ` +
      `posPow=${headline.posPower} VAL lead≥20s ${headline.valLeadAuc20.toFixed(4)} (${headline.params} params)`,
  );

  // --- Platt calibration on val logits only (importance-weighted) -----------
  const valLogits: number[] = [];
  const valLabels: number[] = [];
  const valWeights: number[] = [];
  for (let k = 0; k < valIdx.length; k += 1) {
    const i = valIdx[k] as number;
    valLogits.push(rowLogit(design, FORECAST_TERM_COUNT, i, headline.theta));
    valLabels.push(rows.y[i] as number);
    valWeights.push(rows.importance[i] as number);
  }
  const calibration = fitPlatt(valLogits, valLabels, valWeights);
  console.log(
    `val ROC-AUC ${headline.valRocAuc.toFixed(4)} | val lead≥20s ${headline.valLeadAuc20.toFixed(4)} | ` +
      `Platt a ${calibration.a.toFixed(4)} b ${calibration.b.toFixed(4)}`,
  );

  // --- Fold the standardizer in: one coefficient per term + 1 intercept -----
  const folded = foldStandardizer(headline.theta, FORECAST_TERM_COUNT, standardizer);
  const precision8 = (value: number): number => Number(value.toPrecision(8));
  const thresholds = await thresholdDefaults();
  const buildWeights = (nudge: number, prearm: number, sha: string): ForecastWeightsFile => ({
    version: FORECAST_MODEL_VERSION,
    // Deterministic given the dataset: same seed + same data ⇒ byte-identical
    // weights.json (wall-clock time never enters the artifact).
    createdAt: manifest.createdAt,
    seed: config.seed,
    featureKeys: [...FORECAST_FEATURE_KEYS],
    norm: {
      mean: [...featureMean].map(precision8),
      scale: [...featureScale].map(precision8),
    },
    basis: FORECAST_BASIS,
    basisSha: FORECAST_BASIS_SHA,
    coefficients: folded.coefficients.map(precision8),
    intercept: precision8(folded.intercept),
    calibration: { a: precision8(calibration.a), b: precision8(calibration.b) },
    horizonSec: FORECAST_HORIZON_SEC,
    thresholds: { nudge, prearm, clear: nudge - (thresholds.nudge - thresholds.clear) },
    paramCount: FORECAST_PARAM_COUNT,
    trainProvenanceSha: sha,
  });

  if (
    parseForecastWeights(
      JSON.parse(JSON.stringify(buildWeights(thresholds.nudge, thresholds.prearm, "pending"))),
    ) === null
  ) {
    throw new Error("trained weights failed parseForecastWeights — refusing to continue");
  }

  // --- Operating point, re-selected on CROSS-FITTED TRAIN sessions ----------
  // A threshold picked on the 24-session val slice alone would be a coin flip:
  // ~17 of those sessions are replayable and they carry barely 20 drift
  // onsets, which cannot separate 0.40 from 0.55. So the search runs over
  // EVERY train-split session instead, with each one scored by a model that
  // never saw it: 3 seeded folds, each fitted at the SELECTED λ and class
  // weight, each Platt-calibrated on its own inner slice. The eval split is
  // not opened here, and no fold model ships — they exist only to make this
  // one threshold an out-of-sample choice on ~10× the evidence.
  //
  // The column standardizer is shared across folds (it is unsupervised
  // scaling, not a model) so the full expanded design is standardized once.
  //
  // All folds carry the SHIPPED Platt (a, b) rather than one fitted per fold.
  // The threshold is a cut on the shipped risk scale, so every fold must be
  // read on that scale; a per-fold recalibration made the three folds' slopes
  // range 0.49–0.75 and turned the pooled curve into a mixture of three
  // different scales. The models differ only in which third of the sessions
  // they never saw.
  const FOLDS = 3;
  const foldOfSession = new Int32Array(rows.sessions.length);
  sessionOrder.forEach((sessionIdx, position) => {
    foldOfSession[sessionIdx] = position % FOLDS;
  });
  const foldWeights: ForecastWeightsFile[] = [];
  for (let f = 0; f < FOLDS; f += 1) {
    const foldFitList: number[] = [];
    for (let i = 0; i < n; i += 1) {
      if ((foldOfSession[rows.sessionOf[i] as number] as number) !== f) {
        foldFitList.push(i);
      }
    }
    const foldFitIdx = Int32Array.from(foldFitList);
    const sw = sampleWeightsFor(rows.importance, rows.y, foldFitIdx, headline.posPower);
    // Convex objective with λ > 0 ⇒ a unique optimum, so warm-starting from
    // the shipped θ only buys iterations, never a different answer.
    const fit = fitLogisticL2(
      design,
      FORECAST_TERM_COUNT,
      foldFitIdx,
      rows.y,
      sw,
      headline.lambda,
      config.iters,
      headline.theta,
    );
    const foldFolded = foldStandardizer(fit.theta, FORECAST_TERM_COUNT, standardizer);
    const parsedFold = parseForecastWeights({
      ...buildWeights(thresholds.nudge, thresholds.prearm, "cross-fit"),
      coefficients: foldFolded.coefficients.map(precision8),
      intercept: precision8(foldFolded.intercept),
    });
    if (parsedFold === null) {
      throw new Error(`cross-fit fold ${f} produced unparseable weights`);
    }
    foldWeights.push(parsedFold);
    console.log(
      `  fold ${f}: fit ${foldFitIdx.length} rows (${
        rows.sessions.length - sessionOrder.filter((s) => (foldOfSession[s] as number) === f).length
      } sessions), ${fit.iters} L-BFGS iters, held-out fold scored on the shipped Platt scale`,
    );
  }

  const sessionIndexById = new Map<string, number>(
    rows.sessions.map((id, index) => [id, index]),
  );
  const traces: SessionTrace[] = [];
  for await (const session of readJsonl<RawSession>(config.raw)) {
    if (session.source !== "synthetic" || splitForSession(session.id, config.seed) !== "train") {
      continue;
    }
    const sessionIdx = sessionIndexById.get(session.id);
    if (sessionIdx === undefined) {
      continue; // fully censored session — no dataset rows, no fold
    }
    const fold = foldOfSession[sessionIdx] as number;
    traces.push(traceForThresholds(session, foldWeights[fold] as ForecastWeightsFile));
  }
  const searchDrifts = traces.reduce((sum, trace) => sum + trace.onsets.length, 0);
  const searchHours = traces.reduce((sum, trace) => sum + trace.durationSec / 3600, 0);
  console.log(
    `operating-point search: ${traces.length} cross-fitted train sessions, ${searchDrifts} drift onsets, ` +
      `${searchHours.toFixed(1)} h (ceilings: churn FPR ≤ ${CHURN_FPR_CEILING}, alarm load ` +
      `≤ ${ALARM_LOAD_ALLOWANCE}× the frozen point, ${FALSE_PREARM_CEILING_PER_HOUR} false pre-arms/h)`,
  );
  const thresholdSearch = NUDGE_GRID.map((nudge) =>
    scoreThreshold(traces, nudge, thresholds.prearm),
  );
  // The alarm-load reference is this same model at the PRE-BAKE-OFF threshold
  // (0.55) on these same sessions: a ratio, so the cross-fit's own risk scale
  // cancels out, and a fixed anchor, so re-running the trainer can never
  // ratchet the threshold down against its own previous answer.
  const reference = thresholdSearch.find(
    (row) => row.nudgeRisk === ALARM_BUDGET_REFERENCE_NUDGE_RISK,
  ) as ThresholdRow;
  const loadCeiling = reference.nudgesPerHour * ALARM_LOAD_ALLOWANCE;
  for (const row of thresholdSearch) {
    row.admissible =
      row.researchChurnFprAtNudge <= CHURN_FPR_CEILING &&
      row.falsePrearmsPerHour <= FALSE_PREARM_CEILING_PER_HOUR &&
      row.nudgesPerHour <= loadCeiling;
  }
  let selected = reference;
  for (const row of thresholdSearch) {
    if (row.admissible !== true) {
      continue;
    }
    if (
      selected.admissible !== true ||
      row.recallAt30sNudge > selected.recallAt30sNudge ||
      (row.recallAt30sNudge === selected.recallAt30sNudge && row.nudgeRisk > selected.nudgeRisk)
    ) {
      selected = row;
    }
  }
  console.log(
    `  reference (pre-bake-off nudge ${ALARM_BUDGET_REFERENCE_NUDGE_RISK}): ` +
      `${reference.nudgesPerHour.toFixed(2)} nudges/h ⇒ load ceiling ${loadCeiling.toFixed(2)}/h ` +
      `(×${ALARM_LOAD_ALLOWANCE})`,
  );
  for (const row of thresholdSearch) {
    console.log(
      `  nudge ${row.nudgeRisk.toFixed(2)} → recall@30s ${row.recallAt30sNudge.toFixed(4)} | ` +
        `${row.nudgesPerHour.toFixed(2)} nudges/h | ${row.falsePrearmsPerHour.toFixed(2)} false pre-arms/h | ` +
        `churn FPR ${row.researchChurnFprAtNudge.toFixed(4)}${row.admissible ? "" : "  (over budget)"}` +
        `${row === selected ? "  ← selected" : ""}`,
    );
  }
  if (selected.nudgeRisk !== thresholds.nudge) {
    console.warn(
      `WARN operating point drifted: train-internal search selects nudge ${selected.nudgeRisk}, ` +
        `DEFAULT_SETTINGS.forecastNudgeRisk is ${thresholds.nudge}. Update src/shared/defaults.ts ` +
        `(and docs/FORECAST-CONTRACTS.md §3) and re-run, or the shipped model runs off-optimum.`,
    );
  }

  // --- Provenance -----------------------------------------------------------
  // Reported on the STANDARDIZED scale, where magnitudes are comparable across
  // terms and the model reads as sentences — `deskConfMean30*deskConfStd30`
  // −7.42 is "confidence wobble matters only while the desk model is confident
  // you are there". weights.json ships these divided by each column's std
  // (the standardizer is folded in), so its raw numbers are not comparable.
  const topCoefficients = Array.from({ length: FORECAST_TERM_COUNT }, (_, j) => ({
    term: FORECAST_TERM_KEYS[j] as string,
    standardizedWeight: round6(headline.theta[j] as number),
    shippedCoefficient: round6(folded.coefficients[j] as number),
  }))
    .sort((a, b) => Math.abs(b.standardizedWeight) - Math.abs(a.standardizedWeight))
    .slice(0, 20);
  const provenance = {
    manifest,
    train: {
      config: {
        seed: config.seed,
        iters: config.iters,
        valFraction: config.valFraction,
        lambdaPath: LAMBDAS,
        posWeightPowers: posPowers,
        selectionMetric: `train-internal val lead-censored (≥${SELECTION_LEAD_SEC}s) ROC-AUC`,
      },
      arch: `GLM ${FORECAST_BASIS} (${FORECAST_INPUT_DIM} features → ${FORECAST_TERM_COUNT} terms → 1 logit)`,
      basisSha: FORECAST_BASIS_SHA,
      paramCount: FORECAST_PARAM_COUNT,
      optimizer: "L-BFGS (m=10, Armijo backtracking), weighted BCE + L2, bias unpenalized",
      rows: { fit: fitIdx.length, val: valIdx.length, fitPositives },
      selected: {
        lambda: headline.lambda,
        posWeightPower: headline.posPower,
        valLeadAuc20: headline.valLeadAuc20,
        valRocAuc: headline.valRocAuc,
      },
      // The plain additive logistic (d + 1 params) — the "did you try logistic
      // regression?" reference and the model eval.ts's gate is anchored to.
      // Key name is historical (`referenceLr18`); eval.ts reads it to recover
      // the λ, and the `basis` field below says which basis it actually is.
      referenceLr18: {
        basis: PLAIN_BASIS,
        params: plain.params,
        lambda: plain.lambda,
        posWeightPower: plain.posPower,
        valLeadAuc20: plain.valLeadAuc20,
        valRocAuc: plain.valRocAuc,
      },
      sweep: [...plain.sweep, ...headline.sweep],
      calibration: { a: round6(calibration.a), b: round6(calibration.b) },
      topCoefficients,
      operatingPoint: {
        rule:
          "max recall@30s (a forecast_nudge or forecast_prearm event inside (onset−30s, onset]) " +
          "subject to research_churn frame FPR ≤ ceiling, nudges/h ≤ ceiling, false pre-arms/h ≤ ceiling",
        selectedOn:
          `${FOLDS}-fold cross-fitted TRAIN sessions — every session scored by a fold model that ` +
          "never saw it, each fold refitted at the selected λ and class weight and read on the " +
          "SHIPPED Platt scale (the threshold is a cut on that scale). No eval row is read here; " +
          "no fold model ships.",
        ceilings: {
          researchChurnFpr: CHURN_FPR_CEILING,
          alarmLoadAllowance: ALARM_LOAD_ALLOWANCE,
          referenceNudgeRisk: ALARM_BUDGET_REFERENCE_NUDGE_RISK,
          referenceNudgesPerHour: reference.nudgesPerHour,
          nudgesPerHourCeiling: round4(loadCeiling),
          falsePrearmsPerHour: FALSE_PREARM_CEILING_PER_HOUR,
        },
        searchSessions: traces.length,
        searchDrifts,
        searchHours: round4(searchHours),
        selectedNudgeRisk: selected.nudgeRisk,
        selectedPrearmRisk: thresholds.prearm,
        shippedNudgeRisk: thresholds.nudge,
        matchesDefaultSettings: selected.nudgeRisk === thresholds.nudge,
        grid: thresholdSearch,
      },
    },
  };
  const provenanceSha = sha256Hex(canonicalJson(provenance));
  writeFileSync(join(forecastDataRoot(), PROVENANCE_FILE), JSON.stringify(provenance, null, 2));

  const weightsFile = buildWeights(thresholds.nudge, thresholds.prearm, provenanceSha);
  // The committed artifact must round-trip the fail-closed runtime parser.
  if (parseForecastWeights(JSON.parse(JSON.stringify(weightsFile))) === null) {
    throw new Error("trained weights failed parseForecastWeights — refusing to write");
  }
  writeFileSync(config.out, `${JSON.stringify(weightsFile, null, 2)}\n`);
  console.log(
    `weights → ${config.out} (${FORECAST_PARAM_COUNT} params, basis ${FORECAST_BASIS}@${FORECAST_BASIS_SHA}, ` +
      `provenance sha ${provenanceSha.slice(0, 12)}…, ${((Date.now() - startedAt) / 1000).toFixed(1)}s)`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
