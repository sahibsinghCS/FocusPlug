import type { Decision, SessionEvent } from "../types";
import type { DriftType } from "../forecast/types";

/* ────────────────────────────────────────────────────────────────────────
 * Session arm context — what the renderer tells main when a focus block
 * arms enforcement. Rides SESSION_START as one optional argument, and is
 * consumed in src/main/index.ts by FocusPlan.declareRound — the session
 * controller never sees it, so Focus Plan has no seam into the fuse.
 * ──────────────────────────────────────────────────────────────────────── */

/** What the run clock knows. Supplied by useSessionTimer's onEnforce. */
export interface SessionArmContext {
  /** `${plan startedAtMs}-${segment index}`. Pause/resume reuse the same key. */
  roundKey: string;
  /** 1-based focus block inside the plan. */
  round: number;
  roundsTotal: number;
  /** This block's planned work, in seconds. */
  plannedFocusSec: number;
  /** The break after it, in seconds; 0 when this block ends the plan. */
  plannedBreakSec: number;
}

/** SessionArmContext plus what Focus Plan offered, if it offered anything. */
export interface SessionPlanContext extends SessionArmContext {
  /** What Focus Plan recommended for this block, or null if it did not. */
  recommendedFocusSec: number | null;
  /** True when the Dial matched that offer when the switch was thrown. */
  acceptedRecommendation: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * The recorded round — the unit of observation
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanRoundStatus = "completed" | "aborted" | "discarded";

/**
 * One focus round, as measured. ALL offsets are SERVED seconds (pause time
 * excluded, each tick delta clamped to PLAN_MAX_TICK_GAP_SEC), never wall
 * seconds — that is the only definition under which the number means "how
 * long you can work".
 */
export interface PlanRound {
  v: 1;
  roundKey: string;
  /** Epoch ms of the first arm. */
  startedAt: number;
  /** Epoch ms of the last disarm. */
  endedAt: number;
  /** Local "YYYY-MM-DD" of startedAt, stamped in MAIN so the pure core
   *  never touches Date. The trend's day-spread key. */
  day: string;
  /** Local hour 0-23 of startedAt, also stamped in main. */
  hour: number;
  status: PlanRoundStatus;
  servedSec: number;
  plannedFocusSec: number;
  round: number;
  roundsTotal: number;
  recommendedFocusSec: number | null;
  acceptedRecommendation: boolean;
  /** MUFD in served seconds; null when the round ran clean (censored). */
  firstDriftSec: number | null;
  firstDriftType: DriftType | null;
  /** Every kept onset, debounced by DRIFT_DEBOUNCE_SEC, capped at
   *  PLAN_MAX_DRIFTS_PER_ROUND. */
  driftsSec: number[];
  /** First forecast_nudge in this round. A WARNING, never a drift. */
  firstWobbleSec: number | null;
  wobbles: number;
  /** Pre-arms that cleared without a drift — reported as stand-downs. */
  standDowns: number;
  /** null when the forecast was off or never warmed. */
  peakRisk: number | null;
  peakRiskSec: number | null;
  /** forecast_hit lead, when the forecast called this round's first drift. */
  firstDriftLeadSec: number | null;
  countdowns: number;
  kills: number;
  /** The round began with a blocked app already up: measures window layout,
   *  not attention. Recorded, disclosed, excluded from the estimator. */
  startedDrifted: boolean;
  forecastOn: boolean;
}

/**
 * The round currently running, built in the RENDERER from timer.position and
 * AppState.forecast/forecastEvents. Never persisted, never pushed from main.
 * Its only job is to make the wobble rung reachable inside the first round of
 * a fresh install, which is what feeds `reviseBreak`.
 */
export interface LivePlanRound {
  roundKey: string;
  startedAt: number;
  plannedFocusSec: number;
  servedSec: number;
  firstDriftSec: number | null;
  firstWobbleSec: number | null;
  peakRisk: number | null;
  peakRiskSec: number | null;
  forecastOn: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * Streaming drift detection — equivalent to findDriftOnsets, by test
 * ──────────────────────────────────────────────────────────────────────── */

export interface OnsetState {
  last: Decision | null;
  onsetsSec: number[];
  /** True once a non-IDLE, non-drifted decision has been seen. */
  sawClean: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * The estimator
 * ──────────────────────────────────────────────────────────────────────── */

/** One (t, δ) pair. The Kaplan-Meier estimator sees only these. */
export interface HoldSample {
  /** Minutes held: MUFD when uncensored, served minutes when censored. */
  minutes: number;
  /** True when the round ended with no drift — the true hold is >= minutes. */
  censored: boolean;
  /** Local calendar day key, for the trend's day-spread gate. */
  day: string;
  /** 1-based focus round inside its plan, for the like-for-like rule. */
  round: number;
  /** Round start, epoch ms — the ordering key for the split-half. */
  at: number;
}

export interface SurvivalStep {
  minutes: number;
  events: number;
  atRisk: number;
  survival: number;
}

export interface SurvivalCurve {
  steps: SurvivalStep[];
  /** min{ t : S(t) <= 0.5 }, or null when the curve never reaches a half. */
  medianMin: number | null;
  /** Longest observed hold, event or censored. The honest floor. */
  lowerBoundMin: number | null;
  events: number;
  censored: number;
}

export type PlanRung =
  | "no-history"
  | "wobble-only"
  | "censored-only"
  | "single"
  | "pair"
  | "measured";

export type PlanRefusal = "no-rounds" | "all-censored" | "forecast-off";

export interface PlanEstimate {
  rung: PlanRung;
  /** Kaplan-Meier median in minutes; null = refused. */
  medianMin: number | null;
  /** Longest observed hold (event or censored); null when nothing observed. */
  lowerBoundMin: number | null;
  /** Derived from a forecast wobble, not a drift. Never steps the target,
   *  never enters the trend window, never satisfies a confidence gate. */
  provisional: boolean;
  /** min(1, roundsInWindow / PLAN_CONFIDENCE_ROUNDS), mirroring adapt's own
   *  bar rather than inventing a second. REPORTED FOR INSPECTION ONLY — no
   *  surface reads it today: the copy hedges off `rung`, the trend gates off
   *  its own counts, and it never moves the number. */
  trust: number;
  /** Eligible rounds in the window (excludes discarded and startedDrifted). */
  rounds: number;
  /** Completed eligible rounds — the `censored-only` stretch gate reads this. */
  completedRounds: number;
  /** Uncensored observations. */
  events: number;
  censored: number;
  /** Distinct local calendar days represented by the events. */
  days: number;
  /** Last <= 5 uncensored holds, chronological, for the reasoning sentence. */
  recentHoldsMin: number[];
  /** max(holdMin) over the window — feeds the +PLAN_MAX_REACH_MIN cap. */
  bestHeldMin: number | null;
  refusal: PlanRefusal | null;
  /** Named method, rendered verbatim on screen. Never empty. */
  method: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * The trend — seven gates, and it names the one that stopped it
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanTrendDirection = "up" | "down" | "flat" | "unknown";
export type PlanTrendConfidence = "none" | "weak" | "clear";

export type PlanTrendGate =
  | "too-few-events"        // < PLAN_TREND_MIN_EVENTS            -> none
  | "too-few-days"          // < PLAN_TREND_MIN_DAYS              -> none
  | "lopsided-halves"       // a half has < PLAN_TREND_MIN_HALF   -> none
  | "censoring-limited"     // censored fraction > the max        -> none
  | "below-noise"           // |delta| under the noise floor      -> weak
  | "sign-disagreement"     // half-split disagrees with Theil-Sen-> weak
  | "unstable";             // leave-one-out flips the direction  -> weak

export interface PlanTrend {
  direction: PlanTrendDirection;
  confidence: PlanTrendConfidence;
  /** Theil-Sen slope, minutes per round. STRUCTURALLY NULL unless
   *  confidence === "clear": the UI has no path to an unearned direction. */
  slopeMinPerRound: number | null;
  olderMedianMin: number | null;
  newerMedianMin: number | null;
  /** IQR of the window's holds — the student's own noise floor. */
  spreadMin: number | null;
  events: number;
  days: number;
  /** True when the comparison used round-1 rounds only (like-for-like). */
  roundOneOnly: boolean;
  /** The first gate that failed, or null when all seven passed. */
  blockedBy: PlanTrendGate | null;
  /** Named method, rendered verbatim. Carries the like-for-like caveat. */
  method: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * The recommendation
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanStep = "stretch" | "hold" | "ease";

/** One row of the "Why this?" disclosure. Ineligible rows are shown greyed
 *  with their reason: 5 rounds in history and 3 in the reasoning must always
 *  reconcile on screen. */
export interface PlanEvidenceRow {
  at: number;
  day: string;
  round: number;
  plannedFocusMin: number;
  /** MUFD when drifted, served minutes when censored. */
  heldMin: number;
  censored: boolean;
  driftType: DriftType | null;
  counted: boolean;
  /** Why it does not count. Null exactly when counted is true. */
  excludedBecause: string | null;
}

export interface PlanRecommendation {
  focusMin: number;
  breakMin: number;
  step: PlanStep;
  /** The base before the step was applied. */
  baseMin: number;
  estimate: PlanEstimate;
  trend: PlanTrend;
  /** Nothing here is measured from this user. */
  cold: boolean;
  evidence: PlanEvidenceRow[];
  copy: PlanCardCopy;
}

/* ────────────────────────────────────────────────────────────────────────
 * The debrief
 * ──────────────────────────────────────────────────────────────────────── */

export interface PlanDebrief {
  round: PlanRound;
  /** Recomputed WITH this round folded in. */
  next: PlanRecommendation;
  /** MUFD in minutes, or null when censored. */
  heldMin: number | null;
  censored: boolean;
  /** Median gap between onsets; null with fewer than 2. */
  rhythmMin: number | null;
  /** Not counted toward history (too short / started drifted / discarded). */
  notCounted: boolean;
  /** Sparkline series: the window's holds, oldest first. */
  series: Array<{ at: number; minutes: number; censored: boolean }>;
  copy: PlanDebriefCopy;
}

/* ────────────────────────────────────────────────────────────────────────
 * The mid-session revision — computed in the RENDERER; src/shared/nudge.ts
 * and src/main/** are untouched by this surface. It returns a string.
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanRevisionKind = "earlier" | "later";

export interface PlanReviseInput {
  /** Seconds into the current focus block. */
  elapsedSec: number;
  /** Seconds left in the current focus block. */
  remainingSec: number;
  estimateMin: number | null;
  /** A real forecast_nudge or forecast_prearm fired this block. */
  wobbled: boolean;
  /** Smoothed risk, or null when the forecast is off. */
  risk: number | null;
  /** settings.forecastNudgeRisk. */
  nudgeRisk: number;
  /** HARD GUARD: a nudge during a burning fuse is about the fuse. */
  countdownActive: boolean;
}

export interface PlanRevision {
  kind: PlanRevisionKind;
  plannedBreakInSec: number;
  suggestedBreakInSec: number;
  copy: PlanRevisionCopy;
}

/* ────────────────────────────────────────────────────────────────────────
 * Copy — every user-visible string is produced in src/shared/plan/copy.ts,
 * so it is testable without a DOM and identical in the browser demo.
 * ──────────────────────────────────────────────────────────────────────── */

export interface PlanCardCopy {
  /** "FOCUS PLAN · measured · 6 rounds" */
  kicker: string;
  /** "20 minutes of work, then 4 off." */
  headline: string;
  reasoning: string;
  /** One sentence, or null when there is nothing to say about direction. */
  trendLine: string | null;
  /** Present whenever settings.forecastEnabled is false. */
  forecastNote: string | null;
  /** Rendered verbatim under "Why this?". Never empty. */
  method: string;
  acceptLabel: string;
  /** The never-enforced line. Present in every variant. */
  overrideLine: string;
}

export interface PlanDebriefCopy {
  kicker: string;
  headline: string;
  /** null when the forecast was off or never warmed. */
  whereItWent: string | null;
  /** null when fewer than 2 onsets. */
  rhythm: string | null;
  /** Fuses burned / apps killed; null when nothing burned. */
  cost: string | null;
  /** ALWAYS present — the metric and what was and was not measured. */
  theNumber: string;
  nextRound: string;
  /** Present exactly when notCounted is true. */
  notCountedLine: string | null;
}

export interface PlanRevisionCopy {
  line: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Wire + main-process shapes
 * ──────────────────────────────────────────────────────────────────────── */

export const PLAN_LEDGER_VERSION = 1;

/**
 * Fabricated history, stamped by a seeding tool — today only
 * `scripts/demo-seed.ts` (`npm run demo:seed`), which writes a plausible
 * multi-day ledger so the plan card has something to say on a clean machine
 * while a demo is being filmed.
 *
 * The recorder NEVER writes one. Its presence therefore means exactly one
 * thing: those rounds were WRITTEN, not measured on this machine. That is why
 * it belongs to the ledger shape rather than to a sidecar file, why
 * `reviveLedger` keeps it and `appendRound` carries it forward across every
 * rewrite, and why `PlanRecorder` prints it into the session log — seeded
 * history must not be able to age quietly into measurement.
 *
 * `normalizeSeedStamp` treats ANY present, truthy `seed` as seeded and fills
 * in house copy for the fields it cannot read: a half-written stamp is still a
 * disclosure, and the one failure it must never have is dropping the label.
 */
export interface PlanSeedStamp {
  /** The command that wrote it, e.g. "npm run demo:seed". Never empty. */
  source: string;
  /** Epoch ms the seed was written, or 0 when the stamp did not say. */
  writtenAt: number;
  /** How many of the ledger's rounds were fabricated. */
  rounds: number;
  /** Rendered verbatim wherever the notice is shown. Never empty. */
  note: string;
}

/** On-disk shape of <userData>/focus-plan.json. */
export interface FocusPlanLedger {
  v: typeof PLAN_LEDGER_VERSION;
  lifetimeRounds: number;
  /** Oldest first, capped at PLAN_LEDGER_CAP. */
  rounds: PlanRound[];
  /** Present ONLY on a ledger a seeding tool wrote; absent on every ledger the
   *  recorder produces, and cleared by PLAN_RESET along with the rounds. */
  seed?: PlanSeedStamp;
}

/** PLAN_GET_STATE payload. Closed rounds only — the live round is built
 *  renderer-side, so main never has to stream one. */
export interface FocusPlanState {
  v: 1;
  /** False exactly when focusPlanEnabled is off — the surfaces render nothing.
   *  NOT the filming pin: FOCUSPLUG_NO_PLAN=1 reports enabled with an empty
   *  window, so the cards stay up on the cold-start rung. */
  enabled: boolean;
  /** The estimator window, oldest first. Empty under the filming pin. */
  rounds: PlanRound[];
  /** Rounds ever recorded, for the Settings reset offer. 0 under the pin,
   *  which never reads the ledger it is hiding. */
  lifetimeRounds: number;
}

/** Main-process fan-out. SessionPush and ForecastPush are NOT modified. */
export interface PlanPush {
  round(round: PlanRound): void;
}

/** The push-facing handlers of the recorder (structural, test-friendly),
 *  mirroring ForecastTap in src/main/forecast/tap.ts. */
export interface PlanTap {
  onSessionState(state: import("../ipc").SessionState): void;
  onPolicyEvent(event: import("../types").PolicyEvent): void;
  onForecastSnapshot(snap: import("../forecast/types").ForecastSnapshot): void;
  onForecastEvent(event: import("../forecast/types").ForecastEvent): void;
}

/** Pure reducer that rebuilds a ledger from the session log, so the browser
 *  demo and mockApi get a real data path and the log is the audit trail. */
export type LedgerFromSessionLog = (events: readonly SessionEvent[]) => FocusPlanLedger;
