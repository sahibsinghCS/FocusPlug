/**
 * The progression rule: a rule, not a model, so it can be explained in one
 * line and argued with in one sentence.
 *
 * Escalation is symmetric and says so. Two rounds that drift before 80% of
 * target drop the target three minutes, and the copy promises the way back —
 * a plan that only ratchets upward is a plan students quit. No streak counter
 * is displayed and no round is ever labelled a failure.
 *
 * Rounds are never recommended. The plan touches focus and break length only;
 * how many rounds you have time for is a fact about your afternoon, not about
 * your attention.
 */

import { planCardCopy } from "./copy";
import {
  PLAN_BACKOFF_MIN,
  PLAN_BREAK_RATIO,
  PLAN_CENSORED_STRETCH_MIN_ROUNDS,
  PLAN_COMPLETE_SLACK_SEC,
  PLAN_DEFAULT_FOCUS_MIN,
  PLAN_EARLY_DRIFT_FRACTION,
  PLAN_MAX_BREAK_MIN,
  PLAN_MAX_FOCUS_MIN,
  PLAN_MAX_REACH_MIN,
  PLAN_MIN_BREAK_MIN,
  PLAN_MIN_FOCUS_MIN,
  PLAN_STRETCH_MIN,
  PLAN_STRETCH_STREAK,
} from "./constants";
import { planEstimate } from "./estimate";
import { eligibleRounds, evidenceFrom, samplesFrom } from "./ledger";
import { planTrend } from "./trend";
import type {
  LivePlanRound,
  PlanEstimate,
  PlanRecommendation,
  PlanRound,
  PlanStep,
} from "./types";

export interface RecommendInput {
  /** The window, oldest first. Discarded rows may be present — they are shown
   *  in the evidence and filtered out of the estimator. */
  rounds: readonly PlanRound[];
  live?: LivePlanRound | null;
  forecastEnabled: boolean;
  /** settings.focusPlanStretchEnabled. Off keeps the measurement and the
   *  debrief, and plans to the estimate with no step. */
  stretchEnabled: boolean;
}

/** Ran its planned length and never drifted. */
export function heldToTarget(round: PlanRound): boolean {
  return (
    round.firstDriftSec === null &&
    round.servedSec >= round.plannedFocusSec - PLAN_COMPLETE_SLACK_SEC
  );
}

/** Drifted well short of what it planned — 80% of target, by the constant. */
export function driftedEarly(round: PlanRound): boolean {
  return (
    round.firstDriftSec !== null &&
    round.firstDriftSec < PLAN_EARLY_DRIFT_FRACTION * round.plannedFocusSec
  );
}

/**
 * The ratchet. Two in a row either way, and nothing at all while the estimate
 * is provisional or the median is unreached — a step off a warning would be a
 * step off the forecast's operating point rather than off the student.
 */
export function stepFor(
  estimate: PlanEstimate,
  rounds: readonly PlanRound[],
  stretchEnabled: boolean,
): PlanStep {
  if (!stretchEnabled) {
    return "hold";
  }
  if (estimate.provisional || estimate.medianMin === null) {
    return "hold";
  }
  const newest = eligibleRounds(rounds).slice(-PLAN_STRETCH_STREAK);
  if (newest.length < PLAN_STRETCH_STREAK) {
    return "hold";
  }
  if (newest.every(heldToTarget)) {
    return "stretch";
  }
  if (newest.every(driftedEarly)) {
    return "ease";
  }
  return "hold";
}

/** round(focusMin / 5), clamped — the rule that reproduces all three shipped
 *  SHAPES exactly (Classic 25/5, Deep work 50/10, Sprint 15/3). */
export function breakFor(focusMin: number): number {
  return Math.min(
    PLAN_MAX_BREAK_MIN,
    Math.max(PLAN_MIN_BREAK_MIN, Math.round(focusMin / PLAN_BREAK_RATIO)),
  );
}

/** The base is the measurement, unmodified. Only the step moves it. */
export function baseFor(estimate: PlanEstimate, stretchEnabled: boolean): number {
  if (estimate.rung === "no-history") {
    return PLAN_DEFAULT_FOCUS_MIN;
  }
  if (estimate.medianMin !== null) {
    return estimate.medianMin;
  }
  if (estimate.lowerBoundMin === null) {
    return PLAN_DEFAULT_FOCUS_MIN;
  }
  /* Never drifted: the limit is past the floor and we do not know where.
   * Sitting inside it forever would guarantee we never find out, so once
   * there are two completed rounds to stand on, go looking. */
  const stretchLooking =
    estimate.rung === "censored-only" &&
    stretchEnabled &&
    estimate.completedRounds >= PLAN_CENSORED_STRETCH_MIN_ROUNDS;
  return stretchLooking ? estimate.lowerBoundMin + PLAN_STRETCH_MIN : estimate.lowerBoundMin;
}

export function recommend(input: RecommendInput): PlanRecommendation {
  const estimate = planEstimate({
    rounds: input.rounds,
    live: input.live ?? null,
    forecastEnabled: input.forecastEnabled,
  });
  /* Provisional readings never enter the trend window — a trend across
   * warnings would be a trend across the forecast's own operating point. */
  const trend = planTrend(samplesFrom(input.rounds));

  const baseMin = baseFor(estimate, input.stretchEnabled);
  const step = stepFor(estimate, input.rounds, input.stretchEnabled);
  const delta = step === "stretch" ? PLAN_STRETCH_MIN : step === "ease" ? -PLAN_BACKOFF_MIN : 0;

  let focusMin = Math.min(
    PLAN_MAX_FOCUS_MIN,
    Math.max(PLAN_MIN_FOCUS_MIN, Math.round(baseMin + delta)),
  );
  /* The plan can climb but it cannot leap: someone whose best is 20 minutes is
   * never handed 45. */
  if (estimate.bestHeldMin !== null) {
    focusMin = Math.max(
      PLAN_MIN_FOCUS_MIN,
      Math.min(focusMin, Math.round(estimate.bestHeldMin) + PLAN_MAX_REACH_MIN),
    );
  }
  const breakMin = breakFor(focusMin);

  const shape = {
    focusMin,
    breakMin,
    step,
    baseMin,
    estimate,
    trend,
    cold: estimate.rung === "no-history",
  };

  return {
    ...shape,
    evidence: evidenceFrom(input.rounds),
    copy: planCardCopy({ ...shape, forecastEnabled: input.forecastEnabled }),
  };
}
