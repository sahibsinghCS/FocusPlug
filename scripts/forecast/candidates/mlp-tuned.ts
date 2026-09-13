import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { FORECAST_FEATURE_KEYS } from "../../../src/shared/forecast/types";
import { FORECAST_INPUT_DIM } from "../../../src/shared/forecast/model";
import {
  boolFlag,
  ece10,
  logisticScore,
  numberArg,
  prAuc,
  rocAuc,
  round4,
  round6,
  stringArg,
  trainLogistic,
} from "../lib";
import {
  augmentationParents,
  candidateDir,
  loadDataset,
  loadRawIndex,
  type ReplayedSession,
  type Rows,
} from "./mlp-tuned/data";
import { buildSetup, type CalibrationSlice, type Fold, type Setup } from "./mlp-tuned/split";
import {
  addTotals,
  escalationSettings,
  leadAuc,
  newAlarmTotals,
  operatingPoint,
  simulateAlarms,
  summarizeAlarms,
  type AlarmTotals,
  type FrameScorer,
} from "./mlp-tuned/metrics";
import {
  forwardMacs,
  forwardNet,
  gradientCheck,
  makeScratch,
  paramCount,
  sigmoid,
  trainNet,
  type Activation,
  type Net,
  type NetSpec,
  type Schedule,
  type Scratch,
  type TrainInput,
} from "./mlp-tuned/net";
import { fitPlatt } from "./mlp-tuned/platt";

/**
 * ============================================================================
 * CONTENDER: mlp-tuned — make the neural net actually earn its parameters
 * ============================================================================
 *
 * The shipped TinyMLP 18→12→1 scores 0.9248 lead-censored ROC-AUC and LOSES to
 * a plain 18-feature multivariate logistic regression (0.9325) on the metric
 * the design calls its headline. This script keeps the feature set, the
 * dataset, the per-session split and the evaluation EXACTLY as they are and
 * asks whether that gap is a real limit of neural nets on these 18 features or
 * just an untuned network.
 *
 * The answer the sweep below returns is: an untuned network, and the untuned
 * knob is REGULARIZATION, not width. Coordinate descent from the shipped
 * configuration, scored by 3-fold cross-validation on train sessions only,
 * moves exactly four things:
 *
 *   L2      1e-4 → 3e-3   (30×; the single biggest lever, an interior optimum
 *                          of the 1e-5 … 1e-2 grid)
 *   base LR 3e-3 → 1e-2
 *   epochs  → 60 with early stopping inside (the shipped 400-epoch budget
 *                          stops far earlier at the shipped LR)
 *   members 1 → 3, one per cross-validation fold (bagging, not seed-averaging)
 *
 * Everything else the sweep tried is REJECTED and stays where train.ts had it:
 * 24/32/48 hidden units and two 2-hidden-layer variants do not beat 12 once
 * the weight decay is right, tanh beats relu and gelu, dropout hurts, cosine
 * and step schedules lose to a constant LR, batch 256 wins, and the tempered
 * class weight (n_neg/n_pos)^0.5 survives its own sweep. The far-lead signal
 * is weak and the eval set is 48 sessions: capacity was never the constraint,
 * variance was.
 *
 * One hypothesis worth recording BECAUSE IT FAILED. The headline metric only
 * ever looks at positives 20–30 s before an onset (eval.ts's `leadEligible`),
 * while the shipped trainer weights a frame 2 s before a drift exactly like a
 * frame 25 s before one — so a per-sample weight ramping with `secs_to_drift`
 * ought to align the loss with the metric. Stage H sweeps seven such ramps.
 * They do buy ranking (+0.002 CV lead-AUC for the `hinge20` ramp) but they pay
 * for it with 5–10 points of nudge recall, because the risk they suppress is
 * exactly the risk that has to cross the alarm threshold. The selection score
 * rejects all of them and keeps flat weighting. The sweep table keeps the rows.
 *
 * The ensemble is NOT an architectural escape hatch. Every member is a
 * single-hidden-layer 18→H→1 net over ONE shared z-score normalization and the
 * members are blended by an AFFINE map of their logits, so the whole ensemble
 * collapses EXACTLY into one 18→(k·H)→1 network (stack the hidden rows, fold
 * the blend coefficients into the output row). The script builds that
 * collapsed net and asserts it reproduces the ensemble logit to < 1e-9, so the
 * shipped `ForecastWeightsFile` schema, the two-layer `forward()` and the
 * occlusion attributions keep working unchanged — only the numeric constants
 * `FORECAST_HIDDEN_DIM` / `FORECAST_PARAM_COUNT` move.
 *
 * PROTOCOL — the part that makes the numbers mean something:
 *
 * - `split: "eval"` rows are loaded once and scored ONCE, at the very end. No
 *   sweep stage, early stop, calibration or threshold ever sees them, and the
 *   dataset is never rebuilt, resampled or re-split.
 * - Selection is K-fold cross-validation over the SYNTHETIC TRAIN sessions,
 *   with a separate calibration slice held out of every fold's fit set (see
 *   `mlp-tuned/split.ts`). Fold-val AUC is importance-expanded (calm negatives
 *   ×4, the exact inverse of the builder's keep-probability) so it is measured
 *   at natural prevalence, like eval is.
 * - `augmented:local` sessions are assigned to their PARENT session's fold —
 *   `augmentationParents` re-derives augment-local.ts's own seeded source
 *   selection — so a fold never fits on a jittered copy of its own val
 *   session.
 * - The selection score is `mean fold lead≥20s AUC + 0.10 × pooled fold
 *   nudge-recall@30 s`, the recall term coming from a train-internal copy of
 *   the alarm simulation (the SHIPPED `stepEscalation` reducer, the SHIPPED
 *   EMA, the SHIPPED thresholds, over the fold's own sessions). Ranking alone
 *   can be bought with a risk needle that never reaches the pre-arm line.
 * - Ties inside `SELECT_TOLERANCE` go to the cheaper model, so the sweep
 *   cannot buy 0.0003 of AUC with 10× the parameters.
 * - The configuration and the ensemble size are chosen BY THE SCRIPT AT RUN
 *   TIME from the sweep table, never hardcoded, so a re-run reproduces the
 *   choice as well as the number.
 * - The recommended operating point IS the shipped one (nudge 0.55 / pre-arm
 *   0.80, DEFAULT_SETTINGS parity). Thresholds are never shopped on eval; the
 *   threshold curve in the report is a diagnostic, explicitly not a selection.
 *
 * WHAT THIS DOES NOT FIX. At the frozen 0.80 pre-arm line this model fires
 * LESS than the shipped one (pre-arm recall 0.38 vs 0.56) because it is both
 * better ranked and more conservative at the top of the scale — the same
 * conservatism that cuts false pre-arms from 0.35/h to 0.12/h. Nudge-level
 * recall is a wash (0.7179 vs 0.7308 — one drift out of 78). The diagnostic
 * threshold curve shows where that trade sits: spending the shipped model's
 * own alarm budget (≈3.2 nudges/h) would put nudge recall near 0.85 with the
 * research_churn false-positive rate still 0.0000. That is a product decision
 * about DEFAULT_SETTINGS, not something this contender is allowed to grant
 * itself, so the reported numbers stay at 0.55 / 0.80.
 *
 * Runtime ≈ 15 min single-threaded (≈50 cross-validated trainings). Determinism
 * is by seed, not by luck: same seed + same dataset ⇒ same sweep table, same
 * chosen configuration, same held-out numbers.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/candidates/mlp-tuned.ts
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const SEED = numberArg("--seed", 42);
const FOLDS = numberArg("--folds", 3);
const CAL_FRACTION = numberArg("--cal", 0.15);
const AUGMENT_FRACTION = numberArg("--augment-fraction", 0.25); // build-dataset.ts default
const SWEEP_EPOCHS = numberArg("--sweep-epochs", 30);
const MAX_MEMBERS = numberArg("--max-members", 5);
const OUT_DIR = stringArg("--out", "");
const ONLY_STAGES = stringArg("--only", "");
const QUIET = boolFlag("--quiet");

/** Shipped operating point — the DEFAULT_SETTINGS forecast keys, never tuned here. */
const NUDGE_RISK = 0.55;
const PREARM_RISK = 0.8;
/** Weight on the deployment-faithful recall term in the selection score. */
const RECALL_WEIGHT = 0.1;
/** Selection ties inside this band go to the cheaper model. */
const SELECT_TOLERANCE = 0.0015;

