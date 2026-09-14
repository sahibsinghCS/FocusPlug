/**
 * Retracting a drift the student says never happened.
 *
 * The app stopped the clock on an `away` reading, the student answered *I was
 * working*, and the behavioural half has already obeyed. This is the other
 * half: the drift that reading produced is not a drift, so it must come out of
 * the one number Focus Plan computes — minutes-until-first-drift. Correcting
 * the model corrects the history too.
 *
 * Everything here is a pure rewrite of one `PlanRound`. It has no clock, no
 * disk and no opinion about whether a retraction should be attempted: the
 * recorder decides that (`src/main/focusplan/retract.ts`) and hands the round
 * over. A retraction is a change to the DATA and never to the gates — the
 * estimator, the seven trend gates and `classifyRound` all run afterwards
 * exactly as they always did, which is why the round is RECLASSIFIED here
 * rather than merely having a number subtracted from it.
 *
 * `docs/CORRECTION-LOOP.md § 5`.
 */

import type { Decision } from "../types";
import type { PlanRetraction, PlanRetractionRefusal } from "../correction/types";
import { classifyRound, driftTypeOf } from "./drift";
import { isDriftedDecision } from "../forecast/labels";
import { PLAN_MAX_DRIFTS_PER_ROUND } from "./constants";
import type { PlanRound } from "./types";

export interface RetractInput {
  /** The round the pause interrupted, or null when there is none to correct. */
  round: PlanRound | null;
  /**
   * `OnsetState.last` at the moment the segment closed — the decision the
   * stream was sitting on when the pause stopped the clock.
   *
   * This is what makes "the episode that is still open" answerable without a
   * second ledger: `stepOnset` records an onset only on ENTERING a drift, so
   * an episode still running at the close has exactly one onset (the last),
   * and its flavour is the flavour of this decision.
   */
  lastDecision: Decision | null;
  /** `focusPlanEnabled`. Off means there is no history to correct. */
  enabled: boolean;
  /** `FOCUSPLUG_NO_PLAN=1`. The filming pin writes nothing, including this. */
  pinned: boolean;
}

export interface RetractOutcome {
  /** The rewritten round, or null when nothing was changed. */
  round: PlanRound | null;
  retraction: PlanRetraction;
}

function refused(
  refusal: PlanRetractionRefusal,
  round: PlanRound | null,
): RetractOutcome {
  return {
    round: null,
    retraction: {
      retracted: false,
      roundKey: round?.roundKey ?? null,
      retractedAtSec: null,
      firstDriftSecBefore: round?.firstDriftSec ?? null,
      firstDriftSecAfter: round?.firstDriftSec ?? null,
      refusal,
    },
  };
}

/**
 * Remove the last still-open `walk_away` onset from a round, and nothing else.
 *
 * The rule is narrow on purpose. The pause fires INSIDE an away episode, but
 * the onset that episode produced happened earlier — as soon as the presence
 * confidence cleared `deskThreshold`, well before it cleared
 * `pauseAwayConfidence` for fifteen unbroken seconds. "Retract the onset at
 * the pause instant" would therefore retract nothing, and "retract every
 * `walk_away` onset in the round" would delete real drifts from earlier in the
 * evening. The last onset of a still-open episode is exactly the one the pause
 * is about.
 *
 * Never throws. Every refusal is named, in the order of
 * `docs/CORRECTION-LOOP.md § 5.5`, because a retraction that quietly did
 * nothing would be the one failure a student could not see.
 */
