export {
  PLAN_BACKOFF_MIN,
  PLAN_BREAK_RATIO,
  PLAN_CENSORED_STRETCH_MIN_ROUNDS,
  PLAN_COMPLETE_SLACK_SEC,
  PLAN_CONFIDENCE_ROUNDS,
  PLAN_DEBRIEF_FRESH_MS,
  PLAN_DEFAULT_FOCUS_MIN,
  PLAN_EARLY_DRIFT_FRACTION,
  PLAN_GAUNTLET_MAX_FALSE_TREND,
  PLAN_GAUNTLET_SEED,
  PLAN_LEDGER_CAP,
  PLAN_MAX_BREAK_MIN,
  PLAN_MAX_DRIFTS_PER_ROUND,
  PLAN_MAX_FOCUS_MIN,
  PLAN_MAX_REACH_MIN,
  PLAN_MAX_TICK_GAP_SEC,
  PLAN_MIN_BREAK_MIN,
  PLAN_MIN_FOCUS_MIN,
  PLAN_MIN_ROUND_SEC,
  PLAN_MODEL_VERSION,
  PLAN_REVISE_CALM_FRACTION,
  PLAN_REVISE_EARLY_SEC,
  PLAN_REVISE_EXTEND_SEC,
  PLAN_REVISE_LATE_SEC,
  PLAN_REVISE_MIN_DELTA_SEC,
  PLAN_REVISE_MIN_ELAPSED_FRACTION,
  PLAN_RUNAWAY_FACTOR,
  PLAN_STARTED_DRIFTED_SEC,
  PLAN_STRETCH_MIN,
  PLAN_STRETCH_STREAK,
  PLAN_TREND_MAX_CENSORED_FRACTION,
  PLAN_TREND_MIN_DAYS,
  PLAN_TREND_MIN_DELTA_MIN,
  PLAN_TREND_MIN_EVENTS,
  PLAN_TREND_MIN_HALF,
  PLAN_TREND_NOISE_FACTOR,
  PLAN_TREND_ROUND1_MIN_EVENTS,
  PLAN_WINDOW_DAYS,
  PLAN_WINDOW_ROUNDS,
} from "./constants";

export { PLAN_LEDGER_VERSION } from "./types";
export type {
  FocusPlanLedger,
  FocusPlanState,
  HoldSample,
  LedgerFromSessionLog,
  LivePlanRound,
  OnsetState,
  PlanCardCopy,
  PlanDebrief,
  PlanDebriefCopy,
  PlanEstimate,
  PlanEvidenceRow,
  PlanPush,
  PlanRecommendation,
  PlanRefusal,
  PlanRevision,
  PlanRevisionCopy,
  PlanRevisionKind,
  PlanReviseInput,
  PlanRound,
  PlanRoundStatus,
  PlanRung,
  PlanSeedStamp,
  PlanStep,
  PlanTap,
  PlanTrend,
  PlanTrendConfidence,
  PlanTrendDirection,
  PlanTrendGate,
  SessionArmContext,
  SessionPlanContext,
  SurvivalCurve,
  SurvivalStep,
} from "./types";

export {
  INITIAL_ONSET_STATE,
  cappedDrifts,
  classifyRound,
  detectStartedDrifted,
  driftTypeOf,
  exclusionReason,
  firstOnsetStartedDrifted,
  foldOnsets,
  holdMinutes,
  isEligibleRound,
  stepOnset,
} from "./drift";
export type { RoundOutcomeInput } from "./drift";

export { kaplanMeier, survivalAt } from "./survival";

export { iqr, leastSquaresSlope, median, planTrend, survivesLeaveOneOut, theilSen } from "./trend";

export {
  EMPTY_LEDGER,
  LEDGER_FROM_SESSION_LOG,
  SEED_FALLBACK_NOTE,
  SEED_FALLBACK_SOURCE,
  accumulateServed,
  appendRound,
  civilDayUtc,
  eligibleRounds,
  emptyLedger,
  evidenceFrom,
  ledgerFromSessionLog,
  normalizeRound,
  normalizeSeedStamp,
  reviveLedger,
  samplesFrom,
  selectWindow,
} from "./ledger";
export type { DayStamp, WindowOptions } from "./ledger";

export { planEstimate } from "./estimate";
export type { EstimateInput } from "./estimate";

export { baseFor, breakFor, driftedEarly, heldToTarget, recommend, stepFor } from "./progression";
export type { RecommendInput } from "./progression";

export { debriefFor, rhythmMinutes } from "./debrief";
export type { DebriefInput } from "./debrief";

export { reviseBreak } from "./revise";

export {
  retractLastAwayDrift,
  retractedNote,
  retractionLogLine,
  retractionNotice,
} from "./retract";
export type { RetractInput, RetractOutcome } from "./retract";

export {
  FORECAST_OFF_NOTE,
  holdSparkCaption,
  minutesList,
  minutesText,
  planCardCopy,
  planDebriefCopy,
  planRevisionCopy,
  seedNotice,
  trendLine,
} from "./copy";
export type { PlanCardCopyInput, PlanDebriefCopyInput, PlanRevisionCopyInput } from "./copy";
