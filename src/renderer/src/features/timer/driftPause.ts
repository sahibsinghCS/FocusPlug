/**
 * The gate between a nudge and a stopped study clock.
 *
 * Main owns the hard part — sustained readings, per-head confidence floors,
 * `uncertain` never counting, the two settings — and says so by putting
 * `pause: true` on the `NudgeEvent` it already pushes. This module is the
 * renderer's half: whether *this* clock, right now, is one a pause can apply
 * to, and the bookkeeping that makes one event stop it at most once.
 *
 * Pure on purpose. The hook that uses it holds React state; everything worth
 * arguing about lives here, where a test can drive it.
 */

import type { NudgeEvent, PauseKind } from "@shared/nudge";
import { isPauseKind } from "@shared/nudge";
import type { RunPosition, RunStatus } from "./runtime";

export interface DriftPauseInput {
  /** The latest nudge from main, or null when none is up. */
  nudge: NudgeEvent | null;
  /** `ts` of the last pause-carrying nudge already consumed. Null before the first. */
  handledTs: number | null;
  /** Where the plan clock is. Only a running clock can be stopped. */
  status: RunStatus;
  /** Which block is running. A break is already not study time. */
  position: RunPosition | null;
}

export interface DriftPauseStep {
  /** The kind to stop the clock for, or null to leave it alone. */
  pause: PauseKind | null;
  /**
   * The new `handledTs`. A pause-carrying event is consumed on arrival whether
   * or not it stopped the clock — otherwise an event that arrived while the
   * clock was already stopped would be sitting there waiting to stop it again
   * the moment the student restarted it.
   */
  handledTs: number | null;
}

/**
 * Decide what one observation of `nudge` does to the clock.
 *
 * The refusals each matter:
 * - no `pause` flag ⇒ an ordinary pull-back, which never touches the clock and
 *   is not consumed either;
 * - already consumed ⇒ a re-render, or the overlay's own dismiss timer, must
 *   not stop the clock a second time;
 * - a kind outside `PauseKind` ⇒ `unfocused` and `blocked` never stop it, and
 *   an `uncertain` reading never reaches here at all because main drops it;
 * - a clock that is not running a focus block ⇒ there is nothing to stop.
 */
export function driftPauseStep(input: DriftPauseInput): DriftPauseStep {
  const nudge = input.nudge;
  const handledTs = input.handledTs;
  if (nudge === null || nudge.pause !== true) {
    return { pause: null, handledTs };
  }
  if (handledTs !== null && nudge.ts <= handledTs) {
    return { pause: null, handledTs };
  }
  const consumed = nudge.ts;
  if (!isPauseKind(nudge.kind) || input.status !== "running") {
    return { pause: null, handledTs: consumed };
  }
  if (input.position !== null && input.position.segment.kind !== "focus") {
    return { pause: null, handledTs: consumed };
  }
  return { pause: nudge.kind, handledTs: consumed };
}
