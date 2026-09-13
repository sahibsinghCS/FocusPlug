/**
 * The ledger: reviving it defensively, choosing the estimator window, and
 * turning rounds into the (t, δ) pairs Kaplan-Meier sees.
 *
 * Revive is defensive in the house style — wrong `v`, a non-array `rounds`,
 * NaN offsets, a negative `servedSec`, or any malformed record and that record
 * is dropped, or the ledger starts empty. No throw ever reaches a session
 * start: losing derived data is free, and taking a session down with it is not.
 *
 * `ledgerFromSessionLog` is the second, lossier path to the same shape. It
 * exists so the browser demo and `mockApi` get a REAL data path rather than a
 * hand-written blob, and so the session log stays the audit trail.
 */

import type { Decision, SessionEvent } from "../types";
import {
  PLAN_LEDGER_CAP,
  PLAN_MAX_TICK_GAP_SEC,
  PLAN_WINDOW_DAYS,
  PLAN_WINDOW_ROUNDS,
} from "./constants";
import {
  INITIAL_ONSET_STATE,
  cappedDrifts,
  classifyRound,
  driftTypeOf,
  exclusionReason,
  firstOnsetStartedDrifted,
  holdMinutes,
  isEligibleRound,
  stepOnset,
} from "./drift";
import {
  PLAN_LEDGER_VERSION,
  type FocusPlanLedger,
  type HoldSample,
  type LedgerFromSessionLog,
  type PlanEvidenceRow,
  type PlanRound,
  type PlanRoundStatus,
  type PlanSeedStamp,
} from "./types";

const STATUSES: readonly PlanRoundStatus[] = ["completed", "aborted", "discarded"];

/** A fresh empty ledger. Call it rather than sharing one mutable object. */
export function emptyLedger(): FocusPlanLedger {
  return { v: PLAN_LEDGER_VERSION, lifetimeRounds: 0, rounds: [] };
}

/** Read-only sentinel, for callers that only need to compare or spread. */
export const EMPTY_LEDGER: Readonly<FocusPlanLedger> = Object.freeze({
  v: PLAN_LEDGER_VERSION,
  lifetimeRounds: 0,
  rounds: Object.freeze([]) as readonly PlanRound[] as PlanRound[],
});

function finiteAt(value: unknown, min: number): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= min ? value : null;
}

function optionalFinite(value: unknown, min: number): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return finiteAt(value, min);
}

function isDayKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * One record, validated field by field. Anything that fails returns null and
 * the caller drops the row — a corrupt ledger degrades to a shorter history,
 * never to a crash and never to a wrong number.
 */
export function normalizeRound(raw: unknown): PlanRound | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (r["v"] !== 1) {
    return null;
  }
  const roundKey = typeof r["roundKey"] === "string" && r["roundKey"].length > 0 ? r["roundKey"] : null;
  const startedAt = finiteAt(r["startedAt"], 0);
  const endedAt = finiteAt(r["endedAt"], 0);
  const servedSec = finiteAt(r["servedSec"], 0);
  const plannedFocusSec = finiteAt(r["plannedFocusSec"], 0);
  const round = finiteAt(r["round"], 1);
  const roundsTotal = finiteAt(r["roundsTotal"], 1);
  const hour = finiteAt(r["hour"], 0);
  const status = STATUSES.find((s) => s === r["status"]);

  if (
    roundKey === null ||
    startedAt === null ||
    endedAt === null ||
    servedSec === null ||
    plannedFocusSec === null ||
    round === null ||
    roundsTotal === null ||
    hour === null ||
    hour > 23 ||
    status === undefined ||
    !isDayKey(r["day"])
  ) {
    return null;
  }

  const firstDriftSec = optionalFinite(r["firstDriftSec"], 0);
  const driftsRaw = Array.isArray(r["driftsSec"]) ? (r["driftsSec"] as unknown[]) : [];
  const driftsSec = cappedDrifts(
    driftsRaw.filter((d): d is number => typeof d === "number" && Number.isFinite(d) && d >= 0),
  );
  const driftType = r["firstDriftType"];

  return {
    v: 1,
    roundKey,
    startedAt,
    endedAt,
    day: r["day"],
    hour,
    status,
    servedSec,
    plannedFocusSec,
    round,
    roundsTotal,
    recommendedFocusSec: optionalFinite(r["recommendedFocusSec"], 0),
    acceptedRecommendation: r["acceptedRecommendation"] === true,
    firstDriftSec,
    firstDriftType: driftType === "tab_out" || driftType === "walk_away" ? driftType : null,
    driftsSec,
    firstWobbleSec: optionalFinite(r["firstWobbleSec"], 0),
    wobbles: optionalFinite(r["wobbles"], 0) ?? 0,
    standDowns: optionalFinite(r["standDowns"], 0) ?? 0,
    peakRisk: optionalFinite(r["peakRisk"], 0),
    peakRiskSec: optionalFinite(r["peakRiskSec"], 0),
    firstDriftLeadSec: optionalFinite(r["firstDriftLeadSec"], 0),
    countdowns: optionalFinite(r["countdowns"], 0) ?? 0,
    kills: optionalFinite(r["kills"], 0) ?? 0,
    startedDrifted: r["startedDrifted"] === true,
    forecastOn: r["forecastOn"] === true,
  };
}

