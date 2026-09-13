import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../../src/shared/defaults";
import type { EscalationSettings } from "../../../src/shared/forecast/escalate";
import { fnv1a32 } from "../../../src/shared/forecast/hash";
import { forward, parseForecastWeights } from "../../../src/shared/forecast/model";
import { FORECAST_FEATURE_KEYS } from "../../../src/shared/forecast/types";
import {
  CONTRACT_PREARM_FUSE_SEC,
  mulberry32,
  repoRoot,
  rocAuc,
  round6,
  readJsonl,
  shuffled,
  type RawSession,
} from "../lib";
import {
  applyStandardizer,
  buildDesign,
  compileSpec,
  expandRow,
  fitLogisticL2,
  fitStandardizer,
  sigmoidStable,
  type CompiledSpec,
  type Term,
} from "../candidates/lr-ceiling/linear";
import {
  forwardNet,
  makeScratch,
  paramCount as mlpParamCount,
  trainNet,
  sigmoid as mlpSigmoid,
  type Net,
  type NetSpec,
  type Scratch,
} from "../candidates/mlp-tuned/net";
import { augmentationParents } from "../candidates/mlp-tuned/data";
import {
  forwardHybrid,
  logit as hybridLogit,
  paramCount as hybridParamCount,
  sigmoid as hybridSigmoid,
  trainHybrid,
  type HybridHyper,
  type HybridNet,
} from "../candidates/hybrid/nets";
// The SHIPPED calibrator: the robust Lin-Weng-Keerthi Platt `train.ts` uses
// (smoothed targets + backtracking line search). Every contender ships its own
// copy of the PLAIN Newton, and on a near-separable train-internal calibration
// slice that copy diverges — the 24-feature plain logistic pinned a at -3.9e12
// on the first attempt here, turning its calibrated risk into a step function.
// docs/FORECAST.md flags exactly this failure. One robust calibrator is used
// for every model in this table, which also makes the shared 0.45/0.80
// operating point mean the same thing for all of them. It is monotone
// increasing, so it cannot move any AUC; it moves ECE and the alarm numbers.
import { fitPlatt as fitPlattRobust } from "../linear";
import {
  binMatrix,
  boosterMargin,
  buildBinEdges,
  countNodes,
  setGbdtFeatureWidth,
  trainGbdt,
  type Booster,
  type GbdtParams,
} from "./gbdt-nd";
import { applyCalibrator, chooseCalibrator } from "../candidates/trees/calibrate";
import { buildChannels, CHANNEL_COUNT, CONTEXT_FEATURE_INDEX } from "../candidates/temporal/channels";
import { Adam, TemporalNet, bceGrad, type TemporalArch } from "../candidates/temporal/convnet";
import { HOLDOUT_SESSIONS_FILE, holdoutRoot } from "../holdout-namespace";
import {
  OLD_DIM,
  SHIPPED_DIM,
  WIDTH,
  HYBRID_EXTRA_DIM,
  HYBRID_EXTRA_ONLY,
  decisionOf,
  simulateSessionAlarms,
  type Corpus,
  type SessionMeta,
  type TrainRows,
} from "./corpus";

/**
 * Every contender, refit on `split:"train"` rows with ITS OWN already-tuned
 * recipe, at two feature bases: the 18 the round-8 bake-off ran on, and the 24
 * that ship today. Nothing here reads a hold-out frame except to SCORE it,
 * after fitting is finished.
 *
 * Where a contender's script contains a hyper-parameter SEARCH, the search is
 * not re-run: the values it selected are read off its committed
 * `data/forecast/candidates/<name>/metrics.json` and pinned. That is the point
 * — "its own already-tuned recipe". Anything the recipe re-derives per basis
 * because it must (an early-stop epoch, a tree count, a λ on the
 * regularization path, a Platt pair, a fusion weight) is re-derived on
 * TRAIN-INTERNAL rows only, exactly as the contender does it.
 */

export interface FittedModel {
  name: string;
  family: string;
  basis: string;
  featureDim: number;
  params: number;
  paramsNote?: string;
  recipe: Record<string, unknown>;
  /** Calibrated risk for one frame of the WIDTH-wide feature array. */
  scoreFrame(feats: Float64Array | ArrayLike<number>, offset: number, frame: number): number;
  /** Self-timing for models whose input is not the frame vector (temporal). */
  measureMicros?(iterations: number): number;
}

export interface FitOptions {
  only: string;
  log: (message: string) => void;
  /**
   * Returns a cached model when this run already scored one with that name and
   * `--refit` was not passed, so a crash in a later family does not throw away
   * an hour of fitting. The cache stores per-frame calibrated risk plus the
   * recipe block; it is keyed by name and invalidated by frame count.
   */
  cached: (name: string) => FittedModel | null;
}

const SEED = 42;
const LEAD = 20;

function wanted(only: string, family: string): boolean {
  return only === "" || only.split(",").map((s) => s.trim()).includes(family);
}

/** Column list for a basis: `OLD_DIM` -> 0..17, `SHIPPED_DIM` -> 0..23. */
function basisCols(dim: number): number[] {
  return Array.from({ length: dim }, (_, i) => i);
}

function sliceRows(
  src: Float64Array,
  n: number,
  cols: readonly number[],
): Float64Array {
  const d = cols.length;
  const out = new Float64Array(n * d);
  for (let i = 0; i < n; i += 1) {
    const off = i * WIDTH;
    for (let j = 0; j < d; j += 1) {
      out[i * d + j] = src[off + (cols[j] as number)] as number;
    }
  }
  return out;
}

function leadAucOnIndices(
  scores: ArrayLike<number>,
  y: Uint8Array,
  secs: Float64Array,
  idx: Int32Array | readonly number[],
  leadSec: number,
): number {
  const s: number[] = [];
  const l: number[] = [];
  for (let k = 0; k < idx.length; k += 1) {
    const i = (idx as readonly number[])[k] as number;
    const value = secs[i] as number;
    if (Number.isNaN(value) || value >= leadSec) {
      s.push(scores[k] as number);
      l.push(y[i] as number);
    }
  }
  return rocAuc(s, l);
}

/** train.ts's val split, verbatim: `valFraction` of TRAIN SESSIONS, seeded. */
function sessionValSplit(train: TrainRows, fraction: number, seed: number): {
  fit: Int32Array;
  val: Int32Array;
  valSessions: Set<number>;
} {
  const rand = mulberry32(seed);
  const order = shuffled(
    Array.from({ length: train.sessions.length }, (_, i) => i),
    rand,
  );
  const count = Math.max(1, Math.round(train.sessions.length * fraction));
  const valSessions = new Set<number>(order.slice(0, count));
  const fit: number[] = [];
  const val: number[] = [];
  for (let i = 0; i < train.n; i += 1) {
    (valSessions.has(train.sessionOf[i] as number) ? val : fit).push(i);
  }
  return { fit: Int32Array.from(fit), val: Int32Array.from(val), valSessions };
}

const escalationSettings: EscalationSettings = {
  // The bake-off's own frozen point (0.55) is what mlp-tuned's selection score
  // used; it is a TRAIN-INTERNAL selection knob here, not a reported operating
  // point, and the reported one is the shipped 0.45 in holdout-bakeoff.ts.
  nudgeRisk: 0.55,
  prearmRisk: 0.8,
  prearmEnabled: true,
  prearmFuseSec: CONTRACT_PREARM_FUSE_SEC,
  baseFuseSec: DEFAULT_SETTINGS.countdownSec,
};

// ---------------------------------------------------------------------------
// 1. The linear family — lr-ceiling's own linear.ts, its own val split
// ---------------------------------------------------------------------------

const LAMBDAS = [1, 1e-1, 1e-2, 1e-3, 1e-4, 1e-5, 1e-6];

function linTerms(d: number): Term[] {
  return Array.from({ length: d }, (_, i) => ({ t: "lin", i }) as Term);
}

function pairTerms(d: number): Term[] {
  const out: Term[] = [];
  for (let i = 0; i < d; i += 1) {
    for (let j = i; j < d; j += 1) {
      out.push({ t: "prod", i, j });
    }
  }
  return out;
}

