export const PLAN_MODEL_VERSION = "fp-1";

/* ── estimator window ───────────────────────────────────────────────── */
export const PLAN_WINDOW_ROUNDS = 20;
export const PLAN_WINDOW_DAYS = 28;
export const PLAN_LEDGER_CAP = 200;

/* ── what counts as a round ─────────────────────────────────────────── */
/** Five minutes is not a measurement. Applies to CLEAN rounds only —
 *  a short round WITH a drift is real, informative data and is kept. */
export const PLAN_MIN_ROUND_SEC = 300;
export const PLAN_COMPLETE_SLACK_SEC = 5;
/** Per-tick clamp: a suspend or a coffee break cannot inflate servedSec. */
export const PLAN_MAX_TICK_GAP_SEC = 5;
export const PLAN_MAX_DRIFTS_PER_ROUND = 12;
/** A first onset inside this window, with no clean non-IDLE decision before
 *  it, means the round STARTED drifted. This is a ROUND-ELIGIBILITY rule;
 *  the drift definition itself is untouched. */
export const PLAN_STARTED_DRIFTED_SEC = 20;
/** servedSec beyond this multiple of the plan means the clock jumped. */
export const PLAN_RUNAWAY_FACTOR = 3;

/* ── trust (mirrors adapt's own bar, rather than inventing a second) ── */
export const PLAN_CONFIDENCE_ROUNDS = 6;

/* ── trend gates ────────────────────────────────────────────────────── */
export const PLAN_TREND_MIN_EVENTS = 6;
export const PLAN_TREND_MIN_DAYS = 3;
export const PLAN_TREND_MIN_HALF = 3;
export const PLAN_TREND_MIN_DELTA_MIN = 2;
export const PLAN_TREND_NOISE_FACTOR = 0.5;
export const PLAN_TREND_MAX_CENSORED_FRACTION = 0.5;
/** Round-1 events needed before the trend compares like with like. */
export const PLAN_TREND_ROUND1_MIN_EVENTS = 6;

/* ── progression ────────────────────────────────────────────────────── */
export const PLAN_DEFAULT_FOCUS_MIN = 25;
export const PLAN_MIN_FOCUS_MIN = 10;
export const PLAN_MAX_FOCUS_MIN = 90;
export const PLAN_STRETCH_MIN = 3;
export const PLAN_BACKOFF_MIN = 3;
export const PLAN_STRETCH_STREAK = 2;
export const PLAN_EARLY_DRIFT_FRACTION = 0.8;
/** The plan can climb but never leap: best held + 10, hard cap. */
export const PLAN_MAX_REACH_MIN = 10;
/** Completed rounds needed before `censored-only` goes looking for the edge. */
export const PLAN_CENSORED_STRETCH_MIN_ROUNDS = 2;

/* ── break: SHAPES parity ────────────────────────────────────────────
 * round(focusMin / 5) clamped [3, 15] reproduces all three shipped shapes
 * exactly — Classic 25/5, Deep work 50/10, Sprint 15/3. It gives a 20-minute
 * block a 4-minute break, not the 5 in the brief's illustrative sentence.
 * That divergence is deliberate and argued in the design doc: a 5-minute
 * floor makes the app's own Sprint shape unreachable by its own recommender.
 * Setting PLAN_MIN_BREAK_MIN = 5 restores the example, at that cost.
 * ──────────────────────────────────────────────────────────────────── */
export const PLAN_BREAK_RATIO = 5;
export const PLAN_MIN_BREAK_MIN = 3;
export const PLAN_MAX_BREAK_MIN = 15;

/* ── mid-session revision ───────────────────────────────────────────── */
export const PLAN_REVISE_MIN_ELAPSED_FRACTION = 0.6;
export const PLAN_REVISE_MIN_DELTA_SEC = 180;
/** The suggested early break is never "now": three minutes is a break you
 *  walk to, not a fuse you dodge. */
export const PLAN_REVISE_EARLY_SEC = 180;
export const PLAN_REVISE_LATE_SEC = 120;
export const PLAN_REVISE_EXTEND_SEC = 300;
export const PLAN_REVISE_CALM_FRACTION = 0.6;

/* ── debrief ────────────────────────────────────────────────────────── */
export const PLAN_DEBRIEF_FRESH_MS = 30 * 60_000;

/* ── gauntlet ───────────────────────────────────────────────────────── */
export const PLAN_GAUNTLET_SEED = 20260913;
/** CI gate: on a STATIONARY population the trend must report "clear" in
 *  fewer than this fraction of runs, or the build fails. */
export const PLAN_GAUNTLET_MAX_FALSE_TREND = 0.05;