export function retractLastAwayDrift(input: RetractInput): RetractOutcome {
  const round = input.round;
  if (!input.enabled) {
    return refused("plan-off", round);
  }
  if (input.pinned) {
    return refused("pinned", round);
  }
  if (round === null) {
    return refused("no-round", null);
  }
  if (round.driftsSec.length === 0) {
    return refused("no-onset", round);
  }
  // (a) the decision stream was still drifted when the round closed.
  if (input.lastDecision === null || !isDriftedDecision(input.lastDecision)) {
    return refused("not-open", round);
  }
  // (b) the camera caused it. A `tab_out` last onset is about the window —
  // `classify()` returns DISTRACTED before it ever looks at the desk — so a
  // desk correction has nothing to say about it.
  if (driftTypeOf(input.lastDecision) !== "walk_away") {
    return refused("not-away", round);
  }
  // At the cap, "the last recorded onset" is not necessarily the last onset,
  // so the one the pause is about cannot be identified.
  if (round.driftsSec.length >= PLAN_MAX_DRIFTS_PER_ROUND) {
    return refused("capped", round);
  }

  const drifts = round.driftsSec.slice(0, -1);
  const offset = round.driftsSec[round.driftsSec.length - 1];
  if (offset === undefined) {
    return refused("no-onset", round);
  }
  const firstDriftSec = drifts[0] ?? null;
  // `firstDriftType` never needs recomputation. It is only ever recorded for
  // the FIRST onset, so retracting the last one can touch it only when the
  // last IS the first — and then the round is censored and both go null
  // together. In every other case the first onset survives untouched.
  const plannedForStatus =
    round.plannedFocusSec > 0 ? round.plannedFocusSec : Number.POSITIVE_INFINITY;
  const next: PlanRound = {
    ...round,
    driftsSec: drifts,
    retractedDriftsSec: [...(round.retractedDriftsSec ?? []), offset].sort((a, b) => a - b),
    firstDriftSec,
    firstDriftType: firstDriftSec === null ? null : round.firstDriftType,
    // Not decoration. `classifyRound`'s short-round rule is asymmetric on
    // purpose — a short round WITH a drift is real data, a short round without
    // one is noise — so a four-minute round whose only drift has just been
    // retracted must become `discarded` rather than enter the estimator as a
    // censored four-minute observation.
    status: classifyRound({
      servedSec: round.servedSec,
      plannedFocusSec: plannedForStatus,
      firstDriftSec,
      sawStatus: true,
    }),
  };

  return {
    round: next,
    retraction: {
      retracted: true,
      roundKey: round.roundKey,
      retractedAtSec: offset,
      firstDriftSecBefore: round.firstDriftSec,
      firstDriftSecAfter: firstDriftSec,
      refusal: null,
    },
  };
}

/* ── copy: a retraction is never silent ──────────────────────────────────── */

/** Minutes to one decimal, the resolution the plan log already prints. */
function minutes(seconds: number): string {
  return (seconds / 60).toFixed(1);
}

/**
 * The `plan · …` log line for a retraction, beside the round it belongs to.
 * Editing a student's measured history quietly would be worse than the false
 * drift that made it necessary.
 */
export function retractionLogLine(round: number, retraction: PlanRetraction): string {
  if (retraction.retracted && retraction.retractedAtSec !== null) {
    return (
      `round ${round} — drift at ${minutes(retraction.retractedAtSec)} min retracted ` +
      "(the away reading was wrong)"
    );
  }
  return `round ${round} — nothing retracted, ${retraction.refusal ?? "no reason given"}`;
}

const REFUSAL_NOTICE: Readonly<Record<PlanRetractionRefusal, string>> = {
  "plan-off": "your focus history was not changed — Focus Plan is switched off",
  pinned: "your focus history was not changed — this build is pinned for filming",
  "no-round": "your focus history was not changed — no round was open",
  "no-onset": "your focus history was not changed — that round recorded no drift",
  "not-open": "your focus history was not changed — that round had already ended",
  "not-away": "your focus history was not changed — a blocked app caused that drift, not the camera",
  capped: "your focus history was not changed — too many drifts in that round to tell which was this one",
};

/**
 * One quiet line under the paused screen's confirmation. A refusal is never an
 * error: the behavioural half — resume and cooldown — has already happened and
 * does not depend on this.
 */
export function retractionNotice(retraction: PlanRetraction | null): string | null {
  if (retraction === null) {
    return null;
  }
  if (retraction.retracted) {
    return "That drift is out of your focus history — it was not one.";
  }
  if (retraction.refusal === null) {
    return null;
  }
  return REFUSAL_NOTICE[retraction.refusal];
}

/**
 * The evidence row's grey note, so a student who reads "held 24 minutes" and
 * remembers being interrupted at six can find out why the two disagree.
 */
export function retractedNote(count: number): string | null {
  if (count <= 0) {
    return null;
  }
  const drifts = count === 1 ? "one drift" : `${count} drifts`;
  return `${drifts} retracted — you told us the camera was wrong`;
}