function fitLinear(
  train: TrainRows,
  base: Float64Array,
  d: number,
  spec: CompiledSpec,
  posPower: number,
  log: (m: string) => void,
): FittedModel {
  const { fit, val } = sessionValSplit(train, 0.1, SEED);
  const design = buildDesign(Float32Array.from(base), train.n, spec);
  const standardizer = fitStandardizer(design, spec.dim, fit);
  applyStandardizer(design, spec.dim, standardizer);

  let wPos = 0;
  let wNeg = 0;
  for (let k = 0; k < fit.length; k += 1) {
    const i = fit[k] as number;
    if ((train.y[i] as number) === 1) {
      wPos += train.importance[i] as number;
    } else {
      wNeg += train.importance[i] as number;
    }
  }
  const classWeight = wPos > 0 ? Math.pow(wNeg / wPos, posPower) : 1;
  const sampleWeight = new Float64Array(train.n);
  for (let i = 0; i < train.n; i += 1) {
    sampleWeight[i] = (train.importance[i] as number) * ((train.y[i] as number) === 1 ? classWeight : 1);
  }

  let warm: Float64Array | undefined;
  let best: { theta: Float64Array; lambda: number; auc: number } | null = null;
  const sweep: Array<{ lambda: number; valLeadAuc20: number }> = [];
  for (const lambda of LAMBDAS) {
    const fitted = fitLogisticL2(design, spec.dim, fit, train.y, sampleWeight, lambda, 300, warm);
    warm = fitted.theta;
    const valScores = new Array<number>(val.length);
    for (let k = 0; k < val.length; k += 1) {
      const row = val[k] as number;
      let z = fitted.theta[spec.dim] as number;
      const off = row * spec.dim;
      for (let j = 0; j < spec.dim; j += 1) {
        z += (fitted.theta[j] as number) * (design[off + j] as number);
      }
      valScores[k] = z;
    }
    const auc = leadAucOnIndices(valScores, train.y, train.secs, val, LEAD);
    sweep.push({ lambda, valLeadAuc20: round6(auc) });
    if (best === null || auc > best.auc) {
      best = { theta: Float64Array.from(fitted.theta), lambda, auc };
    }
  }
  const chosen = best as { theta: Float64Array; lambda: number; auc: number };

  const valLogits: number[] = [];
  const valLabels: number[] = [];
  const valWeights: number[] = [];
  for (let k = 0; k < val.length; k += 1) {
    const row = val[k] as number;
    let z = chosen.theta[spec.dim] as number;
    const off = row * spec.dim;
    for (let j = 0; j < spec.dim; j += 1) {
      z += (chosen.theta[j] as number) * (design[off + j] as number);
    }
    valLogits.push(z);
    valLabels.push(train.y[row] as number);
    valWeights.push(train.importance[row] as number);
  }
  const calibration = fitPlattRobust(valLogits, valLabels, valWeights);

  const buf = new Float64Array(spec.dim);
  const raw = new Array<number>(d).fill(0);
  const theta = chosen.theta;
  const mean = standardizer.mean;
  const std = standardizer.std;
  const name = spec.name;
  log(
    `  fit ${name.padEnd(20)} λ ${chosen.lambda} (val lead≥20s ${chosen.auc.toFixed(5)}) | ` +
      `Platt a ${calibration.a.toFixed(4)} b ${calibration.b.toFixed(4)}`,
  );
  return {
    name,
    family: spec.dim === d ? "logistic (plain additive GLM)" : "logistic + pairwise basis (GLM)",
    basis: name,
    featureDim: d,
    params: spec.dim + 1,
    recipe: {
      source: "scripts/forecast/candidates/lr-ceiling.ts",
      fit: "L-BFGS to convergence, importance-weighted, warm-started L2 path",
      posWeightPower: posPower,
      lambdaSelectedOn: "train-internal val (10% of TRAIN sessions) lead≥20s AUC",
      lambda: chosen.lambda,
      lambdaSweep: sweep,
      valLeadAuc20: round6(chosen.auc),
      calibration: { a: round6(calibration.a), b: round6(calibration.b) },
    },
    scoreFrame: (feats, offset) => {
      for (let j = 0; j < d; j += 1) {
        raw[j] = feats[offset + j] as number;
      }
      expandRow(spec, raw, buf);
      let z = theta[spec.dim] as number;
      for (let j = 0; j < spec.dim; j += 1) {
        z += (theta[j] as number) * (((buf[j] as number) - (mean[j] as number)) / (std[j] as number));
      }
      return sigmoidStable(calibration.a * z + calibration.b);
    },
  };
}

// ---------------------------------------------------------------------------
// 2. MLPs — the round-7 incumbent recipe and mlp-tuned's selected one
// ---------------------------------------------------------------------------

function zscoreOver(
  base: Float64Array,
  n: number,
  d: number,
  idx: Int32Array | null,
): { mean: Float64Array; scale: Float64Array; norm: Float64Array } {
  const mean = new Float64Array(d);
  const scale = new Float64Array(d);
  const count = idx === null ? n : idx.length;
  const at = (k: number): number => (idx === null ? k : (idx[k] as number));
  for (let k = 0; k < count; k += 1) {
    const off = at(k) * d;
    for (let f = 0; f < d; f += 1) {
      mean[f] = (mean[f] as number) + (base[off + f] as number);
    }
  }
  for (let f = 0; f < d; f += 1) {
    mean[f] = (mean[f] as number) / Math.max(1, count);
  }
  for (let k = 0; k < count; k += 1) {
    const off = at(k) * d;
    for (let f = 0; f < d; f += 1) {
      const diff = (base[off + f] as number) - (mean[f] as number);
      scale[f] = (scale[f] as number) + diff * diff;
    }
  }
  for (let f = 0; f < d; f += 1) {
    const s = Math.sqrt((scale[f] as number) / Math.max(1, count));
    scale[f] = s > 1e-6 ? s : 1;
  }
  const norm = new Float64Array(n * d);
  for (let i = 0; i < n; i += 1) {
    for (let f = 0; f < d; f += 1) {
      norm[i * d + f] = ((base[i * d + f] as number) - (mean[f] as number)) / (scale[f] as number);
    }
  }
  return { mean, scale, norm };
}

function mlpScorer(
  nets: readonly Net[],
  alpha: readonly number[],
  beta: number,
  mean: Float64Array,
  scale: Float64Array,
  d: number,
  calibration: { a: number; b: number },
): (feats: ArrayLike<number>, offset: number) => number {
  const scratches = nets.map((net) => makeScratch(net));
  const buf = new Float64Array(d);
  return (feats, offset) => {
    for (let f = 0; f < d; f += 1) {
      buf[f] = ((feats[offset + f] as number) - (mean[f] as number)) / (scale[f] as number);
    }
    let z = beta;
    for (let m = 0; m < nets.length; m += 1) {
      z += (alpha[m] as number) * forwardNet(nets[m] as Net, buf, 0, scratches[m] as Scratch, false);
    }
    return mlpSigmoid(calibration.a * z + calibration.b);
  };
}

