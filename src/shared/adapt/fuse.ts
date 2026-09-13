/**
 * Turning a prediction into the one number the policy actually uses.
 *
 * The fuse is a bet: "you have N seconds to fix this yourself." The model
 * knows P(recover | this moment, a fuse of N), so the choice is a sweep — the
 * shortest fuse that still gives you a fair chance. Someone who reliably comes
 * back in six seconds gets eight. Someone who never comes back gets the floor,
 * because waiting is just dead session time.
 *
 * Until the model has earned confidence the answer stays at the number the
 * user set in Settings, so a cold install behaves exactly as it does today.
 */

import { extractFeatures, withFuse, type DriftMoment } from "./features";
import { confidence, doneExploring, predictRecovery, type AdaptiveModel } from "./model";

export const MIN_FUSE_SEC = 3;
export const MAX_FUSE_SEC = 30;
/**
 * The chance of self-correcting we call "a fair shot". This is the cost
 * function: picking the shortest fuse that clears 0.65 would, by construction,
 * kill a third of the people who were on their way back.
 */
export const RECOVERY_TARGET = 0.85;

/**
 * The fuse lengths considered. Training and choosing sweep the same grid, so
 * the model is never asked about a fuse it was never taught.
 */
export const FUSE_CANDIDATES: readonly number[] = Array.from(
  { length: (MAX_FUSE_SEC - MIN_FUSE_SEC) / 1 + 1 },
  (_unused, index) => MIN_FUSE_SEC + index,
);

/**
 * How often to hand out a generous fuse on purpose while still probing. Held
 * constant during the learning phase rather than decayed with experience —
 * experience made of nothing but kills is exactly the experience that needs
 * probing, so decaying on drift count would starve the model fastest in the
 * case where it is already starving.
 */
export const EXPLORE_RATE = 0.45;
/**
 * Probing never stops entirely. A fuse at the floor kills everyone, and a
 * model trained only on kills concludes everyone deserves the floor — an
 * absorbing state one unlucky night can fall into and never climb out of.
 * A few percent of probes forever is the cost of staying adaptive.
 */
export const EXPLORE_FLOOR = 0.05;

export interface FuseChoice {
  seconds: number;
  /** P(recover) at the chosen fuse. */
  recoverProbability: number;
  /** How far the model was trusted, 0..1. */
  trust: number;
  /** Shortest fuse that met the target, before blending. `null` if none did. */
  modelSeconds: number | null;
  /** True when this fuse was deliberately generous, to learn from. */
  exploring: boolean;
  /** One line for the log and the panel. */
  reason: string;
}

function clampFuse(seconds: number): number {
  if (!Number.isFinite(seconds)) {
    return MIN_FUSE_SEC;
  }
  return Math.min(MAX_FUSE_SEC, Math.max(MIN_FUSE_SEC, Math.round(seconds)));
}

/**
 * Sweep candidate fuses and take the shortest that clears the target. The
 * crossing point is itself the personal recovery estimate — there is no second
 * model for "how long do they usually take".
 */
export function chooseFuse(
  model: AdaptiveModel,
  moment: DriftMoment,
  baseSec: number,
  options: { random?: () => number } = {},
): FuseChoice {
  const base = clampFuse(Number.isFinite(baseSec) ? baseSec : MIN_FUSE_SEC);
  const trust = confidence(model);
  const random = options.random ?? Math.random;

  let modelSeconds: number | null = null;
  let bestSeconds = MIN_FUSE_SEC;
  let bestProbability = 0;
  for (const candidate of FUSE_CANDIDATES) {
    const probability = predictRecovery(model, extractFeatures(withFuse(moment, candidate)));
    if (probability > bestProbability) {
      bestProbability = probability;
      bestSeconds = candidate;
    }
    if (modelSeconds === null && probability >= RECOVERY_TARGET) {
      modelSeconds = candidate;
    }
  }

  // No fuse in range gives them a fair shot — they are not coming back, so
  // spend as little of the session as possible finding that out.
  /*
   * `null` means no fuse clears the bar. That is not the same as "they never
   * come back" — it is usually "not confidently enough yet", so falling to the
   * floor on it is how the policy talks itself into killing everybody. Take
   * the best available chance instead, and only floor when even the best fuse
   * is a coin flip they lose.
   */
  const fallback = bestProbability > 0.5 ? bestSeconds : MIN_FUSE_SEC;
  const target = modelSeconds ?? (doneExploring(model) ? fallback : base);
  const greedy = clampFuse(base + (target - base) * trust);

  /*
   * A short fuse teaches you almost nothing. If we kill at three seconds we
   * learn only that three was not enough — never that eight would have been.
   * Left alone the policy ratchets itself down to the floor and kills everyone,
   * including the people who would have come back in four seconds. So while
   * the model is still learning it sometimes hands out a deliberately generous
   * fuse, purely to find out what this person actually does. The rate decays
   * to zero as confidence is earned.
   */
  const rate = doneExploring(model) ? EXPLORE_FLOOR : EXPLORE_RATE;
  const exploring = random() < rate;
  const seconds = exploring ? MAX_FUSE_SEC : greedy;

  const recoverProbability = predictRecovery(
    model,
    extractFeatures(withFuse(moment, seconds)),
  );

  return {
    seconds,
    recoverProbability,
    trust,
    modelSeconds,
    exploring,
    reason: exploring
      ? `${seconds}s — giving you the benefit of the doubt while it learns you`
      : reasonFor(model.drifts, trust, modelSeconds, seconds, base),
  };
}

function reasonFor(
  samples: number,
  trust: number,
  modelSeconds: number | null,
  seconds: number,
  base: number,
): string {
  if (samples === 0) {
    return `Using your ${base}s setting — no drifts learned from yet`;
  }
  if (trust < 1) {
    const learned = modelSeconds === null ? "you rarely come back" : `you come back by ${modelSeconds}s`;
    return `${seconds}s — still learning (${samples} drifts), leaning on your ${base}s while ${learned}`;
  }
  if (modelSeconds === null) {
    return `${seconds}s — you almost never fix this yourself, so it does not wait`;
  }
  return `${seconds}s — you usually come back by ${modelSeconds}s`;
}
