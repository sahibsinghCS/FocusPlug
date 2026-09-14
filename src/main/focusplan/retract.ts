import type { Decision } from "../../shared/types.ts";
import type { PlanRetraction } from "../../shared/correction/types.ts";
import { retractLastAwayDrift as retractPure } from "../../shared/plan/retract.ts";
import type { FocusPlanLedger, PlanRound } from "../../shared/plan/types.ts";
import { appendPlanRound, clonePlanRound } from "./ledger.ts";

/**
 * The main-side half of the Focus Plan retraction — the plumbing the pure rule
 * in `src/shared/plan/retract.ts` deliberately does not own.
 *
 * The rewrite has to land in TWO places or it does not stick:
 *
 *  1. the recorder's `carried` round — the segment the pause left behind. A
 *     resume under the same `roundKey` seeds the next segment's onsets from
 *     `carried.round.driftsSec`, so an un-retracted `carried` would resurrect
 *     the drift on the very next tick;
 *  2. the ledger entry with that `roundKey`, via `appendPlanRound`, which
 *     already replaces by key. `lifetimeRounds` is untouched: nothing was
 *     added and nothing was removed, one round changed.
 *
 * `docs/CORRECTION-LOOP.md § 5.3`.
 */

export interface PlanRetractionInput {
  /** `focusPlanEnabled`. */
  enabled: boolean;
  /** `FOCUSPLUG_NO_PLAN=1`. */
  pinned: boolean;
  /** The round the pause left behind, or null when there is none. */
  round: PlanRound | null;
  /** `OnsetState.last` when that segment closed. */
  lastDecision: Decision | null;
  ledger: FocusPlanLedger;
}

export interface PlanRetractionOutcome {
  retraction: PlanRetraction;
  /** The rewritten round, for `carried` and for the push. Null on a refusal. */
  round: PlanRound | null;
  /** The ledger to persist. Identical to the input's on a refusal. */
  ledger: FocusPlanLedger;
}

/**
 * Apply the rule, then rewrite the ledger row it belongs to.
 *
 * A round that has not reached the ledger yet — the write failed, or the pin
 * is on — is still rewritten in `carried`, so the resume cannot resurrect the
 * drift even when nothing was persisted. The ledger is left exactly as it was
 * in that case rather than gaining a row it never had.
 */
export function applyPlanRetraction(input: PlanRetractionInput): PlanRetractionOutcome {
  const out = retractPure({
    round: input.round,
    lastDecision: input.lastDecision,
    enabled: input.enabled,
    pinned: input.pinned,
  });
  if (out.round === null) {
    return { retraction: out.retraction, round: null, ledger: input.ledger };
  }
  const known = input.ledger.rounds.some((row) => row.roundKey === out.round?.roundKey);
  if (!known) {
    return { retraction: out.retraction, round: out.round, ledger: input.ledger };
  }
  return {
    retraction: out.retraction,
    round: out.round,
    ledger: appendPlanRound(input.ledger, clonePlanRound(out.round)).ledger,
  };
}