/** The round-7 incumbent: one tanh d→12→1 net, the shipped trainer's protocol. */
function fitTinyMlp(train: TrainRows, base: Float64Array, d: number, log: (m: string) => void): FittedModel {
  const { fit, val } = sessionValSplit(train, 0.1, SEED);
  const { mean, scale, norm } = zscoreOver(base, train.n, d, fit);
  let positives = 0;
  for (let k = 0; k < fit.length; k += 1) {
    positives += train.y[fit[k] as number] as number;
  }
  const wPos = positives > 0 ? Math.pow((fit.length - positives) / positives, 0.5) : 1;
  const weight = new Float64Array(train.n);
  for (let i = 0; i < train.n; i += 1) {
    weight[i] = (train.y[i] as number) === 1 ? wPos : 1;
  }
  const spec: NetSpec = { dims: [d, 12], activation: "tanh" };
  // Early stop on importance-weighted val BCE — the round-7 criterion. trainNet
  // MAXIMIZES its score, so the criterion is its negation.
  const scoreScratchHolder: { scratch: Scratch | null } = { scratch: null };
  const valBce = (net: Net): number => {
    if (scoreScratchHolder.scratch === null) {
      scoreScratchHolder.scratch = makeScratch(net);
    }
    const scratch = scoreScratchHolder.scratch;
    let total = 0;
    let weightSum = 0;
    for (let k = 0; k < val.length; k += 1) {
      const i = val[k] as number;
      const logit = forwardNet(net, norm, i * d, scratch, false);
      const w = train.importance[i] as number;
      const p = Math.min(1 - 1e-9, Math.max(1e-9, mlpSigmoid(logit)));
      const y = train.y[i] as number;
      total += -w * (y * Math.log(p) + (1 - y) * Math.log(1 - p));
      weightSum += w;
    }
    return weightSum > 0 ? -total / weightSum : 0;
  };
  const result = trainNet(
    { x: norm, y: train.y, weight, fitIndex: fit },
    {
      spec,
      lr: 0.003,
      batch: 256,
      l2: 0.0001,
      dropout: 0,
      schedule: "const",
      warmupFrac: 0,
      maxEpochs: 400,
      patience: 40,
      seed: SEED,
      evalEvery: 1,
      score: valBce,
    },
  );
  const scratch = makeScratch(result.net);
  const valLogits: number[] = [];
  const valLabels: number[] = [];
  const valWeights: number[] = [];
  for (let k = 0; k < val.length; k += 1) {
    const i = val[k] as number;
    valLogits.push(forwardNet(result.net, norm, i * d, scratch, false));
    valLabels.push(train.y[i] as number);
    valWeights.push(train.importance[i] as number);
  }
  const calibration = fitPlattRobust(valLogits, valLabels, valWeights);
  const params = mlpParamCount(spec.dims);
  log(
    `  fit tinyMLP${d}-12-1 best epoch ${result.bestEpoch}/${result.epochsRan} | ` +
      `val −BCE ${result.bestScore.toFixed(5)} | ${params}p`,
  );
  const score = mlpScorer([result.net], [1], 0, mean, scale, d, calibration);
  return {
    name: `mlp${d}-12-1`,
    family: "TinyMLP (the round-7 incumbent architecture)",
    basis: `mlp${d}-12-1`,
    featureDim: d,
    params,
    recipe: {
      source: "the round-7 trainer (git 8990e50 scripts/forecast/train.ts)",
      arch: `${d}-12-1 tanh`,
      lr: 0.003,
      batch: 256,
      l2: 0.0001,
      posWeightPower: 0.5,
      maxEpochs: 400,
      patience: 40,
      earlyStopOn: "importance-weighted val BCE, val = 10% of TRAIN sessions",
      bestEpoch: result.bestEpoch,
      calibration: { a: round6(calibration.a), b: round6(calibration.b) },
    },
    scoreFrame: (feats, offset) => score(feats, offset),
  };
}

interface TunedSetup {
  norm: Float64Array;
  mean: Float64Array;
  scale: Float64Array;
  folds: Array<{ fitIndex: Int32Array; valIndex: Int32Array; valSessions: string[] }>;
  calIndex: Int32Array;
  calSessions: string[];
  dropped: number;
  attached: number;
}

/** mlp-tuned/split.ts's partition, reproduced at an arbitrary feature width. */
function buildTunedSetup(train: TrainRows, base: Float64Array, d: number, folds: number, calFraction: number): TunedSetup {
  const synthetic: number[] = [];
  const augmented: number[] = [];
  for (let s = 0; s < train.sessions.length; s += 1) {
    ((train.sessions[s] as string).startsWith("aug-") ? augmented : synthetic).push(s);
  }
  const rand = mulberry32(SEED ^ 0x5eed);
  const order = shuffled(synthetic, rand);
  const calCount = Math.max(1, Math.round(synthetic.length * calFraction));
  const CAL = -1;
  const groupOf = new Map<number, number>();
  order.forEach((session, position) => {
    groupOf.set(session, position < calCount ? CAL : (position - calCount) % folds);
  });
  const pool = synthetic.map((s) => ({
    id: train.sessions[s] as string,
    archetype: (train.replay.sessions[train.replayIndexOf.get(train.sessions[s] as string) as number] as SessionMeta)
      .archetype,
  }));
  const parents = augmentationParents(pool, SEED, 0.25);
  let dropped = 0;
  let attached = 0;
  for (const s of augmented) {
    const family = (parents.get(train.sessions[s] as string) ?? []).map((id) => train.sessions.indexOf(id));
    const groups = new Set(family.map((parent) => groupOf.get(parent)));
    const only = [...groups];
    if (family.some((parent) => parent < 0) || only.length !== 1 || only[0] === undefined || only[0] === CAL) {
      dropped += 1;
      continue;
    }
    groupOf.set(s, only[0]);
    attached += 1;
  }
  const calIndexList: number[] = [];
  const fitLists: number[][] = Array.from({ length: folds }, () => []);
  const valLists: number[][] = Array.from({ length: folds }, () => []);
  for (let i = 0; i < train.n; i += 1) {
    const s = train.sessionOf[i] as number;
    const group = groupOf.get(s);
    if (group === undefined) {
      continue;
    }
    if (group === CAL) {
      calIndexList.push(i);
      continue;
    }
    const isAugmented = (train.augmented[i] as number) === 1;
    for (let f = 0; f < folds; f += 1) {
      if (f === group) {
        if (!isAugmented) {
          (valLists[f] as number[]).push(i);
        }
      } else {
        (fitLists[f] as number[]).push(i);
      }
    }
  }
  // One shared z-score over EVERY train row — what makes the exact collapse possible.
  const { mean, scale, norm } = zscoreOver(base, train.n, d, null);
  const sessionIdsOf = (group: number): string[] =>
    [...groupOf.entries()]
      .filter(([session, g]) => g === group && !(train.sessions[session] as string).startsWith("aug-"))
      .map(([session]) => train.sessions[session] as string);
  return {
    norm,
    mean,
    scale,
    folds: Array.from({ length: folds }, (_, f) => ({
      fitIndex: Int32Array.from(fitLists[f] as number[]),
      valIndex: Int32Array.from(valLists[f] as number[]),
      valSessions: sessionIdsOf(f),
    })),
    calIndex: Int32Array.from(calIndexList),
    calSessions: sessionIdsOf(CAL),
    dropped,
    attached,
  };
}

