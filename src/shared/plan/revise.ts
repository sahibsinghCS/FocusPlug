/**
 * The mid-session revision — one extra sentence on a nudge main already fired.
 *
 * It is not a channel, a timer, a toast, a sound, a countdown or a second
 * dialog, and it adds NO control to the nudge overlay. It returns a string.
 *
 * `countdownActive` is the most important line in this file. The `blocked`
 * nudge is emitted by the controller AT `start_countdown` — i.e. while the
 * fuse is burning. Anything offering a break at that instant is a one-tap
 * escape hatch from the product's only enforcement, and the product's identity
 * is that the kill is the one thing it does not negotiate. A nudge during a
 * burning fuse is about the fuse, so the plan says nothing.
 *
 * Pure, and deliberately importing nothing outside `src/shared/plan`.
 */

import {
  PLAN_REVISE_CALM_FRACTION,
  PLAN_REVISE_EARLY_SEC,
  PLAN_REVISE_EXTEND_SEC,
  PLAN_REVISE_LATE_SEC,
  PLAN_REVISE_MIN_DELTA_SEC,
  PLAN_REVISE_MIN_ELAPSED_FRACTION,
} from "./constants";
import { planRevisionCopy } from "./copy";
import type { PlanRevision, PlanReviseInput } from "./types";

export function reviseBreak(input: PlanReviseInput): PlanRevision | null {
  /* Never invent a comparison. With no estimate there is nothing to be early
   * or late against. */
  if (input.estimateMin === null || !Number.isFinite(input.estimateMin)) {
    return null;
  }
  /* The hard guard. */
  if (input.countdownActive) {
    return null;
  }
  if (!Number.isFinite(input.elapsedSec) || !Number.isFinite(input.remainingSec)) {
    return null;
  }

  const estimateSec = input.estimateMin * 60;

  /* EARLIER — you are hitting your limit sooner than the plan assumed.
   * `wobbled` requires a real forecast_nudge or forecast_prearm this block; a
   * bare risk reading is not enough. */
  if (
    input.wobbled &&
    input.elapsedSec >= PLAN_REVISE_MIN_ELAPSED_FRACTION * estimateSec &&
    input.remainingSec >= PLAN_REVISE_MIN_DELTA_SEC
  ) {
    /* Never "now": a break offered at the exact instant of a drift is
     * indistinguishable from an escape hatch. Three minutes is a break you
     * walk to, not a fuse you dodge. */
    const suggestedBreakInSec = Math.min(input.remainingSec, PLAN_REVISE_EARLY_SEC);
    return {
      kind: "earlier",
      plannedBreakInSec: input.remainingSec,
      suggestedBreakInSec,
      copy: planRevisionCopy({
        kind: "earlier",
        plannedBreakInSec: input.remainingSec,
        suggestedBreakInSec,
        pastEstimateMin: 0,
      }),
    };
  }

  /* LATER — past your usual limit and still calm, with the break almost here. */
  if (
    input.risk !== null &&
    Number.isFinite(input.risk) &&
    input.risk < PLAN_REVISE_CALM_FRACTION * input.nudgeRisk &&
    input.elapsedSec >= estimateSec + PLAN_REVISE_LATE_SEC &&
    input.remainingSec <= PLAN_REVISE_MIN_DELTA_SEC
  ) {
    const suggestedBreakInSec = input.remainingSec + PLAN_REVISE_EXTEND_SEC;
    return {
      kind: "later",
      plannedBreakInSec: input.remainingSec,
      suggestedBreakInSec,
      copy: planRevisionCopy({
        kind: "later",
        plannedBreakInSec: input.remainingSec,
        suggestedBreakInSec,
        pastEstimateMin: (input.elapsedSec - estimateSec) / 60,
      }),
    };
  }

  return null;
}
