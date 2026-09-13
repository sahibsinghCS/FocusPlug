/**
 * Kaplan-Meier, because the data is censored.
 *
 * A clean round is NOT a hold of exactly its length — it is a right-censored
 * observation whose true value lies somewhere past its length. Treating those
 * two the same is the single easiest way to lie with this metric, and it
 * biases downward EXACTLY on the good rounds, which would make the headline
 * number worse the better the student gets.
 *
 * KM is the non-parametric, assumption-free answer at n between 1 and 20, and
 * — critically — it refuses on its own: when the survival curve never reaches
 * a half the median is undefined, and undefined is exactly what we want to
 * render. `medianMin === null` is not a failure. It means the student drifts
 * in fewer than half their rounds, and the honest advice is a LONGER block.
 *
 *   S(t) = Π over event times tᵢ <= t of (1 − dᵢ / nᵢ)
 *
 * Ties follow the standard convention: events at time t are processed before
 * censorings at t, so a clean round that ended at exactly the minute someone
 * drifted does not leave the risk set early. That falls out of counting the
 * risk set as `minutes >= t`.
 */

import type { HoldSample, SurvivalCurve, SurvivalStep } from "./types";

/** Guard the arithmetic against a corrupt ledger row rather than trusting it. */
function usable(sample: HoldSample): boolean {
  return Number.isFinite(sample.minutes) && sample.minutes >= 0;
}

export function kaplanMeier(samples: readonly HoldSample[]): SurvivalCurve {
  const clean = samples.filter(usable);
  if (clean.length === 0) {
    return { steps: [], medianMin: null, lowerBoundMin: null, events: 0, censored: 0 };
  }

  const eventTimes = [...new Set(clean.filter((s) => !s.censored).map((s) => s.minutes))].sort(
    (a, b) => a - b,
  );

  const steps: SurvivalStep[] = [];
  let survival = 1;
  for (const t of eventTimes) {
    // Risk set at t: everyone whose observation reaches t, censorings at t
    // included — that IS the events-before-censorings tie rule.
    const atRisk = clean.filter((s) => s.minutes >= t).length;
    const events = clean.filter((s) => !s.censored && s.minutes === t).length;
    if (atRisk === 0) {
      continue;
    }
    survival *= 1 - events / atRisk;
    steps.push({ minutes: t, events, atRisk, survival });
  }

  const crossing = steps.find((step) => step.survival <= 0.5);
  const lowerBoundMin = clean.reduce((best, s) => Math.max(best, s.minutes), 0);

  return {
    steps,
    medianMin: crossing === undefined ? null : crossing.minutes,
    lowerBoundMin,
    events: clean.filter((s) => !s.censored).length,
    censored: clean.filter((s) => s.censored).length,
  };
}

/** Survival at an arbitrary t — the step function, read between the steps. */
export function survivalAt(curve: SurvivalCurve, minutes: number): number {
  let value = 1;
  for (const step of curve.steps) {
    if (step.minutes > minutes) {
      break;
    }
    value = step.survival;
  }
  return value;
}
