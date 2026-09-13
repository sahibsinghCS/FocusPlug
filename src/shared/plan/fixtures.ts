/**
 * Named ledgers, one per rung and per interesting failure, so tests and the
 * browser demo read from the same fixtures rather than two sets of numbers
 * that drift apart.
 *
 * Every timestamp here is a literal. Nothing in this file — or anywhere else
 * under `src/shared/plan` — constructs a `Date`: `day` and `hour` are stamped
 * in main at write time, which is what keeps the pure core environment-
 * agnostic and testable without clock injection.
 */

import { PLAN_LEDGER_VERSION, type FocusPlanLedger, type LivePlanRound, type PlanRound } from "./types";

/**
 * 2026-09-01T09:00:00Z. Any fixed epoch would do; this one is readable, and
 * `ledger.test.ts` asserts it agrees with `dayKey(0)` so the two never drift.
 */
export const T0 = 1_788_253_200_000;
export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;

/** Deterministic day keys, so the fixtures never touch Date either. */
const DAYS = [
  "2026-09-01",
  "2026-09-02",
  "2026-09-03",
  "2026-09-04",
  "2026-09-05",
  "2026-09-06",
  "2026-09-07",
  "2026-09-08",
  "2026-09-09",
  "2026-09-10",
] as const;

export function dayKey(index: number): string {
  return DAYS[Math.min(DAYS.length - 1, Math.max(0, index))] ?? DAYS[0];
}

export interface RoundSpec {
  /** Days after T0. Also picks the day key. */
  day?: number;
  /** Minutes after 09:00 on that day. */
  atMin?: number;
  plannedFocusMin?: number;
  servedMin?: number;
  /** MUFD in minutes, or null for a clean (censored) round. */
  driftMin?: number | null;
  round?: number;
  roundsTotal?: number;
  status?: PlanRound["status"];
  startedDrifted?: boolean;
  wobbleMin?: number | null;
  peakRisk?: number | null;
  peakRiskMin?: number | null;
  countdowns?: number;
  kills?: number;
  standDowns?: number;
  driftsMin?: number[];
  forecastOn?: boolean;
}

/** A `PlanRound` from a handful of readable minutes. */
export function makeRound(spec: RoundSpec): PlanRound {
  const dayIndex = spec.day ?? 0;
  const startedAt = T0 + dayIndex * DAY + (spec.atMin ?? 0) * MINUTE;
  const plannedFocusSec = (spec.plannedFocusMin ?? 25) * 60;
  const servedSec = (spec.servedMin ?? spec.plannedFocusMin ?? 25) * 60;
  const firstDriftSec = spec.driftMin === undefined || spec.driftMin === null ? null : spec.driftMin * 60;
  const driftsSec =
    spec.driftsMin !== undefined
      ? spec.driftsMin.map((m) => m * 60)
      : firstDriftSec === null
        ? []
        : [firstDriftSec];
  const forecastOn = spec.forecastOn ?? true;
  return {
    v: 1,
    roundKey: `${startedAt}-${spec.round ?? 1}`,
    startedAt,
    endedAt: startedAt + servedSec * 1000,
    day: dayKey(dayIndex),
    hour: 9,
    status: spec.status ?? (servedSec >= plannedFocusSec - 5 ? "completed" : "aborted"),
    servedSec,
    plannedFocusSec,
    round: spec.round ?? 1,
    roundsTotal: spec.roundsTotal ?? 1,
    recommendedFocusSec: null,
    acceptedRecommendation: false,
    firstDriftSec,
    firstDriftType: firstDriftSec === null ? null : "tab_out",
    driftsSec,
    firstWobbleSec: spec.wobbleMin === undefined || spec.wobbleMin === null ? null : spec.wobbleMin * 60,
    wobbles: spec.wobbleMin === undefined || spec.wobbleMin === null ? 0 : 1,
    standDowns: spec.standDowns ?? 0,
    peakRisk: forecastOn ? (spec.peakRisk ?? null) : null,
    peakRiskSec:
      forecastOn && spec.peakRiskMin !== undefined && spec.peakRiskMin !== null
        ? spec.peakRiskMin * 60
        : null,
    firstDriftLeadSec: null,
    countdowns: spec.countdowns ?? 0,
    kills: spec.kills ?? 0,
    startedDrifted: spec.startedDrifted ?? false,
    forecastOn,
  };
}

