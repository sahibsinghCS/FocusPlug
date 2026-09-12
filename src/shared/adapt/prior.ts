/**
 * Fitting the shipped prior from a dataset.
 *
 * `PRIOR_WEIGHTS` in `model.ts` is where every install starts before it has
 * seen the user drift even once, and right now those seventeen numbers are
 * hand-set from the same reasoning the old fixed fuse encoded. They are the
 * weakest claim in the model: defensible as a starting guess, but a guess.
 *
 * This fits them instead, on a population of drifts, with the same learner that
 * runs on-device. Nothing about the per-user model changes — it still learns
 * locally from its own drifts — but day one stops being a shrug.
 *
 * The split is by drift, not by training example. One drift expands into an
 * example per candidate fuse, so splitting after expansion would put near-copies
 * of the same moment on both sides and report a score that is mostly leakage.
 */

import { FEATURE_COUNT, FEATURE_NAMES, type FeatureName } from "./features";
import { learn, predictRecovery, PRIOR_WEIGHTS, type AdaptiveModel } from "./model";
import { examplesFor, type TrainingExample } from "./train";
import { rowToMoment, type DriftRow } from "./dataset";

export interface FitOptions {
  /** Passes over the data. The rate decays with samples, so a few is plenty. */
  epochs?: number;
  /** Fraction of drifts held out for scoring. */
  holdout?: number;
  seed?: number;
}

export interface FitReport {
  weights: Record<FeatureName, number>;
  trainDrifts: number;
  holdoutDrifts: number;
  holdoutExamples: number;
  /** Mean negative log-likelihood on held-out examples. Lower is better. */
  fittedLogLoss: number;
  /** The same metric for the hand-set prior currently shipping. */
  shippedLogLoss: number;
  fittedAccuracy: number;
  shippedAccuracy: number;
}

function rng(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4_294_967_296;
  };
}

/** Stable per-row hash, so the same file always splits the same way. */
function hashString(text: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

function zeroAnchoredModel(): AdaptiveModel {
  const zeros = new Array<number>(FEATURE_COUNT).fill(0);
  return {
    weights: [...zeros],
    prior: zeros,
    samples: 0,
    drifts: 0,
    recoveries: 0,
    probes: 0,
    layout: 0,
  };
}

function shippedModel(): AdaptiveModel {
  const weights = FEATURE_NAMES.map((name) => PRIOR_WEIGHTS[name]);
  return { ...zeroAnchoredModel(), weights };
}

function expand(rows: readonly DriftRow[]): TrainingExample[] {
  const examples: TrainingExample[] = [];
  for (const row of rows) {
    const moment = rowToMoment(row);
    examples.push(
      ...examplesFor(moment, {
        recoveredAfterSec: row.recoveredAfterSec,
        fuseSec: row.fuseSec,
      }),
    );
  }
  return examples;
}

function scoreOn(
  model: AdaptiveModel,
  examples: readonly TrainingExample[],
): { logLoss: number; accuracy: number } {
  if (examples.length === 0) {
    return { logLoss: 0, accuracy: 0 };
  }
  let loss = 0;
  let right = 0;
  for (const example of examples) {
    const predicted = predictRecovery(model, example.features);
    // Clamped so a confident miss costs a large finite number, not Infinity.
    const safe = Math.min(1 - 1e-9, Math.max(1e-9, predicted));
    loss += example.recovered ? -Math.log(safe) : -Math.log(1 - safe);
    if (example.recovered === predicted >= 0.5) {
      right += 1;
    }
  }
  return { logLoss: loss / examples.length, accuracy: right / examples.length };
}

export function fitPrior(rows: readonly DriftRow[], options: FitOptions = {}): FitReport {
  const epochs = Math.max(1, Math.floor(options.epochs ?? 4));
  const holdoutFraction = Math.min(0.5, Math.max(0, options.holdout ?? 0.2));
  const random = rng(options.seed ?? 7);

  const holdoutRows = rows.filter((row) => hashString(row.driftId) < holdoutFraction);
  const trainRows = rows.filter((row) => hashString(row.driftId) >= holdoutFraction);

  const trainExamples = expand(trainRows);
  const holdoutExamples = expand(holdoutRows);

  let model = zeroAnchoredModel();
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    // Shuffle per epoch: the expansion emits candidates in fuse order, and
    // training a sequential learner on sorted data biases the fuse terms.
    const order = trainExamples.map((_unused, index) => index);
    for (let index = order.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(random() * (index + 1));
      [order[index], order[swap]] = [order[swap]!, order[index]!];
    }
    for (const index of order) {
      const example = trainExamples[index]!;
      model = learn(model, example.features, example.recovered);
    }
  }

  const fitted = scoreOn(model, holdoutExamples);
  const shipped = scoreOn(shippedModel(), holdoutExamples);

  const weights = {} as Record<FeatureName, number>;
  FEATURE_NAMES.forEach((name, index) => {
    weights[name] = Math.round((model.weights[index] ?? 0) * 1000) / 1000;
  });

  return {
    weights,
    trainDrifts: trainRows.length,
    holdoutDrifts: holdoutRows.length,
    holdoutExamples: holdoutExamples.length,
    fittedLogLoss: fitted.logLoss,
    shippedLogLoss: shipped.logLoss,
    fittedAccuracy: fitted.accuracy,
    shippedAccuracy: shipped.accuracy,
  };
}

/** The fitted weights as a block that can be pasted straight into `model.ts`. */
export function printableWeights(weights: Record<FeatureName, number>): string {
  const width = Math.max(...FEATURE_NAMES.map((name) => name.length));
  const lines = FEATURE_NAMES.map(
    (name) => `  ${name}:${" ".repeat(width - name.length)} ${weights[name].toFixed(3)},`,
  );
  return `export const PRIOR_WEIGHTS: Readonly<Record<FeatureName, number>> = {\n${lines.join(
    "\n",
  )}\n};`;
}