/** mlp-tuned: 3 folds × one d-12-1 member, logit-standardized blend, Platt on the calibration slice. */
function fitMlpTuned(
  train: TrainRows,
  base: Float64Array,
  d: number,
  log: (m: string) => void,
): FittedModel {
  const FOLDS = 3;
  const setup = buildTunedSetup(train, base, d, FOLDS, 0.15);
  const spec: NetSpec = { dims: [d, 12], activation: "tanh" };
  const scoreScratch: { scratch: Scratch | null } = { scratch: null };
  // One risk buffer over the whole train replay, reused by every early-stop
  // evaluation (each only writes the frames of the session it is scoring).
  const riskBuf = new Float64Array(train.replay.totalFrames);

  const nets: Net[] = [];
  setup.folds.forEach((fold, f) => {
    // The selection score mlp-tuned's sweep maximized: fold-val lead≥20s AUC
    // + 0.1 × nudge recall through the SHIPPED reducer on the fold's own
    // val SESSIONS (train-internal, and at the bake-off's frozen 0.55 point).
    const valSessionIdx = fold.valSessions
      .map((id) => train.replayIndexOf.get(id))
      .filter((i): i is number => i !== undefined);
    let positives = 0;
    for (let k = 0; k < fold.fitIndex.length; k += 1) {
      positives += train.y[fold.fitIndex[k] as number] as number;
    }
    const wPos = positives > 0 ? Math.pow((fold.fitIndex.length - positives) / positives, 0.5) : 1;
    const weight = new Float64Array(train.n);
    for (let i = 0; i < train.n; i += 1) {
      weight[i] = (train.y[i] as number) === 1 ? wPos : 1;
    }
    const score = (net: Net): number => {
      if (scoreScratch.scratch === null) {
        scoreScratch.scratch = makeScratch(net);
      }
      const scratch = scoreScratch.scratch;
      // Lead-censored val AUC, calm negatives repeated by importance weight
      // (mlp-tuned's `leadExpansion`), on val LOGITS.
      const s: number[] = [];
      const l: number[] = [];
      const logits = new Float64Array(fold.valIndex.length);
      for (let k = 0; k < fold.valIndex.length; k += 1) {
        const i = fold.valIndex[k] as number;
        logits[k] = forwardNet(net, setup.norm, i * d, scratch, false);
        const secs = train.secs[i] as number;
        if (!(Number.isNaN(secs) || secs >= LEAD)) {
          continue;
        }
        const repeats = Math.round(train.importance[i] as number);
        for (let r = 0; r < repeats; r += 1) {
          s.push(logits[k] as number);
          l.push(train.y[i] as number);
        }
      }
      const auc = rocAuc(s, l);
      const calibration = fitPlattRobust(
        Array.from(logits),
        Array.from(fold.valIndex, (i) => train.y[i as number] as number),
        Array.from(fold.valIndex, (i) => train.importance[i as number] as number),
      );
      const scorer = mlpScorer([net], [1], 0, setup.mean, setup.scale, d, calibration);
      let drifts = 0;
      let hits = 0;
      for (const s2 of valSessionIdx) {
        const meta = train.replay.sessions[s2] as SessionMeta;
        for (let i = 0; i < meta.n; i += 1) {
          riskBuf[meta.offset + i] = scorer(train.replay.feats, (meta.offset + i) * WIDTH);
        }
        const totals = simulateSessionAlarms(train.replay, s2, riskBuf, escalationSettings);
        drifts += totals.drifts;
        hits += totals.eventHits;
      }
      return auc + 0.1 * (drifts > 0 ? hits / drifts : 0);
    };
    const result = trainNet(
      { x: setup.norm, y: train.y, weight, fitIndex: fold.fitIndex },
      {
        spec,
        lr: 0.01,
        batch: 256,
        l2: 0.003,
        dropout: 0,
        schedule: "const",
        warmupFrac: 0,
        maxEpochs: 60,
        patience: Math.max(20, Math.round(60 * 0.5)),
        seed: SEED,
        evalEvery: 5,
        score,
      },
    );
    nets.push(result.net);
    log(`  mlp-tuned${d} fold ${f}: best epoch ${result.bestEpoch}/${result.epochsRan} sel ${result.bestScore.toFixed(5)}`);
  });

  // Blend: standardize each member's logit distribution on the calibration
  // slice before averaging (affine ⇒ still collapsible into one net).
  const alpha: number[] = [];
  let beta = 0;
  for (const net of nets) {
    const scratch = makeScratch(net);
    let mean = 0;
    const logits = new Float64Array(setup.calIndex.length);
    for (let k = 0; k < setup.calIndex.length; k += 1) {
      logits[k] = forwardNet(net, setup.norm, (setup.calIndex[k] as number) * d, scratch, false);
      mean += logits[k] as number;
    }
    mean /= Math.max(1, setup.calIndex.length);
    let variance = 0;
    for (let k = 0; k < setup.calIndex.length; k += 1) {
      const diff = (logits[k] as number) - mean;
      variance += diff * diff;
    }
    const sd = Math.sqrt(variance / Math.max(1, setup.calIndex.length)) || 1;
    alpha.push(1 / (nets.length * sd));
    beta -= mean / (nets.length * sd);
  }
  const scratches = nets.map((net) => makeScratch(net));
  const calLogits: number[] = [];
  const calLabels: number[] = [];
  const calWeights: number[] = [];
  for (let k = 0; k < setup.calIndex.length; k += 1) {
    const i = setup.calIndex[k] as number;
    let z = beta;
    for (let m = 0; m < nets.length; m += 1) {
      z += (alpha[m] as number) * forwardNet(nets[m] as Net, setup.norm, i * d, scratches[m] as Scratch, false);
    }
    calLogits.push(z);
    calLabels.push(train.y[i] as number);
    calWeights.push(train.importance[i] as number);
  }
  const calibration = fitPlattRobust(calLogits, calLabels, calWeights);
  // Params: the ensemble collapses EXACTLY into one d→(3×12)→1 net.
  const params = mlpParamCount([d, nets.length * 12]);
  const score = mlpScorer(nets, alpha, beta, setup.mean, setup.scale, d, calibration);
  log(`  mlp-tuned${d}: ${nets.length} members → collapsed ${d}-${nets.length * 12}-1, ${params}p`);
  return {
    name: `mlp-tuned${d}`,
    family: "tuned + bagged MLP",
    basis: `mlp-tuned${d}`,
    featureDim: d,
    params,
    paramsNote: `${nets.length} × ${d}-12-1 members, collapsed exactly into one ${d}-${nets.length * 12}-1 net`,
    recipe: {
      source: "scripts/forecast/candidates/mlp-tuned.ts",
      selected: "18-12-1 tanh lr0.01 b256 l20.003 do0 const pw0.5 lead:flat e60 k1/fold (its metrics.json)",
      folds: nets.length,
      calibrationSessions: setup.calSessions.length,
      augmentedAttachedToParentFold: setup.attached,
      augmentedDropped: setup.dropped,
      earlyStopOn: "fold-val lead≥20s AUC + 0.1 × nudge-recall@30s through the shipped reducer",
      calibration: { a: round6(calibration.a), b: round6(calibration.b) },
    },
    scoreFrame: (feats, offset) => score(feats, offset),
  };
}

// ---------------------------------------------------------------------------
// 3. trees — the GBDT, its recorded hyper-parameters, its own CV + calibration
// ---------------------------------------------------------------------------

const TREES_MAX_BINS = 64;