export function ledgerOf(rounds: readonly PlanRound[]): FocusPlanLedger {
  return { v: PLAN_LEDGER_VERSION, lifetimeRounds: rounds.length, rounds: [...rounds] };
}

/* ── the named ledgers ───────────────────────────────────────────────── */

/** Rung 0. A fresh install, before the switch has ever been held. */
export const fresh: FocusPlanLedger = ledgerOf([]);

/** The round in progress on that fresh install, with a forecast wobble at 11. */
export const liveWobble: LivePlanRound = {
  roundKey: `${T0}-1`,
  startedAt: T0,
  plannedFocusSec: 50 * 60,
  servedSec: 12 * 60,
  firstDriftSec: null,
  firstWobbleSec: 11 * 60,
  peakRisk: 0.62,
  peakRiskSec: 11 * 60,
  forecastOn: true,
};

/** The same live round with the forecast quiet — rung 0 must still say something. */
export const liveQuiet: LivePlanRound = { ...liveWobble, firstWobbleSec: null, peakRisk: null, peakRiskSec: null };

/** One round, one drift. "One round is a mood, not a pattern." */
export const single: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, driftMin: 19, plannedFocusMin: 25, countdowns: 1, peakRisk: 0.78, peakRiskMin: 14 }),
]);

/** Three clean 25-minute rounds, each of which wobbled at 11. The ordering
 *  fixture: this must read `censored-only`, never `wobble-only`. */
export const clean3: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, driftMin: null, wobbleMin: 11, standDowns: 1, peakRisk: 0.55, peakRiskMin: 11 }),
  makeRound({ day: 1, driftMin: null, wobbleMin: 11, standDowns: 1, peakRisk: 0.51, peakRiskMin: 12 }),
  makeRound({ day: 2, driftMin: null, wobbleMin: 11, standDowns: 1, peakRisk: 0.49, peakRiskMin: 10 }),
]);

/** The decided beat: drifts at 19, 22 and 20 — the Kaplan-Meier median is 20. */
export const drift19_22_20: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, driftMin: 19, countdowns: 1, kills: 1, peakRisk: 0.78, peakRiskMin: 14 }),
  makeRound({ day: 1, driftMin: 22, countdowns: 1, peakRisk: 0.71, peakRiskMin: 18 }),
  makeRound({ day: 2, driftMin: 20, countdowns: 1, peakRisk: 0.69, peakRiskMin: 16 }),
]);

/** Two rounds. "Two points do not make a line." */
export const pair: FocusPlanLedger = ledgerOf(drift19_22_20.rounds.slice(0, 2));

/**
 * Twenty rounds across ten days, holding longer over time: 12 → 24 minutes.
 * The one fixture where every trend gate can pass.
 */
export const improving: FocusPlanLedger = ledgerOf(
  Array.from({ length: 20 }, (_, i) =>
    makeRound({
      day: Math.floor(i / 2),
      atMin: (i % 2) * 40,
      plannedFocusMin: 30,
      driftMin: 12 + i * 0.65,
      round: 1,
      countdowns: 1,
    }),
  ),
);

/** Twenty rounds with no direction at all — the same holds, reshuffled. */
export const stationary20: FocusPlanLedger = ledgerOf(
  [18, 21, 17, 22, 19, 20, 18, 23, 17, 21, 19, 22, 18, 20, 21, 17, 22, 19, 20, 18].map((mins, i) =>
    makeRound({
      day: Math.floor(i / 2),
      atMin: (i % 2) * 40,
      plannedFocusMin: 30,
      driftMin: mins,
      round: 1,
      countdowns: 1,
    }),
  ),
);

