/**
 * The cold-start ladder: six rungs, evaluated top-down, every one of which has
 * copy. There is no empty state anywhere in this feature.
 *
 * The one ordering rule worth stating out loud: the provisional read off a
 * live forecast wobble is STRUCTURALLY OUTRANKED by the first completed round,
 * and retired entirely by the first real drift. A wobble says "at minute 11 the
 * forecast thought you were about to drift, and you didn't". Given three clean
 * 25-minute rounds that is evidence of nothing much, and recommending 11 to
 * someone who demonstrably holds 25 would be absurd. Given a live round at
 * minute 12 with no history at all, it is the only signal there is.
 */

import {
  PLAN_CONFIDENCE_ROUNDS,
  PLAN_DEFAULT_FOCUS_MIN,
  PLAN_WINDOW_DAYS,
} from "./constants";
import { eligibleRounds, samplesFrom } from "./ledger";
import { kaplanMeier } from "./survival";
import type { LivePlanRound, PlanEstimate, PlanRefusal, PlanRung, PlanRound } from "./types";

export interface EstimateInput {
  /** The estimator window, oldest first. Discarded rows may be present; they
   *  are filtered here so callers cannot forget to. */
  rounds: readonly PlanRound[];
  /** The round in progress, built renderer-side. Null before the switch. */
  live?: LivePlanRound | null;
  /** settings.forecastEnabled — with the forecast off there is no wobble rung
   *  and the copy says so. It never fabricates a risk curve. */
  forecastEnabled: boolean;
}

function methodFor(
  rung: PlanRung,
  counts: { rounds: number; events: number; censored: number; wobbleMin: number | null },
): string {
  const { rounds, events, censored } = counts;
  const roundWord = rounds === 1 ? "round" : "rounds";
  const driftWord = events === 1 ? "drift" : "drifts";
  const cleanCount = censored === 1 ? "1 clean" : `${censored} clean`;
  switch (rung) {
    case "no-history":
      return `No measurement yet. The number is the pomodoro default of ${PLAN_DEFAULT_FOCUS_MIN} minutes, not a reading of you.`;
    case "wobble-only":
      return `Provisional: one Focus Forecast warning at minute ${Math.floor(counts.wobbleMin ?? 0)} of the round in progress. A warning is not a drift, and the first completed round replaces it.`;
    case "censored-only":
      return `Kaplan-Meier over ${rounds} ${roundWord} in the last ${PLAN_WINDOW_DAYS} days, all of them clean. The median is unreached, so the number is a floor rather than an estimate.`;
    default:
      return `Kaplan-Meier median of ${rounds} ${roundWord} (${events} ${driftWord}, ${cleanCount}) over the last ${PLAN_WINDOW_DAYS} days.`;
  }
}

export function planEstimate(input: EstimateInput): PlanEstimate {
  const scope = eligibleRounds(input.rounds);
  const samples = samplesFrom(scope);
  const curve = kaplanMeier(samples);
  const eventSamples = samples.filter((s) => !s.censored);
  const completedRounds = scope.filter((r) => r.status === "completed").length;
  const live = input.live ?? null;

  /* The wobble is only reachable with the forecast on, with nothing measured
   * yet, and with no completed round to outrank it. */
  const wobbleMin =
    input.forecastEnabled &&
    live !== null &&
    live.forecastOn &&
    live.firstWobbleSec !== null &&
    eventSamples.length === 0 &&
    completedRounds === 0
      ? live.firstWobbleSec / 60
      : null;

  const rung: PlanRung =
    wobbleMin !== null
      ? "wobble-only"
      : scope.length === 0
        ? "no-history"
        : eventSamples.length === 0
          ? "censored-only"
          : eventSamples.length === 1
            ? "single"
            : eventSamples.length === 2
              ? "pair"
              : "measured";

  const provisional = rung === "wobble-only";
  const medianMin = provisional ? Math.floor(wobbleMin ?? 0) : curve.medianMin;

  /* On a fresh install the live round is still an honest floor: you have held
   * this long tonight, whatever the ledger does not yet know. */
  const lowerBoundMin =
    curve.lowerBoundMin ?? (live !== null && live.servedSec > 0 ? live.servedSec / 60 : null);

  const refusal: PlanRefusal | null =
    rung === "no-history"
      ? input.forecastEnabled
        ? "no-rounds"
        : "forecast-off"
      : rung === "wobble-only"
        ? null
        : eventSamples.length === 0
          ? "all-censored"
          : curve.medianMin === null
            ? "all-censored"
            : null;

  const chronological = [...eventSamples].sort((a, b) => a.at - b.at);

  return {
    rung,
    medianMin,
    lowerBoundMin,
    provisional,
    trust: Math.min(1, scope.length / PLAN_CONFIDENCE_ROUNDS),
    rounds: scope.length,
    completedRounds,
    events: eventSamples.length,
    censored: samples.length - eventSamples.length,
    days: new Set(eventSamples.map((s) => s.day)).size,
    recentHoldsMin: chronological.slice(-5).map((s) => s.minutes),
    bestHeldMin: curve.lowerBoundMin,
    refusal,
    method: methodFor(rung, {
      rounds: scope.length,
      events: eventSamples.length,
      censored: samples.length - eventSamples.length,
      wobbleMin,
    }),
  };
}