/**
 * House copy for a stamp that is present but cannot say what it is. Erring
 * toward disclosure: an unreadable stamp is still a stamp.
 */
export const SEED_FALLBACK_SOURCE = "an unnamed seeding tool";
export const SEED_FALLBACK_NOTE =
  "Seeded demo history: these rounds were written by a seeding tool for filming, not measured on this machine.";

function text(value: unknown, max: number, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }
  const trimmed = value.trim().replace(/\s+/g, " ").slice(0, max);
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * The seed stamp, validated. `null` exactly when the ledger claims no seed —
 * anything present and truthy is seeded, because the failure mode that costs
 * something here is a fabricated ledger that reads as measured, never a
 * measured ledger that reads as fabricated.
 */
export function normalizeSeedStamp(raw: unknown): PlanSeedStamp | null {
  if (!raw) {
    return null;
  }
  const r = typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rounds = finiteAt(r["rounds"], 0);
  return {
    source: text(r["source"], 120, SEED_FALLBACK_SOURCE),
    writtenAt: finiteAt(r["writtenAt"], 0) ?? 0,
    rounds: rounds === null ? 0 : Math.round(rounds),
    note: text(r["note"], 400, SEED_FALLBACK_NOTE),
  };
}

/** Carry a seed stamp onto a rebuilt ledger, and nothing when there is none. */
function withSeed(ledger: FocusPlanLedger, seed: PlanSeedStamp | null | undefined): FocusPlanLedger {
  return seed === null || seed === undefined ? ledger : { ...ledger, seed };
}

export function reviveLedger(raw: unknown): FocusPlanLedger {
  if (typeof raw !== "object" || raw === null) {
    return emptyLedger();
  }
  const r = raw as Record<string, unknown>;
  if (r["v"] !== PLAN_LEDGER_VERSION || !Array.isArray(r["rounds"])) {
    return emptyLedger();
  }
  const rounds: PlanRound[] = [];
  for (const entry of r["rounds"] as unknown[]) {
    const round = normalizeRound(entry);
    if (round !== null) {
      rounds.push(round);
    }
  }
  rounds.sort((a, b) => a.startedAt - b.startedAt);
  const lifetime = finiteAt(r["lifetimeRounds"], 0);
  return withSeed(
    {
      v: PLAN_LEDGER_VERSION,
      lifetimeRounds: Math.max(lifetime ?? 0, rounds.length),
      rounds: rounds.slice(-PLAN_LEDGER_CAP),
    },
    normalizeSeedStamp(r["seed"]),
  );
}

/** Append on round close, oldest-first, capped. Pure — the store does the I/O. */
export function appendRound(ledger: FocusPlanLedger, round: PlanRound): FocusPlanLedger {
  const rounds = [...ledger.rounds.filter((r) => r.roundKey !== round.roundKey), round].sort(
    (a, b) => a.startedAt - b.startedAt,
  );
  // The stamp rides every rewrite: a seeded ledger the student then worked
  // against is still a seeded ledger, and the notice has to survive the round
  // that would otherwise quietly launder it.
  return withSeed(
    {
      v: PLAN_LEDGER_VERSION,
      lifetimeRounds: ledger.lifetimeRounds + 1,
      rounds: rounds.slice(-PLAN_LEDGER_CAP),
    },
    ledger.seed,
  );
}

