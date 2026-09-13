/**
 * Every user-visible string Focus Plan produces.
 *
 * The renderer composes NO sentences: `PlanCardCopy`, `PlanDebriefCopy`,
 * `PlanRevisionCopy` and the sparkline's caption all arrive fully formed, so
 * every word is unit-testable without a DOM and the browser demo renders the
 * identical copy.
 *
 * The copy rules this file is held to (§6.4), each of them a test:
 *   1. Never an imperative with a consequence attached.
 *   2. Never "you failed". The verb is DRIFTED, always paired with a number.
 *   3. Every claim names its evidence in the same sentence or the next one.
 *   4. The student's own number is always an equal choice.
 *   5. When the system does not know, that goes in the body, not in grey 11px.
 *   6. No exclamation marks, no emoji. A number that went up is the celebration.
 *   7. Numbers never render as "—", 0, NaN or undefined. If there is nothing to
 *      say, the rung copy says there is nothing to say.
 *
 * And H10: every number in a rendered sentence exists in the model that
 * produced it, enforced by the digit-membership fuzz in `copy.test.ts`.
 */

import {
  PLAN_BACKOFF_MIN,
  PLAN_MAX_REACH_MIN,
  PLAN_MIN_FOCUS_MIN,
  PLAN_MIN_ROUND_SEC,
  PLAN_STRETCH_MIN,
  PLAN_TREND_MIN_DAYS,
  PLAN_TREND_MIN_EVENTS,
  PLAN_TREND_MIN_HALF,
} from "./constants";
import type {
  PlanCardCopy,
  PlanDebriefCopy,
  PlanEstimate,
  PlanRevisionCopy,
  PlanRevisionKind,
  PlanRound,
  PlanStep,
  PlanTrend,
} from "./types";

/* ── number words, so nothing ever renders as 0, NaN or "—" ──────────── */

const NEVER_ENFORCED = "Or set your own below. Nothing here is enforced.";
const ACCEPT_LABEL = "Use this plan";

function whole(value: number): number {
  return Math.max(0, Math.round(value));
}

/** "20 minutes", "1 minute", and never "0 minutes". */
export function minutesText(value: number): string {
  if (!Number.isFinite(value)) {
    return "an unknown number of minutes";
  }
  const rounded = whole(value);
  if (rounded < 1) {
    return "under a minute";
  }
  return rounded === 1 ? "1 minute" : `${rounded} minutes`;
}