interface LeadRamp {
  nearW: number;
  farW: number;
  kneeLo: number;
  kneeHi: number;
  name: string;
}

interface Config {
  spec: NetSpec;
  lr: number;
  batch: number;
  l2: number;
  dropout: number;
  schedule: Schedule;
  warmupFrac: number;
  posWeightPower: number;
  /** Lead-emphasis ramp applied to POSITIVE samples, keyed on secs_to_drift. */
  lead: LeadRamp;
  epochs: number;
}

const FLAT_LEAD: LeadRamp = { nearW: 1, farW: 1, kneeLo: 8, kneeHi: 20, name: "flat" };

/** The shipped trainer's settings — the sweep starts exactly where train.ts stands. */
const BASELINE: Config = {
  spec: { dims: [FORECAST_INPUT_DIM, 12], activation: "tanh" },
  lr: 0.003,
  batch: 256,
  l2: 0.0001,
  dropout: 0,
  schedule: "const",
  warmupFrac: 0,
  posWeightPower: 0.5,
  lead: FLAT_LEAD,
  epochs: SWEEP_EPOCHS,
};

function describe(config: Config): string {
  return [
    `${config.spec.dims.join("-")}-1`,
    config.spec.activation,
    `lr${config.lr}`,
    `b${config.batch}`,
    `l2${config.l2}`,
    `do${config.dropout}`,
    config.schedule + (config.warmupFrac > 0 ? `+w${config.warmupFrac}` : ""),
    `pw${config.posWeightPower}`,
    `lead:${config.lead.name}`,
    `e${config.epochs}`,
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Ensemble: logit = Σ α_m · f_m(x) + β  (affine ⇒ collapses into one net)
// ---------------------------------------------------------------------------

interface Ensemble {
  nets: Net[];
  alpha: number[];
  beta: number;
}

function singleton(net: Net): Ensemble {
  return { nets: [net], alpha: [1], beta: 0 };
}

function ensembleLogit(ensemble: Ensemble, scratches: Scratch[], x: Float64Array, offset: number): number {
  let sum = ensemble.beta;
  for (let m = 0; m < ensemble.nets.length; m += 1) {
    sum +=
      (ensemble.alpha[m] as number) *
      forwardNet(ensemble.nets[m] as Net, x, offset, scratches[m] as Scratch, false);
  }
  return sum;
}

/**
 * Blends members by standardizing each member's logit distribution on a
 * reference row set before averaging. Standardization is affine, so the blend
 * stays exactly collapsible; without it, members that land on different logit
 * scales pull the average around and k > 1 can be worse than k = 1.
 */
function blend(nets: readonly Net[], xNorm: Float64Array, reference: Int32Array): Ensemble {
  const k = nets.length;
  const alpha: number[] = [];
  let beta = 0;
  for (const net of nets) {
    const scratch = makeScratch(net);
    const logits = new Float64Array(reference.length);
    let mean = 0;
    for (let i = 0; i < reference.length; i += 1) {
      logits[i] = forwardNet(net, xNorm, (reference[i] as number) * FORECAST_INPUT_DIM, scratch, false);
      mean += logits[i] as number;
    }
    mean /= Math.max(1, reference.length);
    let variance = 0;
    for (let i = 0; i < reference.length; i += 1) {
      const d = (logits[i] as number) - mean;
      variance += d * d;
    }
    const sd = Math.sqrt(variance / Math.max(1, reference.length)) || 1;
    alpha.push(1 / (k * sd));
    beta -= mean / (k * sd);
  }
  return { nets: [...nets], alpha, beta };
}

/** Stacks a single-hidden-layer ensemble into ONE 18→(k·H)→1 net. Null if impossible. */
function collapse(ensemble: Ensemble): Net | null {
  const first = ensemble.nets[0] as Net;
  if (
    first.dims.length !== 2 ||
    ensemble.nets.some(
      (net) => net.dims.length !== 2 || net.dims[1] !== first.dims[1] || net.activation !== first.activation,
    )
  ) {
    return null;
  }
  const inDim = first.dims[0] as number;
  const hid = first.dims[1] as number;
  const k = ensemble.nets.length;
  const w1 = new Float64Array(k * hid * inDim);
  const b1 = new Float64Array(k * hid);
  const w2 = new Float64Array(k * hid);
  let b2 = ensemble.beta;
  ensemble.nets.forEach((net, m) => {
    const a = ensemble.alpha[m] as number;
    (net.w[0] as Float64Array).forEach((v, i) => {
      w1[m * hid * inDim + i] = v;
    });
    (net.b[0] as Float64Array).forEach((v, i) => {
      b1[m * hid + i] = v;
    });
    (net.w[1] as Float64Array).forEach((v, i) => {
      w2[m * hid + i] = a * v;
    });
    b2 += a * ((net.b[1] as Float64Array)[0] as number);
  });
  return {
    dims: [inDim, k * hid],
    activation: first.activation,
    actCode: first.actCode,
    w: [w1, w2],
    b: [b1, Float64Array.from([b2])],
  };
}

// ---------------------------------------------------------------------------
// Per-sample loss weights
// ---------------------------------------------------------------------------

function leadWeightOf(ramp: LeadRamp, secs: number): number {
  if (Number.isNaN(secs)) {
    return 1;
  }
  const t = Math.min(1, Math.max(0, (secs - ramp.kneeLo) / Math.max(1e-9, ramp.kneeHi - ramp.kneeLo)));
  return ramp.nearW + (ramp.farW - ramp.nearW) * t;
}

/**
 * Class weight on positives × the lead-emphasis ramp, with the ramp
 * renormalized to mean 1 over the fold's fit positives so the two axes stay
 * independent (changing the ramp must not silently change the class balance).
 */
function buildWeights(train: Rows, fitIndex: Int32Array, config: Config): Float64Array {
  let positives = 0;
  let leadSum = 0;
  for (const i of fitIndex) {
    if ((train.y[i] as number) === 1) {
      positives += 1;
      leadSum += leadWeightOf(config.lead, train.secs[i] as number);
    }
  }
  const leadMean = positives > 0 ? leadSum / positives : 1;
  const negatives = fitIndex.length - positives;
  const wPos = positives > 0 ? Math.pow(negatives / positives, config.posWeightPower) : 1;
  const weight = new Float64Array(train.n);
  for (const i of fitIndex) {
    weight[i] =
      (train.y[i] as number) === 1
        ? (wPos * leadWeightOf(config.lead, train.secs[i] as number)) / leadMean
        : 1;
  }
  return weight;
}

// ---------------------------------------------------------------------------
// Held-out (fold / calibration) scoring — train-internal only
// ---------------------------------------------------------------------------

interface SliceScore {
  leadAuc20: number;
  calibration: { a: number; b: number };
  alarms: AlarmTotals;
}

interface Slice {
  index: Int32Array;
  labels: number[];
  importance: number[];
  leadPos: Int32Array;
  leadLabels: number[];
  replays: readonly ReplayedSession[];
}

function foldSlice(fold: Fold): Slice {
  return {
    index: fold.valIndex,
    labels: fold.valLabels,
    importance: fold.valImportance,
    leadPos: fold.valLeadPos,
    leadLabels: fold.valLeadLabels,
    replays: fold.valReplays,
  };
}

function calSlice(cal: CalibrationSlice): Slice {
  return {
    index: cal.index,
    labels: cal.labels,
    importance: cal.importance,
    leadPos: cal.leadPos,
    leadLabels: cal.leadLabels,
    replays: cal.replays,
  };
}

function scoreSlice(setup: Setup, slice: Slice, ensemble: Ensemble): SliceScore {
  const scratches = ensemble.nets.map((net) => makeScratch(net));
  const logits = new Float64Array(slice.index.length);
  for (let k = 0; k < slice.index.length; k += 1) {
    logits[k] = ensembleLogit(ensemble, scratches, setup.xNorm, (slice.index[k] as number) * FORECAST_INPUT_DIM);
  }
  const aucScores = new Array<number>(slice.leadPos.length);
  for (let k = 0; k < slice.leadPos.length; k += 1) {
    aucScores[k] = logits[slice.leadPos[k] as number] as number;
  }
  const leadAuc20 = rocAuc(aucScores, slice.leadLabels);
  const calibration = fitPlatt(Array.from(logits), slice.labels, slice.importance);

  const frameBuf = new Float64Array(FORECAST_INPUT_DIM);
  const scorer: FrameScorer = (values, offset) => {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      frameBuf[f] = ((values[offset + f] as number) - (setup.mean[f] as number)) / (setup.scale[f] as number);
    }
    return sigmoid(calibration.a * ensembleLogit(ensemble, scratches, frameBuf, 0) + calibration.b);
  };
  const settings = escalationSettings(NUDGE_RISK, PREARM_RISK);
  const alarms = newAlarmTotals();
  for (const session of slice.replays) {
    addTotals(alarms, simulateAlarms(session, scorer, settings));
  }
  return { leadAuc20, calibration, alarms };
}

interface CvScore {
  meanLeadAuc20: number;
  foldLeadAuc20: number[];
  pooledNudgeRecall: number;
  pooledPrearmRecall: number;
  drifts: number;
  composite: number;
}

function combineFolds(scores: readonly SliceScore[]): CvScore {
  const foldLeadAuc20 = scores.map((s) => s.leadAuc20);
  const meanLeadAuc20 = foldLeadAuc20.reduce((a, b) => a + b, 0) / Math.max(1, foldLeadAuc20.length);
  let drifts = 0;
  let nudgeHits = 0;
  let prearmHits = 0;
  for (const s of scores) {
    drifts += s.alarms.drifts;
    nudgeHits += s.alarms.nudgeHits;
    prearmHits += s.alarms.prearmHits;
  }
  const pooledNudgeRecall = drifts > 0 ? nudgeHits / drifts : 0;
  return {
    meanLeadAuc20,
    foldLeadAuc20,
    pooledNudgeRecall,
    pooledPrearmRecall: drifts > 0 ? prearmHits / drifts : 0,
    drifts,
    composite: meanLeadAuc20 + RECALL_WEIGHT * pooledNudgeRecall,
  };
}

// ---------------------------------------------------------------------------

interface SweepRow {
  stage: string;
  config: string;
  paramsPerMember: number;
  members: number;
  totalParams: number;
  cvLeadAuc20: number;
  cvFoldLeadAuc20: number[];
  cvNudgeRecall: number;
  cvPrearmRecall: number;
  selectionScore: number;
  seconds: number;
}

function log(...args: unknown[]): void {
  if (!QUIET) {
    console.log(...args);
  }
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  const worstGrad = gradientCheck();
  log(`gradient check ok (4→3→1 tanh, 5→4→3→1 relu + gelu; worst rel err ${worstGrad.toExponential(2)})`);

  const { train, evalRows } = await loadDataset();
  const { replays, trainPool } = await loadRawIndex(SEED);
  const parents = augmentationParents(trainPool, SEED, AUGMENT_FRACTION);
  const evalReplays = replays.filter((session) => session.split === "eval");
  log(
    `dataset: ${train.n} train rows / ${train.sessions.length} sessions · ${evalRows.n} eval rows / ` +
      `${evalRows.sessions.length} sessions · ${replays.length} synthetic sessions replayed · ` +
      `${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
  );

  const setup = buildSetup(train, parents, replays, { seed: SEED, folds: FOLDS, calFraction: CAL_FRACTION });
  const slices = setup.folds.map(foldSlice);
  log(
    `split: ${FOLDS} folds over the synthetic train sessions · fit ${setup.folds
      .map((f) => f.fitIndex.length)
      .join("/")} rows · val ${setup.folds.map((f) => f.valIndex.length).join("/")} rows ` +
      `(${setup.folds.map((f) => f.valReplays.length).join("/")} sessions, ` +
      `${setup.folds.map((f) => f.valReplays.reduce((s, r) => s + r.onsets.length, 0)).join("/")} drifts) · ` +
      `calibration slice ${setup.calibration.index.length} rows / ${setup.calibration.replays.length} sessions ` +
      `(${setup.calibration.replays.reduce((s, r) => s + r.onsets.length, 0)} drifts) · ` +
      `augmented sessions: ${setup.attachedAugmentedSessions} attached to a parent fold, ${setup.droppedAugmentedSessions} dropped`,
  );

  const sweep: SweepRow[] = [];
  const weightCache = new Map<string, Float64Array[]>();
  const weightsFor = (config: Config): Float64Array[] => {
    const key = `${config.lead.name}|${config.posWeightPower}`;
    const cached = weightCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const built = setup.folds.map((fold) => buildWeights(train, fold.fitIndex, config));
    weightCache.set(key, built);
    return built;
  };

  const trainMember = (config: Config, fold: Fold, weight: Float64Array, seed: number): Net => {
    const input: TrainInput = { x: setup.xNorm, y: train.y, weight, fitIndex: fold.fitIndex };
    const slice = foldSlice(fold);
    return trainNet(input, {
      spec: config.spec,
      lr: config.lr,
      batch: config.batch,
      l2: config.l2,
      dropout: config.dropout,
      schedule: config.schedule,
      warmupFrac: config.warmupFrac,
      maxEpochs: config.epochs,
      patience: Math.max(20, Math.round(config.epochs * 0.5)),
      seed,
      evalEvery: 5,
      score: (net) => {
        const s = scoreSlice(setup, slice, singleton(net));
        const recall = s.alarms.drifts > 0 ? s.alarms.nudgeHits / s.alarms.drifts : 0;
        return s.leadAuc20 + RECALL_WEIGHT * recall;
      },
    }).net;
  };

  /** Trains `seeds.length` members per fold and cross-validates the ensemble. */
  const crossValidate = (
    config: Config,
    seeds: readonly number[],
    reuse?: Net[][],
  ): { cv: CvScore; members: Net[][] } => {
    const weights = weightsFor(config);
    const members: Net[][] = [];
    const scores: SliceScore[] = [];
    setup.folds.forEach((fold, f) => {
      const have = reuse?.[f] ?? [];
      const nets = [...have];
      for (let s = have.length; s < seeds.length; s += 1) {
        nets.push(trainMember(config, fold, weights[f] as Float64Array, seeds[s] as number));
      }
      members.push(nets);
      const ensemble = nets.length === 1 ? singleton(nets[0] as Net) : blend(nets, setup.xNorm, fold.valIndex);
      scores.push(scoreSlice(setup, slices[f] as Slice, ensemble));
    });
    return { cv: combineFolds(scores), members };
  };

  const record = (stage: string, config: Config, members: number, cv: CvScore, seconds: number): number => {
    sweep.push({
      stage,
      config: describe(config),
      paramsPerMember: paramCount(config.spec.dims),
      members,
      totalParams: paramCount(config.spec.dims) * members * FOLDS,
      cvLeadAuc20: round6(cv.meanLeadAuc20),
      cvFoldLeadAuc20: cv.foldLeadAuc20.map(round6),
      cvNudgeRecall: round4(cv.pooledNudgeRecall),
      cvPrearmRecall: round4(cv.pooledPrearmRecall),
      selectionScore: round6(cv.composite),
      seconds: round4(seconds),
    });
    log(
      `  [${stage}] ${describe(config).padEnd(70)}${members > 1 ? ` k=${members}` : "    "} ` +
        `sel ${cv.composite.toFixed(5)} = cvAUC ${cv.meanLeadAuc20.toFixed(5)} ` +
        `+ 0.1×recall ${cv.pooledNudgeRecall.toFixed(4)} (prearm ${cv.pooledPrearmRecall.toFixed(4)}, ${seconds.toFixed(1)}s)`,
    );
    return cv.composite;
  };

  const trial = (stage: string, config: Config): number => {
    const t0 = Date.now();
    const { cv } = crossValidate(config, [SEED]);
    return record(stage, config, 1, cv, (Date.now() - t0) / 1000);
  };
  const skip = (stage: string): boolean => ONLY_STAGES !== "" && !ONLY_STAGES.split(",").includes(stage);

  let best: Config = { ...BASELINE };
  let bestScore = Number.NEGATIVE_INFINITY;

  /** Coordinate-descent helper: keeps the cheapest option inside the tie band. */
  function sweepAxis<T>(
    stage: string,
    label: string,
    options: readonly T[],
    apply: (config: Config, option: T) => Config,
    cost: (option: T) => number,
  ): void {
    if (skip(stage)) {
      return;
    }
    log(`stage ${stage} — ${label}`);
    const results: Array<{ option: T; score: number }> = [];
    for (const option of options) {
      results.push({ option, score: trial(stage, apply(best, option)) });
    }
    const top = Math.max(...results.map((r) => r.score));
    const eligible = results.filter((r) => r.score >= top - SELECT_TOLERANCE);
    eligible.sort((a, b) => cost(a.option) - cost(b.option) || b.score - a.score);
    const winner = eligible[0] as { option: T; score: number };
    best = apply(best, winner.option);
    bestScore = winner.score;
    log(`  → ${label}: ${describe(best)} (sel ${winner.score.toFixed(5)}${eligible.length > 1 ? ", cheapest within tolerance" : ""})`);
  }

  // Weight decay is swept BEFORE capacity and then AGAIN after it: the two
  // interact hard here (the far-lead signal is weak, so the useful width
  // depends entirely on how much the net is allowed to overfit), and a
  // coordinate descent that sets width at the shipped L2 picks the wrong width.
  const L2_GRID = [0.00001, 0.0001, 0.001, 0.003, 0.01];

  // --- Stage A — L2 at the shipped width --------------------------------------
  sweepAxis("A", "L2 (at the shipped 18-12-1 width)", L2_GRID, (config, l2) => ({ ...config, l2 }), () => 0);

  // --- Stage B — capacity -----------------------------------------------------
  sweepAxis(
    "B",
    "hidden capacity (incl. a 2-hidden-layer variant)",
    [[12], [24], [32], [48], [24, 12], [32, 16]] as number[][],
    (config, hidden) => ({ ...config, spec: { dims: [FORECAST_INPUT_DIM, ...hidden], activation: config.spec.activation } }),
    (hidden) => paramCount([FORECAST_INPUT_DIM, ...hidden]),
  );

  // --- Stage C — L2 again, now at the chosen capacity -------------------------
  sweepAxis("C", "L2 (re-checked at the chosen capacity)", L2_GRID, (config, l2) => ({ ...config, l2 }), () => 0);

  // --- Stage D — activation ---------------------------------------------------
  sweepAxis(
    "D",
    "activation",
    ["tanh", "relu", "gelu"] as Activation[],
    (config, activation) => ({ ...config, spec: { ...config.spec, activation } }),
    (activation) => (activation === "tanh" ? 0 : 1),
  );

  // --- Stage E — dropout --------------------------------------------------------
  sweepAxis("E", "dropout", [0, 0.1, 0.2], (config, dropout) => ({ ...config, dropout }), (d) => (d === 0 ? 0 : 1));

  // --- Stage F — LR schedule, batch size, base LR -----------------------------
  sweepAxis(
    "F",
    "LR schedule",
    [
      ["const", 0],
      ["cosine", 0.1],
      ["step", 0.1],
    ] as Array<[Schedule, number]>,
    (config, [schedule, warmupFrac]) => ({ ...config, schedule, warmupFrac }),
    () => 0,
  );
  sweepAxis("F", "batch size", [128, 256, 512], (config, batch) => ({ ...config, batch }), () => 0);
  sweepAxis("F", "base LR", [0.001, 0.003, 0.01], (config, lr) => ({ ...config, lr }), () => 0);

  // --- Stage G — class weighting ----------------------------------------------
  sweepAxis(
    "G",
    "class-weight exponent w_pos = (n_neg/n_pos)^p",
    [0, 0.25, 0.5, 0.75, 1],
    (config, posWeightPower) => ({ ...config, posWeightPower }),
    () => 0,
  );

  // --- Stage H — lead-emphasis ramp (the objective-alignment lever) -----------
  sweepAxis(
    "H",
    "lead-emphasis ramp on positives",
    [
      FLAT_LEAD,
      { nearW: 0.7, farW: 1.3, kneeLo: 8, kneeHi: 20, name: "mild" },
      { nearW: 0.4, farW: 1.6, kneeLo: 8, kneeHi: 20, name: "strong" },
      { nearW: 0.2, farW: 1.8, kneeLo: 8, kneeHi: 20, name: "steep" },
      { nearW: 0.05, farW: 1.95, kneeLo: 8, kneeHi: 20, name: "extreme" },
      { nearW: 0.25, farW: 1, kneeLo: 19, kneeHi: 20, name: "hinge20" },
      { nearW: 1, farW: 1.6, kneeLo: 8, kneeHi: 20, name: "far-boost" },
    ] as LeadRamp[],
    (config, lead) => ({ ...config, lead }),
    (lead) => (lead.name === "flat" ? 0 : 1),
  );

  // --- Stage I — epoch budget --------------------------------------------------
  sweepAxis(
    "I",
    "epoch budget (early stopping still runs inside each)",
    [SWEEP_EPOCHS, SWEEP_EPOCHS * 2, SWEEP_EPOCHS * 4],
    (config, epochs) => ({ ...config, epochs }),
    (epochs) => epochs,
  );

  // --- Stage J — seed ensembling ------------------------------------------------
  log("stage J — seed ensembling (k members per fold; params reported as the ensemble total)");
  const memberSeeds = Array.from({ length: MAX_MEMBERS }, (_, i) => SEED + 101 * i);
  let members: Net[][] = [];
  const ensembleResults: Array<{ k: number; cv: CvScore; members: Net[][] }> = [];
  for (let k = 1; k <= MAX_MEMBERS; k += 1) {
    const t0 = Date.now();
    const result = crossValidate(best, memberSeeds.slice(0, k), members);
    members = result.members;
    ensembleResults.push({ k, cv: result.cv, members: result.members.map((nets) => [...nets]) });
    record("J", best, k, result.cv, (Date.now() - t0) / 1000);
  }
  const topEnsemble = Math.max(...ensembleResults.map((r) => r.cv.composite));
  const chosenEnsemble = ensembleResults
    .filter((r) => r.cv.composite >= topEnsemble - SELECT_TOLERANCE)
    .sort((a, b) => a.k - b.k)[0] as { k: number; cv: CvScore; members: Net[][] };
  bestScore = chosenEnsemble.cv.composite;
  log(
    `  → ensemble k=${chosenEnsemble.k} per fold (${chosenEnsemble.k * FOLDS} members total, sel ${bestScore.toFixed(5)})`,
  );

  // --- Final model: every fold × every seed, blended and calibrated on the
  //     calibration slice, which no member's fit set ever contained -----------
  const finalMembers = chosenEnsemble.members.flat();
  const finalEnsemble = blend(finalMembers, setup.xNorm, setup.calibration.index);
  const calScore = scoreSlice(setup, calSlice(setup.calibration), finalEnsemble);
  const calibration = calScore.calibration;
  log(
    `final ensemble: ${finalMembers.length} members (${FOLDS} folds × ${chosenEnsemble.k} seeds) · ` +
      `calibration slice lead≥20s AUC ${calScore.leadAuc20.toFixed(5)}, nudge recall ` +
      `${(calScore.alarms.drifts > 0 ? calScore.alarms.nudgeHits / calScore.alarms.drifts : 0).toFixed(4)} ` +
      `over ${calScore.alarms.drifts} drifts · Platt a ${calibration.a.toFixed(4)} b ${calibration.b.toFixed(4)}`,
  );

  const servingNet = collapse(finalEnsemble);
  let collapseError: number | null = null;
  if (servingNet !== null) {
    const scratchesA = finalEnsemble.nets.map((net) => makeScratch(net));
    const scratchB = makeScratch(servingNet);
    let worst = 0;
    const probe = Math.min(4000, setup.calibration.index.length);
    for (let k = 0; k < probe; k += 1) {
      const off = (setup.calibration.index[k] as number) * FORECAST_INPUT_DIM;
      const a = ensembleLogit(finalEnsemble, scratchesA, setup.xNorm, off);
      const b = forwardNet(servingNet, setup.xNorm, off, scratchB, false);
      worst = Math.max(worst, Math.abs(a - b));
    }
    collapseError = worst;
    if (worst > 1e-9) {
      throw new Error(`ensemble collapse mismatch ${worst.toExponential(3)} — refusing to claim single-net cost`);
    }
    log(
      `ensemble collapses EXACTLY into one ${servingNet.dims.join("→")}→1 ${servingNet.activation} net ` +
        `(max |Δlogit| ${worst.toExponential(2)} over ${probe} rows)`,
    );
  }

  // ==========================================================================
  // HELD-OUT EVALUATION — the first and only time eval rows are scored
  // ==========================================================================
  const servingEnsemble: Ensemble = servingNet !== null ? singleton(servingNet) : finalEnsemble;
  const servingScratches = servingEnsemble.nets.map((net) => makeScratch(net));
  const frameBuf = new Float64Array(FORECAST_INPUT_DIM);
  const scoreRow: FrameScorer = (values, offset) => {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      frameBuf[f] = ((values[offset + f] as number) - (setup.mean[f] as number)) / (setup.scale[f] as number);
    }
    return sigmoid(calibration.a * ensembleLogit(servingEnsemble, servingScratches, frameBuf, 0) + calibration.b);
  };

  const evalScores = new Float64Array(evalRows.n);
  for (let i = 0; i < evalRows.n; i += 1) {
    evalScores[i] = scoreRow(evalRows.x, i * FORECAST_INPUT_DIM);
  }
  const evalScoreList = Array.from(evalScores);
  const evalLabelList = Array.from(evalRows.y);
  const metrics = {
    rocAuc: round4(rocAuc(evalScoreList, evalLabelList)),
    prAuc: round4(prAuc(evalScoreList, evalLabelList)),
    baseRate: round4(evalLabelList.reduce<number>((s, v) => s + v, 0) / evalRows.n),
    aucLead20: round4(leadAuc(evalScores, evalRows.y, evalRows.secs, 20)),
    aucLead10: round4(leadAuc(evalScores, evalRows.y, evalRows.secs, 10)),
    ece: round4(ece10(evalScoreList, evalLabelList).ece),
    evalFrames: evalRows.n,
    evalSessions: evalRows.sessions.length,
  };

  // --- Full 18-feature logistic on the identical eligibility set --------------
  // Reproduced exactly as eval.ts does it: the same train rows in file order,
  // the same 40 000-row stride subsample, the same lib.trainLogistic.
  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(train.n / cap));
  const subX: number[][] = [];
  const subY: number[] = [];
  for (let i = 0; i < train.n; i += stride) {
    const row: number[] = [];
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      row.push(train.x[i * FORECAST_INPUT_DIM + f] as number);
    }
    subX.push(row);
    subY.push(train.y[i] as number);
  }
  const columns = FORECAST_FEATURE_KEYS.map((_, i) => i);
  const rowBuf = new Array<number>(FORECAST_INPUT_DIM);
  const scoreLogistic = (model: ReturnType<typeof trainLogistic>, cols: number[]): Float64Array => {
    const out = new Float64Array(evalRows.n);
    for (let i = 0; i < evalRows.n; i += 1) {
      for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
        rowBuf[f] = evalRows.x[i * FORECAST_INPUT_DIM + f] as number;
      }
      out[i] = logisticScore(model, rowBuf, cols);
    }
    return out;
  };
  const lrScores = scoreLogistic(trainLogistic(subX, subY, columns), columns);
  const fullLogistic18 = {
    rocAuc: round4(rocAuc(Array.from(lrScores), evalLabelList)),
    prAuc: round4(prAuc(Array.from(lrScores), evalLabelList)),
    aucLead20: round4(leadAuc(lrScores, evalRows.y, evalRows.secs, 20)),
    aucLead10: round4(leadAuc(lrScores, evalRows.y, evalRows.secs, 10)),
    note: "18-feature multivariate logistic — lib.trainLogistic on the same stride-subsampled train rows eval.ts uses, scored on the identical lead-censored eligibility set",
  };

  let bestSingle = { feature: "none", aucLead20: 0.5, rocAuc: 0.5 };
  for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
    const scores = scoreLogistic(trainLogistic(subX, subY, [f]), [f]);
    const value = round4(leadAuc(scores, evalRows.y, evalRows.secs, 20));
    if (value > bestSingle.aucLead20) {
      bestSingle = {
        feature: FORECAST_FEATURE_KEYS[f] as string,
        aucLead20: value,
        rocAuc: round4(rocAuc(Array.from(scores), evalLabelList)),
      };
    }
  }

  // --- Alarm simulation at the SHIPPED operating point -------------------------
  const settings = escalationSettings(NUDGE_RISK, PREARM_RISK);
  const totals = newAlarmTotals();
  const byArchetype = new Map<string, AlarmTotals>();
  for (const session of evalReplays) {
    const result = simulateAlarms(session, scoreRow, settings);
    addTotals(totals, result);
    const bucket = byArchetype.get(session.archetype) ?? newAlarmTotals();
    addTotals(bucket, result);
    byArchetype.set(session.archetype, bucket);
  }
  const alarms = summarizeAlarms(totals);

  const perArchetype: Record<string, unknown> = {};
  for (let a = 0; a < evalRows.archetypes.length; a += 1) {
    const name = evalRows.archetypes[a] as string;
    let frames = 0;
    let positives = 0;
    let negatives = 0;
    let fpNudge = 0;
    let fpPrearm = 0;
    for (let i = 0; i < evalRows.n; i += 1) {
      if ((evalRows.archetypeOf[i] as number) !== a) {
        continue;
      }
      frames += 1;
      if ((evalRows.y[i] as number) === 1) {
        positives += 1;
        continue;
      }
      negatives += 1;
      if ((evalScores[i] as number) >= NUDGE_RISK) {
        fpNudge += 1;
      }
      if ((evalScores[i] as number) >= PREARM_RISK) {
        fpPrearm += 1;
      }
    }
    const bucket = byArchetype.get(name);
    perArchetype[name] = {
      frames,
      baseRate: round4(positives / Math.max(1, frames)),
      falsePositiveRateAtNudge: round4(negatives > 0 ? fpNudge / negatives : 0),
      falsePositiveRateAtPrearm: round4(negatives > 0 ? fpPrearm / negatives : 0),
      drifts: bucket?.drifts ?? 0,
      nudgeHits: bucket?.nudgeHits ?? 0,
      prearmHits: bucket?.prearmHits ?? 0,
      nudgesPerHour: bucket && bucket.hours > 0 ? round4(bucket.nudges / bucket.hours) : 0,
      falsePrearmsPerHour: bucket && bucket.hours > 0 ? round4(bucket.falsePrearms / bucket.hours) : 0,
    };
  }
  const churnSlice = perArchetype["research_churn"] as { falsePositiveRateAtNudge: number } | undefined;
  if (churnSlice === undefined) {
    throw new Error("eval split has no research_churn frames — the anti-if-else slice is empty");
  }

  // Diagnostic only — the recommended operating point stays the shipped 0.55.
  const churnIndex = evalRows.archetypes.indexOf("research_churn");
  const thresholdCurve = [0.35, 0.45, 0.55, 0.65, 0.75].map((nudge) => {
    const curve = newAlarmTotals();
    for (const session of evalReplays) {
      addTotals(curve, simulateAlarms(session, scoreRow, escalationSettings(nudge, PREARM_RISK)));
    }
    let churnFp = 0;
    let churnNeg = 0;
    for (let i = 0; i < evalRows.n; i += 1) {
      if ((evalRows.archetypeOf[i] as number) !== churnIndex || (evalRows.y[i] as number) === 1) {
        continue;
      }
      churnNeg += 1;
      if ((evalScores[i] as number) >= nudge) {
        churnFp += 1;
      }
    }
    const summary = summarizeAlarms(curve);
    return {
      nudgeRisk: nudge,
      recallAt30Nudge: summary.recallAt30Nudge,
      recallAt30Prearm: summary.recallAt30Prearm,
      nudgesPerHour: summary.nudgesPerHour,
      falsePrearmsPerHour: summary.falsePrearmsPerHour,
      fprResearchChurn: round4(churnNeg > 0 ? churnFp / churnNeg : 0),
    };
  });

  const totalParams =
    servingNet !== null ? paramCount(servingNet.dims) : paramCount(best.spec.dims) * finalMembers.length;
  const macs =
    servingNet !== null ? forwardMacs(servingNet.dims) : forwardMacs(best.spec.dims) * finalMembers.length;

  const report = {
    candidate: "mlp-tuned",
    script: "scripts/forecast/candidates/mlp-tuned.ts",
    seed: SEED,
    selection: {
      score: `mean fold lead≥20s ROC-AUC + ${RECALL_WEIGHT} × pooled fold nudge-recall@30s (train-internal only)`,
      folds: FOLDS,
      tieTolerance: SELECT_TOLERANCE,
      foldValSessions: setup.folds.map((f) => f.valReplays.length),
      foldValDrifts: setup.folds.map((f) => f.valReplays.reduce((s, r) => s + r.onsets.length, 0)),
      foldFitRows: setup.folds.map((f) => f.fitIndex.length),
      calibrationSessions: setup.calibration.replays.length,
      calibrationRows: setup.calibration.index.length,
      augmentedAttachedToParentFold: setup.attachedAugmentedSessions,
      augmentedDropped: setup.droppedAugmentedSessions,
      chosen: `${describe(best)} k${chosenEnsemble.k}/fold`,
      cvLeadAuc20: round6(chosenEnsemble.cv.meanLeadAuc20),
      cvFoldLeadAuc20: chosenEnsemble.cv.foldLeadAuc20.map(round6),
      cvNudgeRecall: round4(chosenEnsemble.cv.pooledNudgeRecall),
      cvPrearmRecall: round4(chosenEnsemble.cv.pooledPrearmRecall),
      cvDrifts: chosenEnsemble.cv.drifts,
      calibrationSliceLeadAuc20: round6(calScore.leadAuc20),
      calibrationSliceNudgeRecall: round4(
        calScore.alarms.drifts > 0 ? calScore.alarms.nudgeHits / calScore.alarms.drifts : 0,
      ),
    },
    model: {
      arch:
        servingNet !== null
          ? `${servingNet.dims.join("-")}-1`
          : `${best.spec.dims.join("-")}-1 ×${finalMembers.length}`,
      activation: best.spec.activation,
      ensembleMembers: finalMembers.length,
      membersPerFold: chosenEnsemble.k,
      paramsPerMember: paramCount(best.spec.dims),
      params: totalParams,
      shippedParams: 241,
      forwardMultiplyAccumulates: macs,
      collapsesToSingleTwoLayerNet: servingNet !== null,
      collapseMaxLogitError: collapseError,
      calibration: { a: round6(calibration.a), b: round6(calibration.b) },
      normalization: "one shared z-score over all split:\"train\" rows — every member uses it, which is what makes the exact collapse possible",
    },
    metrics,
    recallAt30sNudge: alarms.recallAt30Nudge,
    fprResearchChurn: round4(churnSlice.falsePositiveRateAtNudge),
    operatingPoint: {
      nudgeRisk: NUDGE_RISK,
      prearmRisk: PREARM_RISK,
      source: "DEFAULT_SETTINGS forecast keys — the shipped point, never tuned on eval",
      frameNudge: operatingPoint(evalScores, evalRows.y, NUDGE_RISK),
      framePrearm: operatingPoint(evalScores, evalRows.y, PREARM_RISK),
    },
    alarms,
    baselines: {
      fullLogistic18,
      bestSingleFeatureLogistic: bestSingle,
      shippedMlp: {
        aucLead20: 0.9248,
        aucLead10: 0.9512,
        rocAuc: 0.9614,
        prAuc: 0.6938,
        ece: 0.0053,
        recallAt30Prearm: 0.5641,
        recallAt30Nudge: 0.7308,
        note: "committed src/shared/forecast/eval-report.json; recallAt30Nudge re-measured with this script's definition on the shipped weights",
      },
    },
    perArchetype,
    thresholdCurveDiagnosticOnly: thresholdCurve,
    sweep,
    runtimeSec: round4((Date.now() - startedAt) / 1000),
  };

  const dir = OUT_DIR !== "" ? OUT_DIR : candidateDir();
  const outFile = join(dir, "metrics.json");
  writeFileSync(outFile, `${JSON.stringify(report, null, 2)}\n`);
  if (boolFlag("--dump-scores")) {
    // Per-session held-out scores for scripts/forecast/adjudicate.ts (see the
    // same flag in hybrid.ts). Off by default — large, and only that step reads it.
    writeFileSync(
      join(dir, "eval-scores.json"),
      JSON.stringify({
        sessionIds: Array.from(evalRows.sessionOf).map((s) => evalRows.sessions[s] as string),
        scores: evalScoreList,
      }),
    );
  }

  console.log("\n===== mlp-tuned — held-out metrics =====");
  console.log(
    JSON.stringify(
      {
        candidate: "mlp-tuned",
        approach: `${describe(best)} k${chosenEnsemble.k}/fold ×${FOLDS} folds`,
        arch: report.model.arch,
        params: report.model.params,
        forwardMultiplyAccumulates: report.model.forwardMultiplyAccumulates,
        rocAuc: metrics.rocAuc,
        prAuc: metrics.prAuc,
        aucLead20: metrics.aucLead20,
        aucLead10: metrics.aucLead10,
        ece: metrics.ece,
        baseRate: metrics.baseRate,
        evalFrames: metrics.evalFrames,
        evalSessions: metrics.evalSessions,
        recallAt30sNudge: alarms.recallAt30Nudge,
        recallAt30sPrearm: alarms.recallAt30Prearm,
        fprResearchChurn: report.fprResearchChurn,
        nudgesPerHour: alarms.nudgesPerHour,
        falsePrearmsPerHour: alarms.falsePrearmsPerHour,
        fullLogistic18AucLead20: fullLogistic18.aucLead20,
        bestSingleFeatureLogisticAucLead20: bestSingle.aucLead20,
        shippedMlpAucLead20: 0.9248,
        beatsFullLr: metrics.aucLead20 > fullLogistic18.aucLead20,
        runtimeSec: report.runtimeSec,
      },
      null,
      2,
    ),
  );
  console.log(`report → ${outFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
