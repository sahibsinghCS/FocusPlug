import type { ForecastEvent } from "@shared/ipc";
import {
  PLAN_DEBRIEF_FRESH_MS,
  holdSparkCaption,
  median,
  reviseBreak,
  type LivePlanRound,
  type PlanEvidenceRow,
  type PlanRecommendation,
  type PlanRevision,
  type PlanRound,
  type PlanTrend,
} from "@shared/plan";
import type { Tone } from "../../lib/format";
import { formatHmClock } from "../../lib/format";
import { FEATURE_SHORT_LABELS } from "../forecast/copy";
import type { RunPosition } from "../timer/runtime";

/**
 * Pure view-model for the Focus Plan surfaces — tone, the accept/override
 * state, the evidence table, the hold sparkline's geometry, the live round the
 * cold-start rung reads from, and the session roll-up.
 *
 * It composes no claims: every sentence on screen arrives already written from
 * `src/shared/plan/copy.ts`, so the browser demo renders the identical words
 * and the honesty tests hold them without a DOM. What lives here is layout,
 * geometry and labels — and every number in a label comes out of the model
 * that produced it.
 */

/* ── tone ────────────────────────────────────────────────────────────── */

/**
 * The card's frame in the console's existing vocabulary. A plan that is
 * stretching earns the focus tone; one easing off is amber, which is the
 * forecast's own "something changed, nothing is dead" step. Everything
 * unmeasured stays mute — a card with no history must not look like a verdict.
 */
export function planTone(rec: PlanRecommendation): Tone {
  if (rec.estimate.provisional || rec.estimate.rung === "no-history") {
    return "mute";
  }
  if (rec.step === "stretch") {
    return "focus";
  }
  if (rec.step === "ease") {
    return "amber";
  }
  return "mute";
}

/* ── the start-of-session card ───────────────────────────────────────── */

export interface PlanCardView {
  kicker: string;
  headline: string;
  reasoning: string;
  trendLine: string | null;
  forecastNote: string | null;
  method: string;
  acceptLabel: string;
  overrideLine: string;
  focusMin: number;
  breakMin: number;
  tone: Tone;
  /** The Dial already agrees with the offer, so there is nothing to accept. */
  matches: boolean;
  /** "your plan: 30 / 8" — shown only while the Dial disagrees. */
  yourPlan: string | null;
  /** Provisional readings always say so, in the kicker AND on the chip. */
  provisional: boolean;
  evidence: EvidenceRowView[];
  /** "5 rounds · 3 counted" — the reconciliation H9 promises. */
  evidenceSummary: string;
}

export function alreadyMatches(
  rec: PlanRecommendation,
  plan: { focusMin: number; breakMin: number },
): boolean {
  return plan.focusMin === rec.focusMin && plan.breakMin === rec.breakMin;
}

export function yourPlanLabel(plan: { focusMin: number; breakMin: number }): string {
  return `your plan: ${plan.focusMin} / ${plan.breakMin}`;
}

export function planCardView(
  rec: PlanRecommendation,
  plan: { focusMin: number; breakMin: number },
): PlanCardView {
  const matches = alreadyMatches(rec, plan);
  const evidence = evidenceRows(rec.evidence);
  const counted = evidence.filter((row) => row.counted).length;
  return {
    kicker: rec.copy.kicker,
    headline: rec.copy.headline,
    reasoning: rec.copy.reasoning,
    trendLine: rec.copy.trendLine,
    forecastNote: rec.copy.forecastNote,
    method: rec.copy.method,
    acceptLabel: rec.copy.acceptLabel,
    overrideLine: rec.copy.overrideLine,
    focusMin: rec.focusMin,
    breakMin: rec.breakMin,
    tone: planTone(rec),
    matches,
    yourPlan: matches ? null : yourPlanLabel(plan),
    provisional: rec.estimate.provisional,
    evidence,
    evidenceSummary: `${countLabel(evidence.length, "round", "rounds")} · ${counted} counted`,
  };
}

function countLabel(value: number, singular: string, plural: string): string {
  return value === 1 ? `1 ${singular}` : `${value} ${plural}`;
}

