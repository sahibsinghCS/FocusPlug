/**
 * The one definition of drift in this product, in streaming form.
 *
 * `src/shared/forecast/labels.ts` already owns what a drift *is*:
 * `isDriftedDecision`, `driftTypeFor` and the `DRIFT_DEBOUNCE_SEC` merge rule.
 * Focus Plan does not get a second one. The recorder sees a stream of policy
 * `status` events rather than an array, so this module is a reducer over the
 * same primitives — and `drift.test.ts` pins it to `findDriftOnsets` by
 * folding it over hand-written frame tables. If the forecast ever changes what
 * a drift is, that test fails and Focus Plan follows it.
 *
 * Round *eligibility* is separate, and lives here too. "Started drifted" and
 * "too short to count" are statements about whether a round measures
 * attention at all; neither touches the drift definition.
 */

import type { Decision } from "../types";
import {
  DRIFT_DEBOUNCE_SEC,
  driftTypeFor,
  isDriftedDecision,
  type DecisionFrame,
} from "../forecast/labels";
import type { DriftType } from "../forecast/types";
import {
  PLAN_COMPLETE_SLACK_SEC,
  PLAN_MAX_DRIFTS_PER_ROUND,
  PLAN_MIN_ROUND_SEC,
  PLAN_RUNAWAY_FACTOR,
  PLAN_STARTED_DRIFTED_SEC,
} from "./constants";
import type { OnsetState, PlanRound, PlanRoundStatus } from "./types";

export const INITIAL_ONSET_STATE: OnsetState = { last: null, onsetsSec: [], sawClean: false };

/** A decision that is neither drifted nor the pre-roll IDLE. */
function isCleanDecision(decision: Decision): boolean {
  return !isDriftedDecision(decision) && decision !== "IDLE";
}

/**
 * One step of `findDriftOnsets`. An onset is the first frame entering
 * {DISTRACTED, AWAY} after a frame outside that set; the very first frame can
 * never be an onset (there is no previous frame to leave), and onsets within
 * `DRIFT_DEBOUNCE_SEC` of the previous KEPT onset are merged into it.
 *
 * Deliberately uncapped: it must stay byte-equivalent to `findDriftOnsets`.
 * The `PLAN_MAX_DRIFTS_PER_ROUND` cap is applied by `cappedDrifts` when a
 * `PlanRound` is built, so the equivalence test can be exact.
 */
export function stepOnset(state: OnsetState, decision: Decision, tSec: number): OnsetState {
  const prev = state.last;
  const sawClean = state.sawClean || isCleanDecision(decision);

  if (prev === null || !isDriftedDecision(decision) || isDriftedDecision(prev)) {
    return { last: decision, onsetsSec: state.onsetsSec, sawClean };
  }
  if (driftTypeFor(decision) === null) {
    return { last: decision, onsetsSec: state.onsetsSec, sawClean };
  }

  const lastOnset = state.onsetsSec[state.onsetsSec.length - 1];
  if (lastOnset !== undefined && tSec - lastOnset < DRIFT_DEBOUNCE_SEC) {
    return { last: decision, onsetsSec: state.onsetsSec, sawClean };
  }
  return { last: decision, onsetsSec: [...state.onsetsSec, tSec], sawClean };
}

/** Fold `stepOnset` over a frame table. The equivalence test's left-hand side. */
export function foldOnsets(frames: readonly DecisionFrame[]): OnsetState {
  let state = INITIAL_ONSET_STATE;
  for (const frame of frames) {
    state = stepOnset(state, frame.decision, frame.t);
  }
  return state;
}

/**
 * Did THIS step produce the round's first onset, and did that onset arrive
 * before any clean decision was seen?
 *
 * Called with the state either side of a `stepOnset`, which is how the
 * recorder answers "started drifted" without the frozen `OnsetState` having to
 * carry a fourth field: `before.sawClean` is, by construction, whether a clean
 * decision was seen STRICTLY BEFORE this onset.
 */
export function firstOnsetStartedDrifted(before: OnsetState, after: OnsetState): boolean {
  if (before.onsetsSec.length !== 0 || after.onsetsSec.length !== 1) {
    return false;
  }
  const first = after.onsetsSec[0];
  return first !== undefined && first < PLAN_STARTED_DRIFTED_SEC && !before.sawClean;
}

/** Whole-stream form of the same rule, for tests and `ledgerFromSessionLog`. */
export function detectStartedDrifted(frames: readonly DecisionFrame[]): boolean {
  let state = INITIAL_ONSET_STATE;
  for (const frame of frames) {
    const next = stepOnset(state, frame.decision, frame.t);
    if (firstOnsetStartedDrifted(state, next)) {
      return true;
    }
    state = next;
  }
  return false;
}

/** Every kept onset, capped for the ledger. The cap is storage, not policy. */
export function cappedDrifts(onsetsSec: readonly number[]): number[] {
  return onsetsSec.slice(0, PLAN_MAX_DRIFTS_PER_ROUND);
}

/** The flavour of the round's first drift, from the decision that opened it. */
export function driftTypeOf(decision: Decision): DriftType | null {
  return driftTypeFor(decision);
}

export interface RoundOutcomeInput {
  servedSec: number;
  plannedFocusSec: number;
  firstDriftSec: number | null;
  /** At least one policy `status` event was observed. A round that produced
   *  none saw nothing at all — a crash, or a dead monitor. */
  sawStatus: boolean;
}

/**
 * §3.3, exactly. `completed` iff the round served its planned length (less
 * `PLAN_COMPLETE_SLACK_SEC`), else `aborted`, with two `discarded` overrides.
 *
 * The asymmetry in the short-round rule is deliberate: a short round WITH a
 * drift is real, informative data and is kept as an event; a short round
 * without one is noise. Discarding all short rounds would silently delete the
 * worst nights and flatter the trend.
 */
export function classifyRound(input: RoundOutcomeInput): PlanRoundStatus {
  const { servedSec, plannedFocusSec, firstDriftSec, sawStatus } = input;
  if (!sawStatus) {
    return "discarded";
  }
  if (!Number.isFinite(servedSec) || servedSec < 0) {
    return "discarded";
  }
  if (plannedFocusSec > 0 && servedSec > PLAN_RUNAWAY_FACTOR * plannedFocusSec) {
    return "discarded";
  }
  const completed = servedSec >= plannedFocusSec - PLAN_COMPLETE_SLACK_SEC;
  if (!completed && firstDriftSec === null && servedSec < PLAN_MIN_ROUND_SEC) {
    return "discarded";
  }
  return completed ? "completed" : "aborted";
}

/** A round the estimator is allowed to see. */
export function isEligibleRound(round: PlanRound): boolean {
  return round.status !== "discarded" && !round.startedDrifted;
}

/**
 * Why a round does not count, in the student's words. Null exactly when it
 * does count — a reader who sees 5 rounds in their history and 3 in the
 * reasoning can always find the other two (H9).
 */
export function exclusionReason(round: PlanRound): string | null {
  if (round.startedDrifted) {
    return "started with a blocked app already open";
  }
  if (round.status === "discarded") {
    if (round.firstDriftSec === null && round.servedSec < PLAN_MIN_ROUND_SEC) {
      return "too short to count";
    }
    return "the clock jumped, so the timing is not trustworthy";
  }
  return null;
}

/** MUFD when the round drifted, served minutes when it ran clean. */
export function holdMinutes(round: PlanRound): number {
  const seconds = round.firstDriftSec ?? round.servedSec;
  return seconds / 60;
}