/** "19, 22 and 20" — the reasoning sentence's evidence list. */
export function minutesList(values: readonly number[]): string {
  const parts = values.filter((v) => Number.isFinite(v)).map((v) => `${whole(v)}`);
  if (parts.length === 0) {
    return "";
  }
  if (parts.length === 1) {
    return parts[0] ?? "";
  }
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function countText(value: number, singular: string, plural: string): string {
  return value === 1 ? `1 ${singular}` : `${value} ${plural}`;
}

/* ── the plan card ───────────────────────────────────────────────────── */

export interface PlanCardCopyInput {
  focusMin: number;
  breakMin: number;
  step: PlanStep;
  baseMin: number;
  estimate: PlanEstimate;
  trend: PlanTrend;
  cold: boolean;
  forecastEnabled: boolean;
}

function kickerFor(input: PlanCardCopyInput): string {
  const { estimate, step } = input;
  switch (estimate.rung) {
    case "no-history":
      return "FOCUS PLAN · no history yet";
    case "wobble-only":
      return "FOCUS PLAN · provisional";
    case "censored-only":
      return "FOCUS PLAN · limit unknown";
    case "single":
      return "FOCUS PLAN · one drift measured";
    case "pair":
      return "FOCUS PLAN · two drifts measured";
    default: {
      const label = step === "stretch" ? "stretch" : step === "ease" ? "easing off" : "measured";
      return `FOCUS PLAN · ${label} · ${countText(estimate.rounds, "round", "rounds")}`;
    }
  }
}

function headlineFor(input: PlanCardCopyInput): string {
  const work = minutesText(input.focusMin);
  const off = `${whole(input.breakMin)} off`;
  switch (input.estimate.rung) {
    case "no-history":
      return `Start with ${work}, then ${off}.`;
    case "wobble-only":
      return `Provisional: try ${work}, then ${off}.`;
    case "measured":
      if (input.step === "stretch") {
        return `Stretch: ${work}, then ${off}.`;
      }
      if (input.step === "ease") {
        return `Ease back: ${work}, then ${off}.`;
      }
      return `${work} of work, then ${off}.`;
    default:
      return `Try ${work}, then ${off}.`;
  }
}

/**
 * H2 lives here. When Kaplan-Meier's median is unreached the copy says
 * "at least X" and never a point estimate — the student drifts in fewer than
 * half their rounds, and the honest advice is a longer block, not a shorter
 * one.
 */
function unreachedMedianReasoning(input: PlanCardCopyInput): string {
  const { estimate } = input;
  const floor = estimate.lowerBoundMin === null ? null : minutesText(estimate.lowerBoundMin);
  const rounds = countText(estimate.rounds, "round", "rounds");
  const head =
    estimate.events === 0
      ? estimate.rounds === 1
        ? `${rounds} so far, and it did not drift.`
        : `${rounds} so far and no drifts in any of them.`
      : `${rounds} so far, and more than half of them ran clean, so there is no midpoint to report.`;
  const body =
    floor === null
      ? "There is no measured hold to plan from yet."
      : `What we can say is that you have held at least ${floor} — we do not know where the limit is, because no round has run long enough to find out.`;
  const stretched =
    estimate.lowerBoundMin !== null && whole(input.baseMin) > whole(estimate.lowerBoundMin);
  const tail = stretched
    ? ` This adds ${minutesText(PLAN_STRETCH_MIN)} to go looking for it.`
    : " This plans the length you have already held.";
  return `${head} ${body}${tail}`;
}

function reasoningFor(input: PlanCardCopyInput): string {
  const { estimate } = input;

  if (estimate.rung === "no-history") {
    return (
      "No history yet, so this is the pomodoro default and not a reading of you. " +
      "FocusPlug measures one thing while you work: how many minutes you hold before your first drift. " +
      `Start short — ${minutesText(input.focusMin)} is short enough that this round produces a number.`
    );
  }

  if (estimate.rung === "wobble-only") {
    const at = estimate.medianMin === null ? null : minutesText(estimate.medianMin);
    return (
      "Nothing has finished yet, so this reading is provisional. " +
      "A wobble is the forecast warning that a drift was coming" +
      (at === null ? "" : ` — it flagged one ${at} into this round, and you did not drift`) +
      ". That is a warning, not a drift, so it is worth exactly one reading and no more: " +
      "the first completed round replaces it."
    );
  }

  if (estimate.medianMin === null) {
    return unreachedMedianReasoning(input);
  }

  const median = minutesText(estimate.medianMin);
  const holds = minutesList(estimate.recentHoldsMin);

  if (estimate.rung === "single") {
    return (
      `One measurement so far: you drifted ${minutesText(estimate.recentHoldsMin[0] ?? estimate.medianMin)} into your last round. ` +
      "One round is a mood, not a pattern, so nothing is being extrapolated from it — " +
      "this simply plans the length you actually did."
    );
  }

  if (estimate.rung === "pair") {
    return (
      `Two rounds, drifting at ${holds} minutes. ` +
      "Two points do not make a line, so no direction is being claimed — this is the middle of what you have done. " +
      "One more round and it starts trending."
    );
  }

  if (input.step === "stretch") {
    return (
      `You held your target clean twice in a row, so this adds ${minutesText(PLAN_STRETCH_MIN)}. ` +
      `Your median before the first drift is ${median} across ${countText(estimate.rounds, "round", "rounds")}.`
    );
  }

  if (input.step === "ease") {
    const lastTwo = minutesList(estimate.recentHoldsMin.slice(-2));
    return (
      `The last two rounds drifted at ${lastTwo} minutes, short of what they planned. ` +
      `A round you finish beats a round you plan, so this drops ${minutesText(PLAN_BACKOFF_MIN)}. ` +
      "It goes back up as soon as you hold two in a row."
    );
  }

  if (estimate.recentHoldsMin.length === estimate.events) {
    return (
      `Your last rounds drifted at ${holds} minutes — the middle of that is ${whole(estimate.medianMin)}. ` +
      `Half of your rounds get past ${median} clean.`
    );
  }
  return (
    `Your most recent rounds drifted at ${holds} minutes. ` +
    `Across all ${countText(estimate.rounds, "round", "rounds")} the middle is ${median}, ` +
    `so half of your rounds get past ${whole(estimate.medianMin)} clean.`
  );
}

/**
 * The trend sentence. Every confidence below `clear` carries an explicit
 * refusal clause and names the gate that stopped it, so the copy says what is
 * missing instead of shrugging.
 */
export function trendLine(trend: PlanTrend): string | null {
  const drifts = countText(trend.events, "drift", "drifts");
  const days = countText(trend.days, "day", "days");

  switch (trend.blockedBy) {
    case "too-few-events":
      return trend.events === 0
        ? `No drifts recorded yet, so there is no direction to call. It needs ${PLAN_TREND_MIN_EVENTS} drifts on ${PLAN_TREND_MIN_DAYS} different days before it will draw a line.`
        : `Not enough history to call a direction yet — ${drifts} across ${days}. It needs ${PLAN_TREND_MIN_EVENTS}, on ${PLAN_TREND_MIN_DAYS} different days, before it will draw a line.`;
    case "too-few-days":
      return `All ${drifts} landed on ${days}. That is one stretch of time, not a trend — it needs ${PLAN_TREND_MIN_DAYS} different days.`;
    case "lopsided-halves":
      return `One half of your history has too few drifts to compare against the other — it needs ${PLAN_TREND_MIN_HALF} on each side.`;
    case "censoring-limited":
      return "Most of your rounds ran clean, so the ones that drifted are the short ones. That is a biased sample and no direction is being read from it.";
    case "below-noise": {
      const delta = deltaOf(trend);
      const spread = trend.spreadMin === null ? null : whole(trend.spreadMin);
      const change = delta === null || whole(Math.abs(delta)) < 1 ? "under a minute" : `${whole(Math.abs(delta))} min`;
      const against = spread === null || spread < 1 ? "your round-to-round spread" : `your round-to-round spread (±${spread} min)`;
      return `Roughly flat: the change (${change}) is smaller than ${against}, so it is noise, not progress.`;
    }
    case "sign-disagreement":
      return "Your first and last halves disagree with the overall slope, so nothing is being claimed either way.";
    case "unstable":
      return "Drop any single round and the direction changes, so that is noise rather than a trend.";
    case null:
      break;
  }

  const delta = deltaOf(trend);
  if (delta === null || trend.newerMedianMin === null || trend.olderMedianMin === null) {
    return null;
  }
  const word = trend.direction === "up" ? "Up" : "Down";
  const caveat = trend.roundOneOnly
    ? " Comparing first rounds only — later rounds of a plan are systematically harder."
    : " Mixing first and later rounds, which are not equally hard.";
  return (
    `${word} ${minutesText(Math.abs(delta))}: ${minutesText(trend.newerMedianMin)} now against ` +
    `${whole(trend.olderMedianMin)} earlier, across ${drifts} on ${days}.${caveat}`
  );
}

function deltaOf(trend: PlanTrend): number | null {
  if (trend.newerMedianMin === null || trend.olderMedianMin === null) {
    return null;
  }
  return trend.newerMedianMin - trend.olderMedianMin;
}

/**
 * The caption under the debrief's sparkline.
 *
 * It lives here, with every other sentence, because it is the ONLY thing the
 * debrief surface says about direction — and a caption that names a gate the
 * trend did not fail is a lie told in the one place the student is looking for
 * the truth. It names the gate `planTrend` actually stopped on, and every
 * count in it is a count that trend reported: a student with 8 drifts on 8
 * evenings refused by `below-noise` is told the change is inside their spread,
 * never that they are short of history.
 *
 * `hasLine` is the geometry's answer rather than the model's, because a line
 * needs two marks as well as a cleared trend. The caption describes what is
 * actually on screen.
 */
export function holdSparkCaption(trend: PlanTrend, hasLine: boolean): string {
  if (hasLine) {
    return "Theil–Sen line — the direction the gates cleared.";
  }
  return `dots only — ${sparkRefusal(trend)}`;
}

/** The short form of `trendLine`'s refusal — same gate, same numbers. */
function sparkRefusal(trend: PlanTrend): string {
  const drifts = countText(trend.events, "drift", "drifts");
  const needs = `a line needs ${PLAN_TREND_MIN_EVENTS}, on ${PLAN_TREND_MIN_DAYS} different days.`;
  switch (trend.blockedBy) {
    case "too-few-events":
      return trend.events === 0 ? `no drifts recorded yet — ${needs}` : `${drifts} so far — ${needs}`;
    case "too-few-days":
      return `${drifts}, but on ${countText(trend.days, "day", "days")} — a line needs ${PLAN_TREND_MIN_DAYS}.`;
    case "lopsided-halves":
      return `one half has fewer than ${PLAN_TREND_MIN_HALF} drifts to compare against the other.`;
    case "censoring-limited":
      return "most rounds ran clean, so the ones that drifted are a biased sample.";
    case "below-noise":
      return "the change is smaller than your round-to-round spread.";
    case "sign-disagreement":
      return "your two halves and the overall slope disagree.";
    case "unstable":
      return "drop any single round and the direction changes.";
    case null:
      return "there are not yet two points to draw a line through.";
  }
}

/**
 * The recommendation is clamped twice — at the floor, and at "best hold plus
 * ten" — and either clamp can move the number away from the measurement the
 * sentence above just quoted. When that happens the copy says so, because a
 * reasoning paragraph that quotes 6 minutes next to a headline of 10 is a
 * paragraph the student is right not to trust.
 */
function clampNote(input: PlanCardCopyInput): string {
  const delta =
    input.step === "stretch" ? PLAN_STRETCH_MIN : input.step === "ease" ? -PLAN_BACKOFF_MIN : 0;
  const stepped = whole(input.baseMin + delta);
  if (input.focusMin === stepped) {
    return "";
  }
  if (input.focusMin > stepped) {
    return ` A plan never goes under ${minutesText(PLAN_MIN_FOCUS_MIN)}, so this one sits at the floor.`;
  }
  return ` It is held to your best hold plus ${minutesText(PLAN_MAX_REACH_MIN)}, so the plan can climb but not leap.`;
}

export const FORECAST_OFF_NOTE =
  "Focus Forecast is off, so there is no early read and no risk curve in the debrief — this plans from drifts only.";

export function planCardCopy(input: PlanCardCopyInput): PlanCardCopy {
  return {
    kicker: kickerFor(input),
    headline: headlineFor(input),
    reasoning: `${reasoningFor(input)}${clampNote(input)}`,
    trendLine: trendLine(input.trend),
    forecastNote: input.forecastEnabled ? null : FORECAST_OFF_NOTE,
    method: `${input.estimate.method} ${input.trend.method}`,
    acceptLabel: ACCEPT_LABEL,
    overrideLine: NEVER_ENFORCED,
  };
}

/* ── the debrief ─────────────────────────────────────────────────────── */

export interface PlanDebriefCopyInput {
  round: PlanRound;
  heldMin: number | null;
  censored: boolean;
  rhythmMin: number | null;
  notCounted: boolean;
  /** The recomputed plan, with this round folded in. */
  next: { focusMin: number; breakMin: number; step: PlanStep; estimate: PlanEstimate };
  /** True when this is the first round this install has ever logged. */
  firstEver: boolean;
  forecastEnabled: boolean;
  /**
   * The forecast's strongest signal at the moment of the wobble, phrased by
   * `featurePhrase` in the renderer's forecast copy. There is no second copy
   * table for features here, and no "because" — an attribution is an occlusion
   * delta, and the forecast's own panels already say so.
   */
  signalPhrase?: string | null;
}

function debriefHeadline(input: PlanDebriefCopyInput): string {
  const { round } = input;
  if (round.startedDrifted) {
    return "This round started with a blocked app already up.";
  }
  if (input.notCounted) {
    return `Round ended after ${minutesText(round.servedSec / 60)}.`;
  }
  if (input.censored) {
    return `${minutesText(round.servedSec / 60)}, no drift.`;
  }
  const held = minutesText(input.heldMin ?? 0);
  return input.firstEver ? `First round logged. You held ${held}.` : `You held ${held}.`;
}

function whereItWent(input: PlanDebriefCopyInput): string | null {
  const { round } = input;
  if (!input.forecastEnabled || !round.forecastOn) {
    return "Focus Forecast is off, so there is no risk curve for this round. The drift times here come from the policy engine, which is always on.";
  }
  if (round.peakRisk === null || round.peakRiskSec === null) {
    return null;
  }
  const pct = Math.round(round.peakRisk * 100);
  const at = minutesText(round.peakRiskSec / 60);
  const signal =
    input.signalPhrase === undefined || input.signalPhrase === null || input.signalPhrase.length === 0
      ? ""
      : ` The strongest signal at that moment was ${input.signalPhrase}.`;

  if (round.firstDriftSec !== null && round.peakRiskSec < round.firstDriftSec) {
    const lead = (round.firstDriftSec - round.peakRiskSec) / 60;
    return `Risk peaked at ${pct}% about ${at} in, ${minutesText(lead)} before your first drift.${signal}`;
  }
  if (round.firstDriftSec === null && round.standDowns > 0) {
    const flagged = round.firstWobbleSec === null ? null : minutesText(round.firstWobbleSec / 60);
    return (
      `The forecast flagged a wobble${flagged === null ? "" : ` ${flagged} in`} and stood down on its own. ` +
      `That is a warning, not a drift — it is not counted as one. Risk peaked at ${pct}%.${signal}`
    );
  }
  if (round.firstDriftSec === null) {
    const quiet = round.wobbles === 0 && round.countdowns === 0 ? " No nudge, no fuse." : "";
    return `Risk peaked at ${pct}% about ${at} in and came back down on its own.${quiet}${signal}`;
  }
  return `Risk peaked at ${pct}% about ${at} in.${signal}`;
}

function rhythmLine(input: PlanDebriefCopyInput): string | null {
  const drifts = input.round.driftsSec;
  if (drifts.length < 2 || input.rhythmMin === null) {
    return null;
  }
  const list = minutesList(drifts.map((sec) => sec / 60));
  return `${countText(drifts.length, "drift", "drifts")}, at ${list} minutes. Once it started, roughly every ${minutesText(input.rhythmMin)}.`;
}

function costLine(round: PlanRound): string | null {
  if (round.countdowns === 0 && round.kills === 0) {
    return null;
  }
  const fuses = round.countdowns === 0 ? null : `${countText(round.countdowns, "fuse", "fuses")} burned`;
  const kills =
    round.kills === 0 ? null : `${countText(round.kills, "app", "apps")} force-quit`;
  const parts = [fuses, kills].filter((part): part is string => part !== null);
  return `${parts.join(", ")}. Nothing else was touched.`;
}

function theNumber(input: PlanDebriefCopyInput): string {
  const { round } = input;
  if (round.startedDrifted) {
    return (
      'There is no "minutes until first drift" to record when the drift is minute zero. ' +
      "That measures your window layout, not your attention, so it is recorded and left out of the estimate."
    );
  }
  if (input.notCounted) {
    return `Too short to measure — a clean round under ${minutesText(PLAN_MIN_ROUND_SEC / 60)} is not counted. Nothing about your plan changed.`;
  }
  if (input.censored) {
    return `You did not drift, so this round tells us your limit is past ${minutesText(round.servedSec / 60)} and nothing more precise.`;
  }
  const held = whole(input.heldMin ?? 0);
  const median = input.next.estimate.medianMin;
  const tail =
    median === null
      ? "Your median is not settled yet — more than half your rounds have run clean."
      : `Your median is ${whole(median)} across ${countText(input.next.estimate.rounds, "round", "rounds")}.`;
  return `Minutes to first drift: ${held}. ${tail}`;
}

function nextRoundLine(input: PlanDebriefCopyInput): string {
  const { next } = input;
  const base = `${minutesText(next.focusMin)}, then ${whole(next.breakMin)} off`;
  if (next.step === "stretch") {
    return `${base} — ${minutesText(PLAN_STRETCH_MIN)} more, because you held the last two.`;
  }
  if (next.step === "ease") {
    return `${base} — ${minutesText(PLAN_BACKOFF_MIN)} less, and it goes back up as soon as you hold two in a row.`;
  }
  if (next.estimate.rung === "censored-only") {
    return `${base} — a little more, to go find the edge.`;
  }
  if (next.estimate.rung === "no-history") {
    return `${base} — the default, until there is a measurement.`;
  }
  return `${base} — the middle of what you have held.`;
}

export function planDebriefCopy(input: PlanDebriefCopyInput): PlanDebriefCopy {
  const kicker =
    input.round.roundsTotal > 1
      ? `ROUND DEBRIEF · round ${input.round.round} of ${input.round.roundsTotal}`
      : "ROUND DEBRIEF";
  return {
    kicker,
    headline: debriefHeadline(input),
    whereItWent: whereItWent(input),
    rhythm: rhythmLine(input),
    cost: costLine(input.round),
    theNumber: theNumber(input),
    nextRound: nextRoundLine(input),
    notCountedLine: input.notCounted
      ? "This round is recorded but left out of the estimate, so nothing about your plan moved because of it."
      : null,
  };
}

/* ── the mid-session revision ────────────────────────────────────────── */

export interface PlanRevisionCopyInput {
  kind: PlanRevisionKind;
  plannedBreakInSec: number;
  suggestedBreakInSec: number;
  /** Minutes past the estimate, for the `later` line. */
  pastEstimateMin: number;
}

/**
 * One sentence, riding the nudge overlay main already fires. It adds no
 * control: "Skip round" names a button that already exists one screen away on
 * LockPage, deliberately not under the cursor at the moment a fuse is lit.
 */
export function planRevisionCopy(input: PlanRevisionCopyInput): PlanRevisionCopy {
  const suggested = minutesText(input.suggestedBreakInSec / 60);
  const planned = minutesText(input.plannedBreakInSec / 60);
  if (input.kind === "earlier") {
    return {
      line: `Plan — you are hitting your limit early. Break in ${suggested} instead of ${planned}? Skip round takes it now; nothing moves unless you move it.`,
    };
  }
  return {
    line: `Plan — you are ${minutesText(input.pastEstimateMin)} past your usual limit and still calm. Your break is in ${planned}. Skip it and push on if you are in it; your call.`,
  };
}