export interface WindowOptions {
  /** `now` in epoch ms, for the 28-day cut. Omit to take the newest round's
   *  day as the anchor, which is what a pure core with no clock can do. */
  nowMs?: number;
  /** Evidence needs the discarded rows too — a reader who sees 5 rounds in
   *  their history and 3 in the reasoning must be able to find the other two. */
  includeDiscarded?: boolean;
}

/**
 * The estimator window: the newest `PLAN_WINDOW_ROUNDS` rounds that also fall
 * inside `PLAN_WINDOW_DAYS`. Discarded rounds are dropped unless the caller is
 * building the disclosure.
 */
export function selectWindow(
  rounds: readonly PlanRound[],
  options: WindowOptions = {},
): PlanRound[] {
  const kept = rounds.filter((r) => options.includeDiscarded === true || r.status !== "discarded");
  const ordered = [...kept].sort((a, b) => a.startedAt - b.startedAt);
  const newest = ordered[ordered.length - 1];
  const anchor = options.nowMs ?? newest?.startedAt ?? 0;
  const cutoff = anchor - PLAN_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return ordered.filter((r) => r.startedAt >= cutoff).slice(-PLAN_WINDOW_ROUNDS);
}

/** Rounds the estimator is allowed to see: not discarded, not started drifted. */
export function eligibleRounds(rounds: readonly PlanRound[]): PlanRound[] {
  return rounds.filter(isEligibleRound);
}

/**
 * The (t, δ) pairs, and the only place the censoring convention is applied:
 * a drifted round contributes its MUFD as an event, a clean round contributes
 * its served minutes as a right-censored observation. Never the same thing.
 */
export function samplesFrom(rounds: readonly PlanRound[]): HoldSample[] {
  return eligibleRounds(rounds).map((round) => ({
    minutes: holdMinutes(round),
    censored: round.firstDriftSec === null,
    day: round.day,
    round: round.round,
    at: round.startedAt,
  }));
}

/** One row per round in the window, ineligible rows carrying their reason. */
export function evidenceFrom(rounds: readonly PlanRound[]): PlanEvidenceRow[] {
  return [...rounds]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((round) => {
      const excludedBecause = exclusionReason(round);
      return {
        at: round.startedAt,
        day: round.day,
        round: round.round,
        plannedFocusMin: round.plannedFocusSec / 60,
        heldMin: holdMinutes(round),
        censored: round.firstDriftSec === null,
        driftType: round.firstDriftType,
        counted: excludedBecause === null,
        excludedBecause,
      };
    });
}

/* ────────────────────────────────────────────────────────────────────────
 * Rebuilding a ledger from the session log
 * ──────────────────────────────────────────────────────────────────────── */

/** Days-from-civil, run backwards. Pure arithmetic — the core never imports
 *  Date, which is what keeps it environment-agnostic (§5.3). */
export function civilDayUtc(ms: number): { day: string; hour: number } {
  const totalSec = Math.floor(ms / 1000);
  const dayNumber = Math.floor(totalSec / 86_400);
  const secOfDay = totalSec - dayNumber * 86_400;

  const z = dayNumber + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);

  const pad = (n: number): string => (n < 10 ? `0${n}` : `${n}`);
  return { day: `${y}-${pad(m)}-${pad(d)}`, hour: Math.floor(secOfDay / 3600) };
}

/** How a round's local day and hour are stamped. Main passes a local one. */
export type DayStamp = (ms: number) => { day: string; hour: number };

const DECISIONS: readonly Decision[] = ["ON_TASK", "DISTRACTED", "AWAY", "IDLE"];

function decisionOf(detail: string): Decision | null {
  const head = detail.split(" ")[0] ?? "";
  return DECISIONS.find((d) => d === head) ?? null;
}

/**
 * The lossier path to a ledger: replay the session log.
 *
 * The log has everything the metric needs — `session`, `decision`, `countdown`
 * and `kill` rows are all already written — but it has no planned length and
 * no served/wall distinction, so a rebuilt round is censored at its wall
 * length and every round is `round: 1` of 1. It is right for the demo, for
 * `mockApi`, and as a backstop; the ledger file is what the app measures from.
 *
 * `MAX_SESSION_LOG` trims oldest-first, which is precisely the history a
 * 28-day trend needs — which is why this is the backstop and not the store.
 */