/* ── the "Why this?" disclosure ──────────────────────────────────────── */

export interface EvidenceRowView {
  key: string;
  /** "Mon 21:04" — the local weekday and clock of the round's start. */
  when: string;
  round: string;
  planned: string;
  /** "drifted at 19:12" or "no drift". Never a dash, never a bare zero. */
  outcome: string;
  /** What kind of drift, or why the row does not count. */
  note: string;
  counted: boolean;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** "Mon 21:04". Local, because the ledger's `day` is stamped local in main. */
export function whenLabel(at: number): string {
  if (!Number.isFinite(at)) {
    return "unknown time";
  }
  const weekday = WEEKDAYS[new Date(at).getDay()] ?? "";
  return `${weekday} ${formatHmClock(at)}`.trim();
}

/** "19:12" — minutes and seconds, the resolution a drift time deserves. */
export function minSec(totalSec: number): string {
  const safe = Math.max(0, Math.round(totalSec));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

export function driftLabel(driftType: PlanEvidenceRow["driftType"]): string {
  if (driftType === "walk_away") {
    return "left the desk";
  }
  if (driftType === "tab_out") {
    return "tabbed out";
  }
  return "drifted";
}

export function evidenceRows(rows: readonly PlanEvidenceRow[]): EvidenceRowView[] {
  return rows.map((row, index) => {
    const planned = Math.round(row.plannedFocusMin);
    const held = Math.round(row.heldMin);
    return {
      key: `${row.at}-${row.round}-${index}`,
      when: whenLabel(row.at),
      round: `round ${row.round}`,
      planned: `${planned} min planned`,
      outcome: row.censored ? "no drift" : `drifted at ${minSec(row.heldMin * 60)}`,
      note: row.counted
        ? row.censored
          ? `held ${held} of ${planned} min`
          : driftLabel(row.driftType)
        : (row.excludedBecause ?? "not counted"),
      counted: row.counted,
    };
  });
}

/* ── the live round: what makes rung 1 reachable on a fresh install ──── */

export interface LiveRoundInput {
  /** `timer.startedAtMs` — the run clock's wall start. */
  startedAtMs: number | null;
  position: RunPosition | null;
  forecastOn: boolean;
  forecastEvents: readonly ForecastEvent[];
  /** `AppState.forecastHistory`, oldest first. */
  history: readonly { ts: number; risk: number }[];
}

/**
 * The round in progress, assembled renderer-side so main never has to stream
 * one. Its only job is to make the wobble rung reachable inside the first
 * round of a fresh install, and to feed `reviseBreak`.
 *
 * `servedSec` here is the segment's wall clock, not the recorder's served
 * clock — the renderer has no pause ledger, and inventing one would be worse
 * than saying so. Nothing persisted is computed from it: the recorded round
 * that lands in the ledger is main's, measured properly.
 */
export function liveRoundFor(input: LiveRoundInput): LivePlanRound | null {
  const { position, startedAtMs } = input;
  if (position === null || startedAtMs === null || position.segment.kind !== "focus") {
    return null;
  }
  const startedAt = startedAtMs + position.segment.startSec * 1000;
  const servedSec = Math.max(0, position.segment.seconds - position.remainingSec);

  let firstWobbleSec: number | null = null;
  if (input.forecastOn) {
    for (const event of input.forecastEvents) {
      if (event.type !== "forecast_nudge" && event.type !== "forecast_prearm") {
        continue;
      }
      if (event.ts < startedAt) {
        continue;
      }
      const offset = (event.ts - startedAt) / 1000;
      if (firstWobbleSec === null || offset < firstWobbleSec) {
        firstWobbleSec = offset;
      }
    }
  }

  let peakRisk: number | null = null;
  let peakRiskSec: number | null = null;
  if (input.forecastOn) {
    for (const point of input.history) {
      if (point.ts < startedAt) {
        continue;
      }
      if (peakRisk === null || point.risk > peakRisk) {
        peakRisk = point.risk;
        peakRiskSec = (point.ts - startedAt) / 1000;
      }
    }
  }

  return {
    roundKey: `${startedAtMs}-${position.segment.index}`,
    startedAt,
    plannedFocusSec: position.segment.seconds,
    servedSec,
    firstDriftSec: null,
    firstWobbleSec,
    peakRisk,
    peakRiskSec,
    forecastOn: input.forecastOn,
  };
}

/* ── the mid-session revision, on the nudge surface that already ships ── */

export interface RevisionInput {
  live: LivePlanRound | null;
  position: RunPosition | null;
  /** The estimate the plan card is showing, in minutes. */
  estimateMin: number | null;
  risk: number | null;
  nudgeRisk: number;
  /** A fuse is burning. The hard guard: that nudge is about the fuse. */
  countdownActive: boolean;
}

/**
 * One sentence for the overlay main already fired. It adds no control, no
 * channel and no timer — `reviseBreak` returns a string or nothing.
 */
export function revisionFor(input: RevisionInput): PlanRevision | null {
  const { live, position } = input;
  if (live === null || position === null || position.segment.kind !== "focus") {
    return null;
  }
  return reviseBreak({
    elapsedSec: live.servedSec,
    remainingSec: position.remainingSec,
    estimateMin: input.estimateMin,
    wobbled: live.firstWobbleSec !== null,
    risk: input.risk,
    nudgeRisk: input.nudgeRisk,
    countdownActive: input.countdownActive,
  });
}

/* ── the debrief's sparkline ─────────────────────────────────────────── */

export interface HoldMark {
  x: number;
  y: number;
  minutes: number;
  /** Censored rounds are open circles with the standard upward tick. */
  censored: boolean;
}

export interface HoldTrendLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface HoldSparklineView {
  width: number;
  height: number;
  marks: HoldMark[];
  /** Horizontal rule at the current median; null when there is no median. */
  medianY: number | null;
  /** Theil–Sen, and ONLY when the trend earned `clear`. */
  line: HoldTrendLine | null;
  caption: string;
  empty: boolean;
}

export interface HoldSparklineOptions {
  width?: number;
  height?: number;
  medianMin: number | null;
  trend: PlanTrend;
}

const SPARK_PAD = 4;

/**
 * One mark per round, x by index and y by minutes held. Open circles are
 * right-censored observations — the round ran clean, so the true hold is
 * somewhere past the mark, which is what the tick points at.
 *
 * A line is drawn only when `trend.confidence === "clear"`, and it is the
 * Theil–Sen slope the trend actually computed. Below that there is no line at
 * all, because the geometry must not be able to draw a direction the estimator
 * refused to claim.
 *
 * The caption is `holdSparkCaption` from the copy layer, given the geometry's
 * own answer about whether a line was drawn — so it names the gate that really
 * stopped this trend rather than the first one in the list, and this file
 * still composes no claims.
 */
export function holdSparkline(
  series: readonly { at: number; minutes: number; censored: boolean }[],
  options: HoldSparklineOptions,
): HoldSparklineView {
  const width = options.width ?? 120;
  const height = options.height ?? 28;
  const ordered = [...series].sort((a, b) => a.at - b.at);
  const values = ordered.map((point) => point.minutes);
  if (options.medianMin !== null) {
    values.push(options.medianMin);
  }
  const lo = values.length > 0 ? Math.min(...values) : 0;
  const hi = values.length > 0 ? Math.max(...values) : 1;
  const span = hi - lo < 1 ? 1 : hi - lo;
  const innerH = Math.max(1, height - SPARK_PAD * 2);
  const innerW = Math.max(1, width - SPARK_PAD * 2);
  const toY = (minutes: number): number =>
    SPARK_PAD + (1 - (minutes - lo) / span) * innerH;
  const toX = (index: number): number =>
    ordered.length <= 1
      ? SPARK_PAD + innerW / 2
      : SPARK_PAD + (index / (ordered.length - 1)) * innerW;

  const marks: HoldMark[] = ordered.map((point, index) => ({
    x: round1(toX(index)),
    y: round1(toY(point.minutes)),
    minutes: point.minutes,
    censored: point.censored,
  }));

  const slope = options.trend.confidence === "clear" ? options.trend.slopeMinPerRound : null;
  let line: HoldTrendLine | null = null;
  if (slope !== null && marks.length >= 2) {
    const centreIndex = (ordered.length - 1) / 2;
    const centreValue = median(ordered.map((point) => point.minutes)) ?? lo;
    const firstValue = centreValue + slope * (0 - centreIndex);
    const lastValue = centreValue + slope * (ordered.length - 1 - centreIndex);
    line = {
      x1: round1(toX(0)),
      y1: round1(clamp(toY(firstValue), 0, height)),
      x2: round1(toX(ordered.length - 1)),
      y2: round1(clamp(toY(lastValue), 0, height)),
    };
  }

  return {
    width,
    height,
    marks,
    medianY: options.medianMin === null ? null : round1(toY(options.medianMin)),
    line,
    caption: holdSparkCaption(options.trend, line !== null),
    empty: marks.length === 0,
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/* ── the done panel's session roll-up ────────────────────────────────── */

export interface SessionRollup {
  rounds: number;
  servedSec: number;
  /** First-drift minutes, chronological. Empty when every round ran clean. */
  firstDriftsMin: number[];
  medianMin: number | null;
  kills: number;
}

/**
 * The rounds of the run that just finished, found by the `roundKey` namespace
 * the renderer stamped on them (`<plan startedAtMs>-<segment index>`), so a
 * roll-up can never quietly include yesterday's evening.
 */
export function sessionRollup(
  rounds: readonly PlanRound[],
  startedAtMs: number | null,
): SessionRollup | null {
  if (startedAtMs === null) {
    return null;
  }
  const prefix = `${startedAtMs}-`;
  const mine = rounds
    .filter((round) => round.roundKey.startsWith(prefix))
    .sort((a, b) => a.startedAt - b.startedAt);
  if (mine.length === 0) {
    return null;
  }
  const drifts = mine
    .filter((round) => round.firstDriftSec !== null)
    .map((round) => (round.firstDriftSec ?? 0) / 60);
  return {
    rounds: mine.length,
    servedSec: mine.reduce((total, round) => total + round.servedSec, 0),
    firstDriftsMin: drifts,
    medianMin: median(drifts),
    kills: mine.reduce((total, round) => total + round.kills, 0),
  };
}

/* ── debrief plumbing ────────────────────────────────────────────────── */

/** The newest closed round, or null on a ledger that has none. */
export function newestRound(rounds: readonly PlanRound[]): PlanRound | null {
  let newest: PlanRound | null = null;
  for (const round of rounds) {
    if (newest === null || round.endedAt > newest.endedAt) {
      newest = round;
    }
  }
  return newest;
}

/**
 * The setup page shows a debrief only while the round it describes is still
 * the thing that just happened — so a judge who closed the app mid-break still
 * sees it, and yesterday's round never greets them at breakfast.
 */
export function isFreshDebrief(round: PlanRound, nowMs: number): boolean {
  return nowMs - round.endedAt < PLAN_DEBRIEF_FRESH_MS;
}

/**
 * The forecast's strongest signal at the wobble, in the forecast's own words.
 * There is no second feature copy table here: the label comes from
 * `FEATURE_SHORT_LABELS`, and the sentence says "the strongest signal at that
 * moment was", never "because" — an attribution is an occlusion delta.
 */
export function signalPhraseFor(
  round: PlanRound,
  events: readonly ForecastEvent[],
): string | null {
  if (!round.forecastOn) {
    return null;
  }
  let best: { ts: number; key: string } | null = null;
  for (const event of events) {
    if (event.type !== "forecast_nudge") {
      continue;
    }
    if (event.ts < round.startedAt || event.ts > round.endedAt) {
      continue;
    }
    const key = event.topFeatures[0];
    if (key === undefined) {
      continue;
    }
    if (best === null || event.ts < best.ts) {
      best = { ts: event.ts, key };
    }
  }
  if (best === null) {
    return null;
  }
  return FEATURE_SHORT_LABELS[best.key as keyof typeof FEATURE_SHORT_LABELS] ?? null;
}
