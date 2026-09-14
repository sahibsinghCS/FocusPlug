import { appendRound, reviveLedger, selectWindow } from "../../shared/plan/ledger.ts";
import type { DayStamp } from "../../shared/plan/ledger.ts";
import type { FocusPlanLedger, PlanRound } from "../../shared/plan/types.ts";

/**
 * The main-side half of `<userData>/focus-plan.json`.
 *
 * Everything that can be pure IS pure and lives in `src/shared/plan/ledger.ts`
 * — `reviveLedger`, `normalizeRound`, `appendRound`, `selectWindow` — so the
 * browser demo measures with the same code the app does. What is left here is
 * only what a pure core cannot own:
 *
 *  - the LOCAL day stamp (the core never imports `Date`, which is what keeps
 *    it environment-agnostic; §5.3);
 *  - the pause/resume correction to `lifetimeRounds`, because "one round"
 *    versus "two segments of one round" is a fact about the session
 *    lifecycle, which is a main-process concept.
 */

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The `DayStamp` main passes: the student's own calendar day, because "three
 * drifts on three different days" has to mean three of THEIR evenings, not
 * three UTC dates that split one of them in half.
 */
export const localDayStamp: DayStamp = (ms: number) => {
  const date = new Date(ms);
  return {
    day: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
    hour: date.getHours(),
  };
};

export function emptyPlanLedger(): FocusPlanLedger {
  return reviveLedger(null);
}

/** Wrong version, wrong shape, or unreadable ⇒ an empty ledger, never a throw. */
export function revivePlanLedger(raw: unknown): FocusPlanLedger {
  return reviveLedger(raw);
}

export function clonePlanRound(round: PlanRound): PlanRound {
  const clone: PlanRound = { ...round, driftsSec: [...round.driftsSec] };
  if (round.retractedDriftsSec !== undefined) {
    clone.retractedDriftsSec = [...round.retractedDriftsSec];
  }
  return clone;
}

/**
 * The window `PLAN_GET_STATE` ships, oldest first — WITH the ineligible rows.
 *
 * That is H9: a student who reads "5 rounds" in their history and "3 rounds"
 * in the reasoning has to be able to find the other two, so the rows the
 * estimator throws away still have to reach the screen. The pure core's own
 * `selectWindow`, called without `includeDiscarded`, is what drops them again
 * on the way into the estimator.
 */
export function planStateWindow(rounds: readonly PlanRound[], nowMs: number): PlanRound[] {
  return selectWindow(rounds, { nowMs, includeDiscarded: true }).map(clonePlanRound);
}

/**
 * Append, or replace the record a pause left behind.
 *
 * A pause emits `stopSession()` and the resume emits `startSession()` with the
 * SAME `roundKey` (§3.4), so consecutive segments are ONE `PlanRound`. The
 * pure `appendRound` already replaces by key; `lifetimeRounds` counts rounds
 * rather than segments, so the one thing left to do here is not to bump it
 * when a round the ledger already holds comes back longer.
 */
export function appendPlanRound(
  ledger: FocusPlanLedger,
  round: PlanRound,
): { ledger: FocusPlanLedger; merged: boolean } {
  const merged = ledger.rounds.some((existing) => existing.roundKey === round.roundKey);
  const next = appendRound(ledger, clonePlanRound(round));
  return {
    ledger: merged ? { ...next, lifetimeRounds: ledger.lifetimeRounds } : next,
    merged,
  };
}