export function ledgerFromSessionLog(
  events: readonly SessionEvent[],
  stamp: DayStamp = civilDayUtc,
): FocusPlanLedger {
  const ordered = [...events].sort((a, b) => a.ts - b.ts);
  const rounds: PlanRound[] = [];

  let startedAt: number | null = null;
  let onsets = INITIAL_ONSET_STATE;
  let startedDrifted = false;
  let sawStatus = false;
  let firstDriftType: PlanRound["firstDriftType"] = null;
  let countdowns = 0;
  let kills = 0;
  let lastTs = 0;

  const close = (endedAt: number): void => {
    if (startedAt === null) {
      return;
    }
    const servedSec = Math.max(0, (endedAt - startedAt) / 1000);
    const firstDriftSec = onsets.onsetsSec[0] ?? null;
    const stamped = stamp(startedAt);
    const status = classifyRound({
      servedSec,
      plannedFocusSec: servedSec,
      firstDriftSec,
      sawStatus,
    });
    rounds.push({
      v: 1,
      roundKey: `log-${startedAt}`,
      startedAt,
      endedAt,
      day: stamped.day,
      hour: stamped.hour,
      status,
      servedSec,
      plannedFocusSec: servedSec,
      round: 1,
      roundsTotal: 1,
      recommendedFocusSec: null,
      acceptedRecommendation: false,
      firstDriftSec,
      firstDriftType,
      driftsSec: cappedDrifts(onsets.onsetsSec),
      firstWobbleSec: null,
      wobbles: 0,
      standDowns: 0,
      peakRisk: null,
      peakRiskSec: null,
      firstDriftLeadSec: null,
      countdowns,
      kills,
      startedDrifted,
      forecastOn: false,
    });
    startedAt = null;
    onsets = INITIAL_ONSET_STATE;
    startedDrifted = false;
    sawStatus = false;
    firstDriftType = null;
    countdowns = 0;
    kills = 0;
  };

  for (const event of ordered) {
    lastTs = event.ts;
    if (event.kind === "session") {
      if (event.detail.startsWith("Session started")) {
        close(event.ts);
        startedAt = event.ts;
      } else if (event.detail.startsWith("Session stopped")) {
        close(event.ts);
      }
      continue;
    }
    if (startedAt === null) {
      continue;
    }
    if (event.kind === "decision") {
      const decision = decisionOf(event.detail);
      if (decision === null) {
        continue;
      }
      sawStatus = true;
      // Wall seconds. The recorder's served clock does not exist in the log,
      // and inventing one would be worse than saying so in this comment.
      const tSec = (event.ts - startedAt) / 1000;
      const next = stepOnset(onsets, decision, tSec);
      if (firstOnsetStartedDrifted(onsets, next)) {
        startedDrifted = true;
      }
      if (next.onsetsSec.length > onsets.onsetsSec.length && firstDriftType === null) {
        firstDriftType = driftTypeOf(decision);
      }
      onsets = next;
      continue;
    }
    if (event.kind === "countdown" && event.detail.startsWith("start_countdown")) {
      countdowns += 1;
      continue;
    }
    if (event.kind === "kill") {
      kills += 1;
    }
  }
  close(lastTs);

  return {
    v: PLAN_LEDGER_VERSION,
    lifetimeRounds: rounds.length,
    rounds: rounds.slice(-PLAN_LEDGER_CAP),
  };
}

/** The exported reducer matches the frozen `LedgerFromSessionLog` contract. */
export const LEDGER_FROM_SESSION_LOG: LedgerFromSessionLog = ledgerFromSessionLog;

/**
 * Served seconds, accumulated one tick at a time with each delta clamped.
 * A suspend, a lid close or a coffee break cannot inflate the number that is
 * supposed to mean "how long you can work".
 */
export function accumulateServed(servedSec: number, deltaSec: number): number {
  if (!Number.isFinite(deltaSec) || deltaSec <= 0) {
    return servedSec;
  }
  return servedSec + Math.min(deltaSec, PLAN_MAX_TICK_GAP_SEC);
}