function fitTrees(train: TrainRows, base: Float64Array, d: number, log: (m: string) => void): FittedModel {
  setGbdtFeatureWidth(d);
  const params: GbdtParams = {
    maxDepth: 4,
    learningRate: 0.1,
    maxTrees: 600,
    subsample: 0.5,
    colsample: 1,
    minChildCount: 100,
    minChildHess: 5,
    lambda: 1,
    minSplitGain: 1e-6,
    posWeightPower: 0.5,
    seed: SEED,
  };
  const CV_FOLDS = 3;
  // calibration sessions ~1 in 7 (trees/data.ts `valSessionSet(..., 7)`).
  const calSessions = new Set<number>();
  for (let s = 0; s < train.sessions.length; s += 1) {
    if (fnv1a32(`val:${SEED}:${train.sessions[s] as string}`) % 7 === 0) {
      calSessions.add(s);
    }
  }
  const foldOfSession = new Int32Array(train.sessions.length).fill(-1);
  for (let s = 0; s < train.sessions.length; s += 1) {
    if (calSessions.has(s)) {
      continue;
    }
    foldOfSession[s] = fnv1a32(`trees-fold:${SEED}:${train.sessions[s] as string}`) % CV_FOLDS;
  }
  const poolRowList: number[] = [];
  const foldRowLists: number[][] = Array.from({ length: CV_FOLDS }, () => []);
  for (let i = 0; i < train.n; i += 1) {
    const s = train.sessionOf[i] as number;
    if (calSessions.has(s)) {
      continue;
    }
    poolRowList.push(i);
    (foldRowLists[foldOfSession[s] as number] as number[]).push(i);
  }
  const poolRows = Int32Array.from(poolRowList);
  const edges = buildBinEdges(base, poolRows, TREES_MAX_BINS, 60_000);
  const bins = binMatrix(base, train.n, edges);

  const subsetBins = (rows: Int32Array): Uint8Array => {
    const out = new Uint8Array(rows.length * d);
    for (let k = 0; k < rows.length; k += 1) {
      const i = rows[k] as number;
      for (let f = 0; f < d; f += 1) {
        out[k * d + f] = bins[i * d + f] as number;
      }
    }
    return out;
  };
  const folds = Array.from({ length: CV_FOLDS }, (_, k) => {
    const valRows = Int32Array.from(foldRowLists[k] as number[]);
    const fitRows = Int32Array.from(
      poolRowList.filter((i) => (foldOfSession[train.sessionOf[i] as number] as number) !== k),
    );
    const valY = new Uint8Array(valRows.length);
    const eligible: number[] = [];
    for (let j = 0; j < valRows.length; j += 1) {
      const i = valRows[j] as number;
      valY[j] = train.y[i] as number;
      const secs = train.secs[i] as number;
      if (Number.isNaN(secs) || secs >= LEAD) {
        eligible.push(j);
      }
    }
    return { fitRows, valRows, valBins: subsetBins(valRows), valY, eligible: Int32Array.from(eligible) };
  });
  const aucOnSubset = (margins: Float64Array, y: Uint8Array, idx: Int32Array): number =>
    rocAuc(
      Array.from(idx, (j) => margins[j as number] as number),
      Array.from(idx, (j) => y[j as number] as number),
    );

  const foldTrees: number[] = [];
  const oofMargins = new Float64Array(poolRows.length);
  const poolPosition = new Int32Array(train.n).fill(-1);
  for (let k = 0; k < poolRows.length; k += 1) {
    poolPosition[poolRows[k] as number] = k;
  }
  for (const fold of folds) {
    const result = trainGbdt({
      bins,
      y: train.y,
      fitRows: fold.fitRows,
      edges,
      maxBins: TREES_MAX_BINS,
      params,
      valBins: fold.valBins,
      valRowCount: fold.valRows.length,
      monitor: {
        every: 10,
        patience: 8,
        score: (margins) => aucOnSubset(margins, fold.valY, fold.eligible),
      },
    });
    foldTrees.push(result.booster.trees.length);
    for (let j = 0; j < fold.valRows.length; j += 1) {
      oofMargins[poolPosition[fold.valRows[j] as number] as number] = result.valMargins[j] as number;
    }
  }
  const meanTrees = Math.max(1, Math.round(foldTrees.reduce((a, b) => a + b, 0) / foldTrees.length));
  const poolY = new Uint8Array(poolRows.length);
  const poolImportance = new Float64Array(poolRows.length);
  const poolSessionIds: string[] = [];
  for (let k = 0; k < poolRows.length; k += 1) {
    const i = poolRows[k] as number;
    poolY[k] = train.y[i] as number;
    poolImportance[k] = train.importance[i] as number;
    poolSessionIds.push(train.sessions[train.sessionOf[i] as number] as string);
  }
  const calibration = chooseCalibrator(oofMargins, poolY, poolImportance, poolSessionIds, SEED);
  const finalFit = trainGbdt({
    bins,
    y: train.y,
    fitRows: poolRows,
    edges,
    maxBins: TREES_MAX_BINS,
    params: { ...params, maxTrees: meanTrees },
  });
  const booster: Booster = finalFit.booster;
  const nodes = countNodes(booster);
  const buf = new Float64Array(d);
  log(
    `  trees${d}: fold trees [${foldTrees.join(" ")}] → ${meanTrees} | ${nodes.nodes} nodes | ` +
      `calibrator ${calibration.chosen}`,
  );
  return {
    name: `trees${d}`,
    family: "gradient-boosted decision trees (GBDT)",
    basis: `gbdt${d}`,
    featureDim: d,
    params: nodes.nodes,
    paramsNote: `TOTAL NODE COUNT (${nodes.internal} internal + ${nodes.leaves} leaves) across ${booster.trees.length} trees`,
    recipe: {
      source: "scripts/forecast/candidates/trees.ts",
      selected: "d4-lr0.1-sub0.5-col1-pw0.5-mc100-l21 (its metrics.json) — the 3-stage grid is NOT re-run",
      maxBins: TREES_MAX_BINS,
      cvFolds: CV_FOLDS,
      foldTrees,
      trees: booster.trees.length,
      calibrator: calibration.chosen,
      cvLogLoss: calibration.cvLogLoss,
      note: "tree count = mean of the 3 train-internal fold early stops; calibrator fitted on cross-fitted out-of-fold margins over the CV pool",
    },
    scoreFrame: (feats, offset) => {
      for (let f = 0; f < d; f += 1) {
        buf[f] = feats[offset + f] as number;
      }
      return applyCalibrator(calibration.calibrator, boosterMargin(booster, buf, 0));
    },
  };
}

// ---------------------------------------------------------------------------
// 4. hybrid — linear trunk + tanh residual, per-drift-type heads, noisy-OR
// ---------------------------------------------------------------------------

interface HybridHead {
  net: HybridNet;
  platt: { a: number; b: number };
  bestEpoch: number;
}

function fitHybrid(
  train: TrainRows,
  cols: readonly number[],
  label: string,
  baseDim: number,
  log: (m: string) => void,
): FittedModel {
  const d = cols.length;
  const base = sliceRows(train.x, train.n, cols);
  // hybrid's own train-internal split: 18% val, 18% calib of the SYNTHETIC
  // train sessions; augmented sessions are always fit-side.
  const synthetic = train.sessions.filter((id) => !id.startsWith("aug-"));
  const rand = mulberry32(SEED ^ 0x48594252);
  const shuffledIds = [...synthetic];
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
  const fitIdx: number[] = [];
  const valIdx: number[] = [];
  const calibIdx: number[] = [];
  for (let i = 0; i < train.n; i += 1) {
    const id = train.sessions[train.sessionOf[i] as number] as string;
    if (valIds.has(id)) valIdx.push(i);
    else if (calibIds.has(id)) calibIdx.push(i);
    else fitIdx.push(i);
  }

  const { mean, scale } = zscoreOver(base, train.n, d, Int32Array.from(fitIdx));
  const design = new Float64Array(train.n * d);
  for (let i = 0; i < train.n; i += 1) {
    for (let f = 0; f < d; f += 1) {
      design[i * d + f] = ((base[i * d + f] as number) - (mean[f] as number)) / (scale[f] as number);
    }
  }

  const hyper: HybridHyper = {
    hidden: 10,
    epochs: 45,
    batch: 256,
    lr: 0.008,
    l2: 0.0003,
    l2Linear: 0.00005,
    // hybrid's loss probe selected bce-pw1.0 on its own val split; pinned.
    posWeightPower: 1,
    gamma: 0,
    patience: 10,
    seed: SEED,
  };

  const specs: Array<{ label: string; y: Uint8Array }> = [
    { label: "generalist", y: train.y },
    { label: "tab_out", y: train.yTab },
    { label: "walk_away", y: train.yAway },
  ];
  const heads: Record<string, HybridHead> = {};
  const hBuf = new Float64Array(hyper.hidden);
  specs.forEach((spec, index) => {
    const valLabels = spec.label === "generalist" ? train.y : spec.label === "tab_out" ? train.yTab : train.yAway;
    const valScore = (net: HybridNet): number => {
      const s: number[] = [];
      const l: number[] = [];
      for (const i of valIdx) {
        const secs = train.secs[i] as number;
        if (!(Number.isNaN(secs) || secs >= LEAD)) {
          continue;
        }
        s.push(forwardHybrid(net, design, i * d, hBuf));
        l.push(valLabels[i] as number);
      }
      return rocAuc(s, l);
    };
    const result = trainHybrid(design, spec.y, d, fitIdx, { ...hyper, seed: hyper.seed + index * 7919 }, valScore);
    // Per-head Platt on the calibration slice only.
    const calLabels = spec.label === "generalist" ? train.y : spec.label === "tab_out" ? train.yTab : train.yAway;
    const logits: number[] = [];
    const ys: number[] = [];
    const ws: number[] = [];
    let positives = 0;
    for (const i of calibIdx) {
      logits.push(forwardHybrid(result.net, design, i * d, hBuf));
      ys.push(calLabels[i] as number);
      ws.push(train.importance[i] as number);
      positives += calLabels[i] as number;
    }
    heads[spec.label] = {
      net: result.net,
      platt: positives === 0 ? { a: 1, b: 0 } : fitPlattRobust(logits, ys, ws),
      bestEpoch: result.bestEpoch,
    };
  });

  const gen = heads["generalist"] as HybridHead;
  const tab = heads["tab_out"] as HybridHead;
  const away = heads["walk_away"] as HybridHead;
  const headProbability = (head: HybridHead, x: ArrayLike<number>, offset: number): number =>
    hybridSigmoid(head.platt.a * forwardHybrid(head.net, x, offset, hBuf) + head.platt.b);
  const fusedLogit = (x: ArrayLike<number>, offset: number, alpha: number): number => {
    const pGen = headProbability(gen, x, offset);
    if (alpha <= 0) {
      return hybridLogit(pGen);
    }
    const pOr = 1 - (1 - headProbability(tab, x, offset)) * (1 - headProbability(away, x, offset));
    return alpha * hybridLogit(pOr) + (1 - alpha) * hybridLogit(pGen);
  };

  // Fusion weight α on the VAL split, by lead-censored AUC.
  let bestAlpha = 0;
  let bestAuc = -1;
  for (const alpha of [0, 0.25, 0.4, 0.5, 0.6, 0.75, 1]) {
    const s: number[] = [];
    const l: number[] = [];
    for (const i of valIdx) {
      const secs = train.secs[i] as number;
      if (!(Number.isNaN(secs) || secs >= LEAD)) {
        continue;
      }
      s.push(fusedLogit(design, i * d, alpha));
      l.push(train.y[i] as number);
    }
    const auc = rocAuc(s, l);
    if (auc > bestAuc + 1e-9) {
      bestAuc = auc;
      bestAlpha = alpha;
    }
  }
  // Final Platt on the fused logit, calibration slice only.
  const finalLogits: number[] = [];
  const finalLabels: number[] = [];
  const finalWeights: number[] = [];
  for (const i of calibIdx) {
    finalLogits.push(fusedLogit(design, i * d, bestAlpha));
    finalLabels.push(train.y[i] as number);
    finalWeights.push(train.importance[i] as number);
  }
  const final = fitPlattRobust(finalLogits, finalLabels, finalWeights);
  const params = hybridParamCount(gen.net) + hybridParamCount(tab.net) + hybridParamCount(away.net);
  const buf = new Float64Array(d);
  log(
    `  ${label}: α ${bestAlpha} (val lead≥20s ${bestAuc.toFixed(5)}) | ${params}p | ` +
      `epochs ${gen.bestEpoch}/${tab.bestEpoch}/${away.bestEpoch}`,
  );
  return {
    name: label,
    family: "GLM trunk + tanh residual, per-drift-type heads (hybrid)",
    basis: label,
    featureDim: d,
    params,
    paramsNote: "3 heads × (linear trunk + 10-unit tanh residual)",
    recipe: {
      source: "scripts/forecast/candidates/hybrid.ts",
      hidden: 10,
      epochs: 45,
      batch: 256,
      lr: 0.008,
      l2Residual: 0.0003,
      l2Trunk: 0.00005,
      loss: "weighted BCE, w_pos=(n_neg/n_pos)^1 (its metrics.json's chosen probe; the 4-way loss grid is NOT re-run)",
      baseFeatures: baseDim,
      extraFeatures: cols.slice(baseDim).map((c) => (c < SHIPPED_DIM ? (FORECAST_FEATURE_KEYS[c] as string) : `hybridExtra${c - SHIPPED_DIM}`)),
      fusionAlpha: bestAlpha,
      alphaSelectedOn: "train-internal val lead≥20s AUC",
      calibration: { final: { a: round6(final.a), b: round6(final.b) } },
    },
    scoreFrame: (feats, offset) => {
      for (let f = 0; f < d; f += 1) {
        buf[f] = ((feats[offset + (cols[f] as number)] as number) - (mean[f] as number)) / (scale[f] as number);
      }
      return hybridSigmoid(final.a * fusedLogit(buf, 0, bestAlpha) + final.b);
    },
  };
}

