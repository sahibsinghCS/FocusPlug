/**
 * Prior-anchored online logistic regression.
 *
 * Predicts whether you will fix a drift yourself before the fuse runs out.
 * Trained one example at a time, on-device, from labels the policy engine
 * already emits: `cancel_countdown` means you recovered, `kill` means you did
 * not. There is no training run and no dataset to collect.
 *
 * The regulariser pulls toward the shipped prior rather than toward zero, so
 * four samples cannot run away with the model — it stays close to sensible
 * defaults until it has earned the right to disagree with them.
 */

import { FEATURE_COUNT, FEATURE_NAMES, type FeatureName } from "./features";

export interface AdaptiveModel {
  /** One weight per entry in FEATURE_NAMES, same order. */
  weights: number[];
  /** Where the regulariser pulls back to. */
  prior: number[];
  /** Gradient steps taken. One drift produces several — see `train.ts`. */
  samples: number;
  /** Real countdowns observed. This is what "how much has it learned" means. */
  drifts: number;
  /**
   * Drifts where we actually saw them come back. Only these locate *when* —
   * a kill at three seconds says nothing about what eight would have done.
   */
  recoveries: number;
  /**
   * Deliberately generous fuses handed out to find out what they do. Only
   * these can prove someone never comes back — an ordinary short fuse that
   * killed them proves nothing.
   */
  probes: number;
  /** Bumped when the feature layout changes so stale models are discarded. */
  layout: number;
}

/** Raise when FEATURE_NAMES changes; older stored models are then dropped. */
export const FEATURE_LAYOUT = 2;

/**
 * Shipped starting point, in log-odds of recovering. Hand-set from the same
 * reasoning the fixed 10-second fuse encoded: most people do come back, a
 * blocked window is a more deliberate drift than a wobbling desk reading, and
 * more seconds means more chance to recover.
 */
export const PRIOR_WEIGHTS: Readonly<Record<FeatureName, number>> = {
  bias: 0.4,
  blockedWindow: -0.5,
  deskAway: -0.2,
  deskConfidence: -0.1,
  minutesIn: -0.3,
  freshSwitch: 0.3,
  switchRate: -0.4,
  priorDrifts: -0.5,
  priorKills: -0.6,
  lateNight: -0.3,
  sessionLeft: 0.2,
  fuseLength: 0.6,
  // Each extra threshold crossed is a little more chance to notice and fix it.
  fuseOver5: 0.45,
  fuseOver8: 0.45,
  fuseOver12: 0.45,
  fuseOver18: 0.35,
  fuseOver25: 0.25,
};

const LEARNING_RATE = 0.35;
const L2 = 0.05;
/** Real drifts after which the model is trusted as far as it will ever be. */
export const CONFIDENCE_DRIFTS = 12;
/** Recoveries that pin down the timing well enough to stop probing. */
export const RECOVERIES_NEEDED = 4;
/** Generous fuses that came back empty before we accept they never return. */
export const PROBES_NEEDED = 8;

function priorVector(): number[] {
  return FEATURE_NAMES.map((name) => PRIOR_WEIGHTS[name]);
}

export function createModel(): AdaptiveModel {
  const prior = priorVector();
  return { weights: [...prior], prior, samples: 0, drifts: 0, recoveries: 0, probes: 0, layout: FEATURE_LAYOUT };
}

export function sigmoid(z: number): number {
  // Split by sign so a large negative z cannot overflow Math.exp.
  if (z >= 0) {
    return 1 / (1 + Math.exp(-z));
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function dot(weights: readonly number[], features: readonly number[]): number {
  let sum = 0;
  for (let i = 0; i < weights.length; i += 1) {
    sum += weights[i]! * (features[i] ?? 0);
  }
  return sum;
}

/** P(you recover before the fuse runs out). */
export function predictRecovery(model: AdaptiveModel, features: readonly number[]): number {
  if (features.length !== FEATURE_COUNT) {
    throw new Error(`Expected ${FEATURE_COUNT} features, got ${features.length}`);
  }
  return sigmoid(dot(model.weights, features));
}

/**
 * One gradient step. `recovered` is the free label: true when the countdown
 * was cancelled because you came back, false when it ran to a kill.
 *
 * The step size decays with experience, so early sessions move the model and
 * late ones only nudge it.
 */
export function learn(
  model: AdaptiveModel,
  features: readonly number[],
  recovered: boolean,
): AdaptiveModel {
  if (features.length !== FEATURE_COUNT) {
    throw new Error(`Expected ${FEATURE_COUNT} features, got ${features.length}`);
  }
  const predicted = predictRecovery(model, features);
  const target = recovered ? 1 : 0;
  const error = predicted - target;
  const rate = LEARNING_RATE / Math.sqrt(1 + model.samples);

  const weights = model.weights.map((weight, index) => {
    const gradient = error * (features[index] ?? 0) + L2 * (weight - model.prior[index]!);
    return weight - rate * gradient;
  });

  return { ...model, weights, samples: model.samples + 1 };
}

/** 0 at the first session, approaching 1 as the model earns its keep. */
export function confidence(model: AdaptiveModel): number {
  return Math.min(1, model.drifts / CONFIDENCE_DRIFTS);
}

/**
 * Has the model seen enough to stop deliberately probing with long fuses?
 * Either it has watched them come back often enough to know the timing, or it
 * has waited through enough drifts to conclude they simply do not.
 */
export function doneExploring(model: AdaptiveModel): boolean {
  return model.recoveries >= RECOVERIES_NEEDED || model.probes >= PROBES_NEEDED;
}

/** How far each weight has moved from the shipped prior — what it learned. */
export function learnedShift(model: AdaptiveModel): Array<{
  name: FeatureName;
  weight: number;
  prior: number;
  shift: number;
}> {
  return FEATURE_NAMES.map((name, index) => {
    const weight = model.weights[index] ?? 0;
    const prior = model.prior[index] ?? 0;
    return { name, weight, prior, shift: weight - prior };
  });
}

function isNumberArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((item) => typeof item === "number" && Number.isFinite(item))
  );
}

/** Anything unrecognised or from an older feature layout starts fresh. */
export function reviveModel(value: unknown): AdaptiveModel {
  if (typeof value !== "object" || value === null) {
    return createModel();
  }
  const record = value as Partial<AdaptiveModel>;
  if (record.layout !== FEATURE_LAYOUT) {
    return createModel();
  }
  if (!isNumberArray(record.weights, FEATURE_COUNT)) {
    return createModel();
  }
  if (!isNumberArray(record.prior, FEATURE_COUNT)) {
    return createModel();
  }
  if (typeof record.samples !== "number" || !Number.isFinite(record.samples) || record.samples < 0) {
    return createModel();
  }
  if (typeof record.drifts !== "number" || !Number.isFinite(record.drifts) || record.drifts < 0) {
    return createModel();
  }
  if (
    typeof record.recoveries !== "number" ||
    !Number.isFinite(record.recoveries) ||
    record.recoveries < 0
  ) {
    return createModel();
  }
  if (typeof record.probes !== "number" || !Number.isFinite(record.probes) || record.probes < 0) {
    return createModel();
  }
  return {
    weights: [...record.weights],
    prior: [...record.prior],
    samples: Math.floor(record.samples),
    drifts: Math.floor(record.drifts),
    recoveries: Math.floor(record.recoveries),
    probes: Math.floor(record.probes),
    layout: FEATURE_LAYOUT,
  };
}
