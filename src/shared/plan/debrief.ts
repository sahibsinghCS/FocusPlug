/**
 * The post-round debrief: where risk peaked, the drift rhythm, what it cost,
 * the number, and what to try next. One component, three existing homes, no
 * new route and no modal — the break is exactly when you want to know how the
 * round went.
 *
 * `theNumber` is non-nullable by contract (H11). There is no debrief without
 * an honest statement of what was and was not measured, including the two
 * cases where the honest statement is "this one does not count".
 */

import { planDebriefCopy } from "./copy";
import { holdMinutes, isEligibleRound } from "./drift";
import { eligibleRounds, samplesFrom } from "./ledger";
import { recommend } from "./progression";
import { median } from "./trend";
import type { LivePlanRound, PlanDebrief, PlanRound } from "./types";

export interface DebriefInput {
  /** The round that just closed. */
  round: PlanRound;
  /** The estimator window WITH that round folded in, oldest first. */
  rounds: readonly PlanRound[];
  forecastEnabled: boolean;
  stretchEnabled: boolean;
  live?: LivePlanRound | null;
  /** Rounds this install has ever logged, from the ledger. */
  lifetimeRounds?: number;
  /** Optional feature phrase from the renderer's forecast copy. */
  signalPhrase?: string | null;
}

/** Median gap between consecutive onsets. Null with fewer than two. */
export function rhythmMinutes(driftsSec: readonly number[]): number | null {
  if (driftsSec.length < 2) {
    return null;
  }
  const gaps: number[] = [];
  for (let i = 1; i < driftsSec.length; i += 1) {
    const prev = driftsSec[i - 1];
    const cur = driftsSec[i];
    if (prev === undefined || cur === undefined) {
      continue;
    }
    gaps.push((cur - prev) / 60);
  }
  return median(gaps);
}

export function debriefFor(input: DebriefInput): PlanDebrief {
  const { round } = input;
  const counted = isEligibleRound(round);
  const censored = round.firstDriftSec === null;

  const next = recommend({
    rounds: input.rounds,
    live: input.live ?? null,
    forecastEnabled: input.forecastEnabled,
    stretchEnabled: input.stretchEnabled,
  });

  const series = samplesFrom(eligibleRounds(input.rounds))
    .sort((a, b) => a.at - b.at)
    .map((sample) => ({ at: sample.at, minutes: sample.minutes, censored: sample.censored }));

  const heldMin = censored ? null : holdMinutes(round);
  const rhythmMin = rhythmMinutes(round.driftsSec);
  const notCounted = !counted;
  const firstEver = (input.lifetimeRounds ?? input.rounds.length) <= 1;

  return {
    round,
    next,
    heldMin,
    censored,
    rhythmMin,
    notCounted,
    series,
    copy: planDebriefCopy({
      round,
      heldMin,
      censored,
      rhythmMin,
      notCounted,
      next: {
        focusMin: next.focusMin,
        breakMin: next.breakMin,
        step: next.step,
        estimate: next.estimate,
      },
      firstEver,
      forecastEnabled: input.forecastEnabled,
      signalPhrase: input.signalPhrase ?? null,
    }),
  };
}