// ---------------------------------------------------------------------------
// 5. temporal — causal 1-D CNN over the raw 1 Hz stream
// ---------------------------------------------------------------------------

interface TemporalMember {
  name: string;
  net: TemporalNet;
  extraIndex: number[];
  extraMean: Float64Array;
  extraScale: Float64Array;
  calibration: { a: number; b: number };
  paramCount: number;
  bestEpoch: number;
  valLeadAuc20: number;
}

const TEMPORAL = {
  seqLen: 120,
  epochs: 14,
  batch: 96,
  lr: 0.004,
  lrFloor: 0.04,
  l2: 0.00003,
  patience: 8,
  negRate: 0.35,
  valFraction: 0.2,
  posWeightPower: 0.5,
  filters: 16,
  kernel1: 10,
  stride1: 5,
  hidden: 16,
};

/**
 * Fits temporal's members and PRE-SCORES every hold-out frame with them, which
 * is the only way a sequence model can be plugged into the frame-vector
 * interface every other contender uses. The channels are rebuilt from the raw
 * streams (`buildChannels`, the contender's own builder) on both sides.
 */
async function fitTemporal(
  train: TrainRows,
  corpus: Corpus,
  log: (m: string) => void,
): Promise<FittedModel[]> {
  const pad = TEMPORAL.seqLen - 1;
  const started = Date.now();

  // --- channels for the TRAIN sessions ---------------------------------------
  // Every train session, SIMULATED AND AUGMENTED — `train.rawById` carries the
  // augmented streams that `raw-sessions.jsonl` does not.
  const trainChannels = new Map<string, Float64Array>();
  for (const sessionId of train.sessions) {
    const session = train.rawById.get(sessionId);
    const s = train.replayIndexOf.get(sessionId);
    if (session === undefined || s === undefined) {
      throw new Error(`train session ${sessionId} has no raw stream to build temporal channels from`);
    }
    const meta = train.replay.sessions[s] as SessionMeta;
    const frames = Array.from({ length: meta.n }, (_, i) => ({
      t: i + 1,
      values: [],
      raw: {},
      decision: decisionOf(train.replay, meta.offset + i),
      countdownActive: train.replay.countdown[meta.offset + i] === 1,
    }));
    trainChannels.set(sessionId, buildChannels(session, frames as never, pad));
  }

  const { fit, val, valSessions } = sessionValSplit(train, TEMPORAL.valFraction, SEED);
  // Channel z-scoring on FIT sessions only.
  const chMean = new Float64Array(CHANNEL_COUNT);
  const chScale = new Float64Array(CHANNEL_COUNT);
  let chCount = 0;
  train.sessions.forEach((id, s) => {
    if (valSessions.has(s)) {
      return;
    }
    const channels = trainChannels.get(id);
    const meta = train.replay.sessions[train.replayIndexOf.get(id) as number] as SessionMeta;
    if (channels === undefined) {
      return;
    }
    for (let t = 1; t <= meta.n; t += 1) {
      const at = (pad + t - 1) * CHANNEL_COUNT;
      for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        chMean[c] = (chMean[c] as number) + (channels[at + c] as number);
      }
    }
    chCount += meta.n;
  });
  for (let c = 0; c < CHANNEL_COUNT; c += 1) {
    chMean[c] = (chMean[c] as number) / Math.max(1, chCount);
  }
  train.sessions.forEach((id, s) => {
    if (valSessions.has(s)) {
      return;
    }
    const channels = trainChannels.get(id);
    const meta = train.replay.sessions[train.replayIndexOf.get(id) as number] as SessionMeta;
    if (channels === undefined) {
      return;
    }
    for (let t = 1; t <= meta.n; t += 1) {
      const at = (pad + t - 1) * CHANNEL_COUNT;
      for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        const diff = (channels[at + c] as number) - (chMean[c] as number);
        chScale[c] = (chScale[c] as number) + diff * diff;
      }
    }
  });
  for (let c = 0; c < CHANNEL_COUNT; c += 1) {
    const s = Math.sqrt((chScale[c] as number) / Math.max(1, chCount));
    chScale[c] = s > 1e-6 ? s : 1;
  }
  for (const channels of trainChannels.values()) {
    for (let i = 0; i < channels.length; i += CHANNEL_COUNT) {
      for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        channels[i + c] = ((channels[i + c] as number) - (chMean[c] as number)) / (chScale[c] as number);
      }
    }
  }

  const channelsOfRow = new Int32Array(train.n);
  const tOfRow = new Int32Array(train.n);
  const channelBySessionIdx: Float64Array[] = train.sessions.map(
    (id) => trainChannels.get(id) as Float64Array,
  );
  for (let i = 0; i < train.n; i += 1) {
    channelsOfRow[i] = train.sessionOf[i] as number;
    const meta = train.replay.sessions[
      train.replayIndexOf.get(train.sessions[train.sessionOf[i] as number] as string) as number
    ] as SessionMeta;
    tOfRow[i] = (train.frameOf[i] as number) - meta.offset + 1;
  }

  const fitPos: number[] = [];
  const fitNeg: number[] = [];
  for (let k = 0; k < fit.length; k += 1) {
    const i = fit[k] as number;
    ((train.y[i] as number) === 1 ? fitPos : fitNeg).push(i);
  }
  const wPos = Math.pow(fitNeg.length / Math.max(1, fitPos.length), TEMPORAL.posWeightPower);
  const wNeg = 1 / TEMPORAL.negRate;

  const arch: TemporalArch = {
    seqLen: TEMPORAL.seqLen,
    inChannels: CHANNEL_COUNT,
    convs: [
      { kernel: TEMPORAL.kernel1, stride: TEMPORAL.stride1, out: TEMPORAL.filters },
      { kernel: 5, stride: 2, out: TEMPORAL.filters },
      { kernel: 3, stride: 1, out: TEMPORAL.filters },
    ],
    extras: 0,
    hidden: TEMPORAL.hidden,
  };

  const variants: Array<{ name: string; extraIndex: number[] }> = [
    { name: "seq", extraIndex: [] },
    { name: "seq+ctx", extraIndex: [...CONTEXT_FEATURE_INDEX] },
    { name: `seq+f${OLD_DIM}`, extraIndex: basisCols(OLD_DIM) },
    { name: `seq+f${SHIPPED_DIM}`, extraIndex: basisCols(SHIPPED_DIM) },
  ];

  const members: TemporalMember[] = [];
  for (const variant of variants) {
    const extraCount = variant.extraIndex.length;
    const extraMean = new Float64Array(Math.max(1, extraCount));
    const extraScale = new Float64Array(Math.max(1, extraCount)).fill(1);
    if (extraCount > 0) {
      for (let k = 0; k < fit.length; k += 1) {
        const off = (train.frameOf[fit[k] as number] as number) * WIDTH;
        for (let e = 0; e < extraCount; e += 1) {
          extraMean[e] =
            (extraMean[e] as number) + (train.replay.feats[off + (variant.extraIndex[e] as number)] as number);
        }
      }
      for (let e = 0; e < extraCount; e += 1) {
        extraMean[e] = (extraMean[e] as number) / fit.length;
      }
      const acc = new Float64Array(extraCount);
      for (let k = 0; k < fit.length; k += 1) {
        const off = (train.frameOf[fit[k] as number] as number) * WIDTH;
        for (let e = 0; e < extraCount; e += 1) {
          const diff =
            (train.replay.feats[off + (variant.extraIndex[e] as number)] as number) - (extraMean[e] as number);
          acc[e] = (acc[e] as number) + diff * diff;
        }
      }
      for (let e = 0; e < extraCount; e += 1) {
        const s = Math.sqrt((acc[e] as number) / fit.length);
        extraScale[e] = s > 1e-6 ? s : 1;
      }
    }
    const extraBuf = new Float64Array(Math.max(1, extraCount));
    const fillExtras = (row: number): void => {
      if (extraCount === 0) {
        return;
      }
      const off = (train.frameOf[row] as number) * WIDTH;
      for (let e = 0; e < extraCount; e += 1) {
        extraBuf[e] =
          ((train.replay.feats[off + (variant.extraIndex[e] as number)] as number) - (extraMean[e] as number)) /
          (extraScale[e] as number);
      }
    };

    const memberArch: TemporalArch = { ...arch, extras: extraCount };
    const netRand = mulberry32(SEED * 7919 + variant.name.length * 131 + TEMPORAL.seqLen);
    const net = new TemporalNet(memberArch, netRand);
    const params = net.paramArrays();
    const grads = net.newGrads();
    const gradArrays = net.gradArrays(grads);
    const optimizer = new Adam(params, TEMPORAL.lr, TEMPORAL.l2);
    const paramTotal = net.paramCount();

    const valLogitsNow = (): number[] => {
      const out: number[] = [];
      for (let k = 0; k < val.length; k += 1) {
        const row = val[k] as number;
        fillExtras(row);
        out.push(
          net.forward(
            channelBySessionIdx[channelsOfRow[row] as number] as Float64Array,
            ((tOfRow[row] as number) - 1) * CHANNEL_COUNT,
            extraBuf,
            0,
          ),
        );
      }
      return out;
    };

    const epochRand = mulberry32((SEED ^ 0x51ce) + variant.name.length * 977);
    let best = { auc: -1, epoch: -1, snapshot: net.snapshot() };
    let sinceBest = 0;
    const variantStart = Date.now();
    for (let epoch = 0; epoch < TEMPORAL.epochs; epoch += 1) {
      const lrScale =
        TEMPORAL.lrFloor +
        (1 - TEMPORAL.lrFloor) *
          0.5 *
          (1 + Math.cos((Math.PI * epoch) / Math.max(1, TEMPORAL.epochs - 1)));
      const negatives = shuffled(fitNeg, epochRand).slice(0, Math.round(fitNeg.length * TEMPORAL.negRate));
      const order = shuffled([...fitPos, ...negatives], epochRand);
      for (let start = 0; start < order.length; start += TEMPORAL.batch) {
        const end = Math.min(order.length, start + TEMPORAL.batch);
        net.zeroGrads(grads);
        let batchWeight = 0;
        for (let k = start; k < end; k += 1) {
          const row = order[k] as number;
          const channels = channelBySessionIdx[channelsOfRow[row] as number] as Float64Array;
          const offset = ((tOfRow[row] as number) - 1) * CHANNEL_COUNT;
          fillExtras(row);
          const logit = net.forward(channels, offset, extraBuf, 0);
          const label = train.y[row] as number;
          const weight = label === 1 ? wPos : wNeg;
          batchWeight += weight;
          net.backward(bceGrad(logit, label, weight), channels, offset, grads);
        }
        if (batchWeight <= 0) {
          continue;
        }
        optimizer.update(params, gradArrays, 1 / batchWeight, lrScale);
      }
      const auc = leadAucOnIndices(valLogitsNow(), train.y, train.secs, val, LEAD);
      if (auc > best.auc + 1e-6) {
        best = { auc, epoch, snapshot: net.snapshot() };
        sinceBest = 0;
      } else {
        sinceBest += 1;
      }
      log(
        `  temporal ${variant.name} epoch ${String(epoch).padStart(2)} val lead≥20s ${auc.toFixed(5)}` +
          `${sinceBest === 0 ? " *" : ""} | ${((Date.now() - variantStart) / 1000).toFixed(0)}s`,
      );
      if (sinceBest >= TEMPORAL.patience) {
        break;
      }
    }
    net.restore(best.snapshot);
    const valLogits = valLogitsNow();
    const calibration = fitPlattRobust(
      valLogits,
      Array.from(val, (i) => train.y[i as number] as number),
      Array.from(val, (i) => train.importance[i as number] as number),
    );
    members.push({
      name: variant.name,
      net,
      extraIndex: variant.extraIndex,
      extraMean,
      extraScale,
      calibration,
      paramCount: paramTotal,
      bestEpoch: best.epoch,
      valLeadAuc20: round6(best.auc),
    });
    log(
      `  temporal ${variant.name}: ${paramTotal}p | best epoch ${best.epoch} | val lead≥20s ${best.auc.toFixed(4)} | ` +
        `${((Date.now() - variantStart) / 1000).toFixed(0)}s`,
    );
  }
  trainChannels.clear();

  // --- pre-score every HOLD-OUT frame with every member ----------------------
  const memberRisk = members.map(() => new Float64Array(corpus.totalFrames));
  const sessionIndexById = new Map(corpus.sessions.map((session, i) => [session.id, i]));
  let done = 0;
  const scoreStart = Date.now();
  let timingWindow: Float64Array | null = null;
  for await (const session of readJsonl<RawSession>(join(holdoutRoot(), HOLDOUT_SESSIONS_FILE))) {
    const s = sessionIndexById.get(session.id);
    if (s === undefined) {
      throw new Error(`hold-out session ${session.id} is missing from the replayed corpus`);
    }
    const meta = corpus.sessions[s] as SessionMeta;
    const frames = Array.from({ length: meta.n }, (_, i) => ({
      t: i + 1,
      values: [],
      raw: {},
      decision: decisionOf(corpus, meta.offset + i),
      countdownActive: corpus.countdown[meta.offset + i] === 1,
    }));
    const channels = buildChannels(session, frames as never, pad);
    for (let i = 0; i < channels.length; i += CHANNEL_COUNT) {
      for (let c = 0; c < CHANNEL_COUNT; c += 1) {
        channels[i + c] = ((channels[i + c] as number) - (chMean[c] as number)) / (chScale[c] as number);
      }
    }
    members.forEach((member, m) => {
      const extraBuf = new Float64Array(Math.max(1, member.extraIndex.length));
      const risk = memberRisk[m] as Float64Array;
      for (let i = 0; i < meta.n; i += 1) {
        const frame = meta.offset + i;
        const off = frame * WIDTH;
        for (let e = 0; e < member.extraIndex.length; e += 1) {
          extraBuf[e] =
            ((corpus.feats[off + (member.extraIndex[e] as number)] as number) - (member.extraMean[e] as number)) /
            (member.extraScale[e] as number);
        }
        const logit = member.net.forward(channels, i * CHANNEL_COUNT, extraBuf, 0);
        risk[frame] = sigmoidStable(member.calibration.a * logit + member.calibration.b);
      }
    });
    if (timingWindow === null) {
      timingWindow = Float64Array.from(channels.subarray(0, TEMPORAL.seqLen * CHANNEL_COUNT));
    }
    done += 1;
    if (done % 100 === 0) {
      log(`  temporal scored ${done}/${corpus.sessions.length} hold-out sessions … ${((Date.now() - scoreStart) / 1000).toFixed(0)}s`);
    }
  }
  log(`temporal: fit + scored in ${((Date.now() - started) / 1000).toFixed(1)}s`);

  const window = timingWindow as Float64Array;
  const byName = new Map(members.map((member, m) => [member.name, { member, risk: memberRisk[m] as Float64Array }]));
  const build = (label: string, names: readonly string[], note: string): FittedModel => {
    const picked = names.map((name) => byName.get(name) as { member: TemporalMember; risk: Float64Array });
    const params = picked.reduce((sum, entry) => sum + entry.member.paramCount, 0);
    return {
      name: label,
      family: "causal 1-D CNN on the raw 1 Hz stream (temporal)",
      basis: label,
      featureDim: CHANNEL_COUNT,
      params,
      paramsNote: `${picked.length} net(s) over ${CHANNEL_COUNT} raw channels × ${TEMPORAL.seqLen} s; ${note}`,
      recipe: {
        source: "scripts/forecast/candidates/temporal.ts",
        members: picked.map((entry) => ({
          name: entry.member.name,
          params: entry.member.paramCount,
          bestEpoch: entry.member.bestEpoch,
          valLeadAuc20: entry.member.valLeadAuc20,
        })),
        config: TEMPORAL,
        fusion: picked.length > 1 ? "mean calibrated risk" : "single net",
      },
      scoreFrame: (_feats, _offset, frame) => {
        let sum = 0;
        for (const entry of picked) {
          sum += entry.risk[frame] as number;
        }
        return sum / picked.length;
      },
      measureMicros: (iterations: number): number => {
        const extras = picked.map((entry) => new Float64Array(Math.max(1, entry.member.extraIndex.length)));
        let sink = 0;
        for (let k = 0; k < Math.min(200, iterations); k += 1) {
          picked.forEach((entry, e) => {
            sink += entry.member.net.forward(window, 0, extras[e] as Float64Array, 0);
          });
        }
        const started2 = process.hrtime.bigint();
        for (let k = 0; k < iterations; k += 1) {
          picked.forEach((entry, e) => {
            sink += entry.member.net.forward(window, 0, extras[e] as Float64Array, 0);
          });
        }
        const elapsed = Number(process.hrtime.bigint() - started2);
        if (!Number.isFinite(sink)) {
          throw new Error("temporal timing produced a non-finite logit");
        }
        return elapsed / iterations / 1000;
      },
    };
  };

  return [
    build(`temporal-ens${OLD_DIM}`, ["seq", "seq+ctx", `seq+f${OLD_DIM}`], "3-net ensemble"),
    build(`temporal-1net${OLD_DIM}`, [`seq+f${OLD_DIM}`], "best single net (seq + late fusion)"),
    build(`temporal-ens${SHIPPED_DIM}`, ["seq", "seq+ctx", `seq+f${SHIPPED_DIM}`], "3-net ensemble"),
    build(`temporal-1net${SHIPPED_DIM}`, [`seq+f${SHIPPED_DIM}`], "best single net (seq + late fusion)"),
  ];
}