/**
 * The decided stretch beat: a Kaplan-Meier median of 18, and the newest two
 * rounds held clean to their target. "Held 18 last week, try 21 this week."
 */
export const stretchReady: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, plannedFocusMin: 25, driftMin: 14, countdowns: 1 }),
  makeRound({ day: 1, plannedFocusMin: 25, driftMin: 18, countdowns: 1 }),
  makeRound({ day: 2, plannedFocusMin: 25, driftMin: 18, countdowns: 1 }),
  makeRound({ day: 3, plannedFocusMin: 25, driftMin: 22, countdowns: 1 }),
  makeRound({ day: 4, plannedFocusMin: 18, driftMin: null }),
  makeRound({ day: 5, plannedFocusMin: 18, driftMin: null }),
]);

/**
 * The decided ease beat: a median of 20, and the newest two rounds drifting at
 * 11 and 13 against a planned 20 — well inside the 80% mark.
 */
export const easeReady: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, plannedFocusMin: 20, driftMin: 20, countdowns: 1 }),
  makeRound({ day: 1, plannedFocusMin: 20, driftMin: 20, countdowns: 1 }),
  makeRound({ day: 2, plannedFocusMin: 20, driftMin: 20, countdowns: 1 }),
  makeRound({ day: 3, plannedFocusMin: 20, driftMin: 11, countdowns: 1, kills: 1 }),
  makeRound({ day: 4, plannedFocusMin: 20, driftMin: 13, countdowns: 1 }),
]);

/** Majority-clean: the `censoring-limited` gate's fixture. */
export const censorHeavy: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, driftMin: 12 }),
  makeRound({ day: 1, driftMin: null }),
  makeRound({ day: 2, driftMin: null }),
  makeRound({ day: 3, driftMin: null }),
  makeRound({ day: 4, driftMin: 14 }),
  makeRound({ day: 5, driftMin: null }),
  makeRound({ day: 6, driftMin: null }),
  makeRound({ day: 7, driftMin: null }),
]);

/** First and later rounds mixed, plus the two rows a reader must be able to
 *  find in the evidence: a two-minute clean round, and one that started with
 *  a blocked app already up. */
export const mixedRounds: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, atMin: 0, round: 1, roundsTotal: 4, driftMin: 19, countdowns: 1, kills: 1 }),
  makeRound({ day: 0, atMin: 30, round: 2, roundsTotal: 4, driftMin: 22 }),
  makeRound({ day: 1, atMin: 0, round: 1, roundsTotal: 4, driftMin: null }),
  makeRound({
    day: 1,
    atMin: 31,
    round: 2,
    roundsTotal: 4,
    plannedFocusMin: 25,
    servedMin: 2,
    driftMin: null,
    status: "discarded",
  }),
  makeRound({
    day: 2,
    atMin: 0,
    round: 1,
    roundsTotal: 4,
    driftMin: 0.2,
    startedDrifted: true,
    countdowns: 1,
  }),
]);

/** Ended early with a drift: an event, because a drift you saw is a drift. */
export const abortedWithDrift: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, plannedFocusMin: 25, servedMin: 8, driftMin: 6, status: "aborted", countdowns: 1 }),
]);

/** Ended early and clean, under five minutes: not a measurement. */
export const abortedShort: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, plannedFocusMin: 25, servedMin: 3, driftMin: null, status: "discarded" }),
]);

/** A single clean round — the "no drift at all" case, censored at its length. */
export const cleanOnly: FocusPlanLedger = ledgerOf([
  makeRound({ day: 0, driftMin: null, peakRisk: 0.41, peakRiskMin: 18 }),
]);

export const FIXTURES = {
  fresh,
  single,
  pair,
  clean3,
  cleanOnly,
  drift19_22_20,
  stretchReady,
  easeReady,
  improving,
  stationary20,
  censorHeavy,
  mixedRounds,
  abortedWithDrift,
  abortedShort,
} as const;