// ---------------------------------------------------------------------------

export async function fitFamilies(
  train: TrainRows,
  corpus: Corpus,
  options: FitOptions,
): Promise<FittedModel[]> {
  const { log, only } = options;
  const models: FittedModel[] = [];
  /** Pushes the cached model when there is one; otherwise runs `fit()`. */
  const add = (name: string, fit: () => FittedModel): void => {
    const hit = options.cached(name);
    if (hit !== null) {
      log(`  reusing cached scores for ${name}`);
      models.push(hit);
      return;
    }
    models.push(fit());
  };

  // --- the committed head, exactly as it ships -------------------------------
  if (wanted(only, "shipped")) {
    const parsed = parseForecastWeights(
      JSON.parse(readFileSync(join(repoRoot(), "src", "shared", "forecast", "weights.json"), "utf8")),
    );
    if (parsed === null) {
      throw new Error("src/shared/forecast/weights.json failed parseForecastWeights");
    }
    add(`shipped:${parsed.basis}`, () => {
      const probe = new Array<number>(SHIPPED_DIM).fill(0);
      return {
        name: `shipped:${parsed.basis}`,
        family: "the committed weights.json (not refit here)",
        basis: parsed.basis,
        featureDim: SHIPPED_DIM,
        params: parsed.paramCount,
        recipe: {
          source: "src/shared/forecast/weights.json, produced by npm run forecast:train",
          note:
            "scored through the SHIPPED forward pass, so this row is exactly what " +
            "`npm run forecast:eval:holdout` reports; every other row is a refit",
          trainProvenanceSha: parsed.trainProvenanceSha,
        },
        scoreFrame: (feats, offset) => {
          for (let f = 0; f < SHIPPED_DIM; f += 1) {
            probe[f] = feats[offset + f] as number;
          }
          return forward(parsed, probe).rawRisk;
        },
      };
    });
  }

  for (const d of [OLD_DIM, SHIPPED_DIM]) {
    let base: Float64Array | null = null;
    const baseOf = (): Float64Array => {
      if (base === null) {
        base = sliceRows(train.x, train.n, basisCols(d));
      }
      return base;
    };
    if (wanted(only, "linear")) {
      log(`linear family, ${d}-feature basis:`);
      add(`lr${d}`, () => fitLinear(train, baseOf(), d, compileSpec(`lr${d}`, d, linTerms(d)), 1, log));
      add(`lr${d}+pairwise`, () =>
        fitLinear(
          train,
          baseOf(),
          d,
          compileSpec(`lr${d}+pairwise`, d, [...linTerms(d), ...pairTerms(d)]),
          1,
          log,
        ),
      );
    }
    if (wanted(only, "mlp")) {
      log(`MLP family, ${d}-feature basis:`);
      add(`mlp${d}-12-1`, () => fitTinyMlp(train, baseOf(), d, log));
      add(`mlp-tuned${d}`, () => fitMlpTuned(train, baseOf(), d, log));
    }
    if (wanted(only, "trees")) {
      log(`GBDT family, ${d}-feature basis:`);
      add(`trees${d}`, () => fitTrees(train, baseOf(), d, log));
    }
  }

  if (wanted(only, "hybrid")) {
    log("hybrid family:");
    // 18-basis: the contender's own 25 columns (18 shipped + its 7 extras).
    const cols18 = [...basisCols(OLD_DIM), ...Array.from({ length: HYBRID_EXTRA_DIM }, (_, i) => SHIPPED_DIM + i)];
    add(`hybrid${cols18.length}`, () => fitHybrid(train, cols18, `hybrid${cols18.length}`, OLD_DIM, log));
    // 24-basis: the shipped 24 plus only those hybrid extras NOT already in them.
    const cols24 = [...basisCols(SHIPPED_DIM), ...HYBRID_EXTRA_ONLY.map((entry) => entry.col)];
    add(`hybrid${cols24.length}`, () => fitHybrid(train, cols24, `hybrid${cols24.length}`, SHIPPED_DIM, log));
  }

  if (wanted(only, "temporal")) {
    const names = [
      `temporal-ens${OLD_DIM}`,
      `temporal-1net${OLD_DIM}`,
      `temporal-ens${SHIPPED_DIM}`,
      `temporal-1net${SHIPPED_DIM}`,
    ];
    const hits = names.map((name) => options.cached(name));
    if (hits.every((hit) => hit !== null)) {
      log("temporal family: all four models reused from cache");
      models.push(...(hits as FittedModel[]));
    } else {
      log("temporal family:");
      models.push(...(await fitTemporal(train, corpus, log)));
    }
  }

  return models;
}
