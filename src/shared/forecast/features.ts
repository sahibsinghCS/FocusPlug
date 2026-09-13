import type { TelemetryFrame, Transition, TelemetryRing } from "./ring";
import { FORECAST_FEATURE_KEYS, type ForecastFeatureKey } from "./types";

/**
 * `extractFeatures(ring, ts)` — the identical pure function runs in the
 * trainer, the simulator's dataset build, and runtime inference, so
 * train/serve skew is killed by construction.
 *
 * Every encoded value lands in [0, 1]; missing data encodes to defined
 * neutrals (webcam off ⇒ 0.5 / 0.5 / 0 / 0 for the desk features), never NaN.
 * Windows are `(ts − w, ts]` — features at `t` use samples ≤ `t` only, which
 * is the leakage rule the offline labeler depends on.
 *
 * ## Two blocks: LEVELS (0–17) and TRENDS (18–23)
 *
 * Features 0–17 are all LEVELS over one fixed window: a count, a fraction, a
 * mean, a σ. A window mean is exactly the statistic that destroys a trend — a
 * desk confidence sliding 0.90 → 0.50 across 30 s and one sitting flat at 0.70
 * have the same `deskConfMean30`, and the model cannot tell "about to leave"
 * from "sitting still". The bake-off measured that loss: the hybrid
 * contender's ablation ladder moved a plain logistic 0.9325 → 0.9408 using only
 * extras read off this same ring, more than any hidden layer anyone tried
 * (`scripts/forecast/GAUNTLET.md`, round 9).
 *
 * Features 18–23 are that trend block: a slope, two short-vs-long rate ratios,
 * a leaky occupancy, a run length and a two-window drop. Every one reads the
 * SAME `TelemetryRing` public API as the level block — the 600-frame ring, the
 * 128-transition list, the session scalars. No new telemetry, no new
 * permission, no new IPC, and nothing that is not already on the machine.
 *
 * Selection ran on TRAIN-split sessions only, in two passes recorded in
 * `data/forecast/feature-mine.json` and `feature-confirm.json`: backward
 * elimination on an additive logistic (the conservative test — a feature that
 * cannot pay for one column should not be handed d+1), then a confirmation on
 * the shipped pairwise basis for the survivors and the bake-off's nominees.
 * Seven further candidates were tested and rejected; they are listed with
 * their numbers in `scripts/forecast/GAUNTLET.md` round 9.
 */

/** ε in `(rate15 + ε)/(rate60 + ε)` — keeps the ratio 1 on a quiet ring. */
export const SWITCH_ACCEL_EPS = 0.01;

/** Neutral encoding for desk features when no webcam-on frame is in window. */
export const DESK_NEUTRAL = 0.5;

/**
 * Minimum webcam-on frames before a desk TREND is estimated at all. A slope or
 * a two-window difference over four noisy samples is noise with a direction;
 * below this the feature reads its "no evidence" value of 0.
 */
export const DESK_TREND_MIN_FRAMES = 5;

/**
 * Desk-sag full scale, in confidence lost per MINUTE. 1.2/min = 0.02/s = the
 * whole 0..1 confidence range gone in 50 s, which is the steepest real
 * departure ramp the simulator produces. Human units are per-minute because
 * the prompt serialization (`lib.fmtNum`) keeps two decimals, and a
 * per-SECOND slope would round 0.012 to 0.01 and lose a tenth of the signal.
 */
export const DESK_SAG_FULL_SCALE_PER_MIN = 1.2;

/** Full scale for `deskConfDrop120`: 0.4 confidence lost vs two minutes ago. */
export const DESK_DROP_FULL_SCALE = 0.4;

/** Leaky grey-occupancy time constant, seconds — the hazard's own driver. */
export const GREY_LEAK_TAU_SEC = 120;

export interface FeatureExtraction {
  /** Human-unit values keyed by feature (e.g. 6 switches, 18 s). */
  raw: Record<ForecastFeatureKey, number>;
  /** Encoded [0,1] values in `FORECAST_FEATURE_KEYS` order, pre-normalization. */
  values: number[];
}

/** `L(x, c) = log1p(x)/log1p(c)` clamped to [0, 1]. */
export function logCompress(x: number, cap: number): number {
  if (!Number.isFinite(x) || x <= 0) {
    return 0;
  }
  return Math.min(Math.log1p(x) / Math.log1p(cap), 1);
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) {
    return 0;
  }
  if (x < 0) {
    return 0;
  }
  if (x > 1) {
    return 1;
  }
  return x;
}

function fraction(count: number, total: number): number {
  if (total <= 0) {
    return 0;
  }
  return count / total;
}

/**
 * `(short + ε)/(long + ε)` on per-second rates — exactly 1 on a quiet ring, so
 * "no evidence" and "no acceleration" encode to the same defined neutral, and
 * never NaN even when both windows are empty.
 */
function rateRatio(
  shortCount: number,
  shortSec: number,
  longCount: number,
  longSec: number,
): number {
  const ratio =
    (shortCount / shortSec + SWITCH_ACCEL_EPS) / (longCount / longSec + SWITCH_ACCEL_EPS);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function extractFeatures(ring: TelemetryRing, ts: number): FeatureExtraction {
  // One ring sweep for frames, one for transitions; every window below is a
  // filter over those two arrays, so the trend block costs no extra ring scan.
  const frames600 = ring.framesInRange(ts - 600_000, ts);
  const transitions600 = ring.transitionsInRange(ts - 600_000, ts);
  const inWindow = <T extends { ts: number }>(items: readonly T[], sec: number): T[] =>
    items.filter((item) => item.ts > ts - sec * 1000);

  const frames60 = inWindow(frames600, 60);
  const frames30 = inWindow(frames60, 30);
  const procAll = transitions600.filter((transition) => transition.kind === "proc");
  const titleAll = transitions600.filter((transition) => transition.kind === "title");
  const proc15 = inWindow(procAll, 15).length;
  const proc30 = inWindow(procAll, 30).length;
  const proc60 = inWindow(procAll, 60).length;
  const proc90 = inWindow(procAll, 90).length;
  const title30 = inWindow(titleAll, 30).length;
  const title60 = inWindow(titleAll, 60).length;

  // Switch acceleration: 15 s rate vs 60 s rate, in switches/second.
  const accel = rateRatio(proc15, 15, proc60, 60);

  // Dwell on the current window, allow streak, block recency — all seconds.
  const dwellStart = ring.currentProcSince;
  const dwellSec = dwellStart === null ? 0 : Math.max(0, (ts - dwellStart) / 1000);
  const streakStart = ring.streakStartTs;
  const streakSec = streakStart === null ? 0 : Math.max(0, (ts - streakStart) / 1000);
  const blockTs = ring.lastBlockFocusTs;
  const sinceBlockSec =
    blockTs === null ? 600 : Math.min(Math.max(0, (ts - blockTs) / 1000), 600);

  // Focus-mix fractions over the frame windows (1 frame = 1 s).
  const allow60 = frames60.filter((frame) => frame.focusKind === "allow").length;
  const other60 = frames60.filter((frame) => frame.focusKind === "other").length;
  const otherDwell30 = frames30.filter((frame) => frame.focusKind === "other").length;

  // Distinct process keys focused in the last 60 s: frame keys plus both ends
  // of every proc transition (fast switches never land in a 1 Hz frame),
  // plus the current window.
  const distinct = processKeysIn(frames60, inWindow(procAll, 60), ring.currentProcessKey);

  // Desk features use webcam-on frames only; none in window ⇒ neutral.
  const desk30 = frames30.filter((frame) => frame.webcamEnabled);
  const desk60 = frames60.filter((frame) => frame.webcamEnabled);
  const present30 =
    desk30.length === 0
      ? DESK_NEUTRAL
      : fraction(desk30.filter((frame) => frame.deskPresence === "present").length, desk30.length);
  const confMean30 = desk30.length === 0 ? DESK_NEUTRAL : meanConfidence(desk30);
  const confStd30 = desk30.length === 0 ? 0 : stdConfidence(desk30, confMean30);
  const flicker60 = presenceFlickers(desk60);

  const sessionMinutes = Math.max(0, (ts - ring.sessionStartTs) / 60_000);
  const priorDrifts = ring.driftCount;

  // --- Trend block ---------------------------------------------------------

  // 18. deskSagSlope30 — the SLOPE of desk confidence over the same 30 s the
  // mean flattens: the single largest effect anywhere in the bake-off. A sag is
  // one-sided (a rising trend is not a departure), so the feature is
  // max(0, −slope) and 0 means "not sagging", which is also the webcam-off
  // value. Reported as confidence lost per minute.
  const sagPerMin = deskSagPerMinute(desk30, ts);

  // 19. dwellShrink30v90 — the 30 s switch rate against a 90 s baseline.
  // Switching faster than this session's own recent pace means dwells are
  // getting shorter: the crescendo that makes a tab-out imminent rather than
  // merely possible. `switchAccel` (15 vs 60) is too short-baselined to see it.
  const dwellShrink = rateRatio(proc30, 30, proc90, 90);

  // 20. titleChurnAccel — the same shape on same-process title flips. The
  // 30/60 s COUNTS say how much churn there is; this says whether it is
  // speeding up. Additively it is worth nothing; on the shipped pairwise basis
  // it is worth ~+0.010 inner-val, which is the honest reason it ships.
  const titleAccel = rateRatio(title30, 30, title60, 60);

  // 21. greyLeaky120 — grey occupancy with a 120 s exponential memory, over the
  // whole ring. `fracOther60` saturates: a 70 s loiter and a 200 s one both
  // read 1.0. The leaky version keeps growing, so episode DEPTH survives.
  const greyLeaky = leakyOccupancy(frames600, ts, GREY_LEAK_TAU_SEC, isGrey);

  // 22. absenceRun60 — longest unbroken run of not-present webcam frames in the
  // last 60 s. `deskPresent30` (a fraction) and `deskFlicker60` (a count)
  // cannot separate six 1 s blips from one 6 s absence; only the second is a
  // walk-away starting. Webcam-off frames are skipped, not counted as present.
  const absenceRun = longestRun(desk60, (frame) => frame.deskPresence !== "present");

  // 23. deskConfDrop120 — mean desk confidence over the last 30 s against the
  // preceding 120 s. The 30 s slope catches a fast departure ramp; a slow
  // two-minute slide is inside its noise and only shows up against a long
  // baseline. One-sided, like the slope, and 0 when either window is too thin.
  const deskDrop = windowDrop(
    meanOf(desk30, deskConfidenceOf),
    meanOf(
      frames600.filter(
        (frame) => frame.webcamEnabled && frame.ts > ts - 150_000 && frame.ts <= ts - 30_000,
      ),
      deskConfidenceOf,
    ),
  );

  const raw: Record<ForecastFeatureKey, number> = {
    switch15: proc15,
    switch60: proc60,
    switchAccel: accel,
    dwellCur: dwellSec,
    fracAllow60: fraction(allow60, frames60.length),
    fracOther60: fraction(other60, frames60.length),
    otherDwell30: otherDwell30,
    distinct60: distinct.size,
    sinceBlock: sinceBlockSec,
    streak: streakSec,
    deskPresent30: present30,
    deskConfMean30: confMean30,
    deskConfStd30: confStd30,
    deskFlicker60: flicker60,
    sessionMin: sessionMinutes,
    priorDrifts: priorDrifts,
    titleChurn30: title30,
    titleChurn60: title60,
    deskSagSlope30: sagPerMin,
    dwellShrink30v90: dwellShrink,
    titleChurnAccel: titleAccel,
    greyLeaky120: greyLeaky,
    absenceRun60: absenceRun,
    deskConfDrop120: deskDrop,
  };

  const encoded: Record<ForecastFeatureKey, number> = {
    switch15: clamp01(proc15 / 8),
    switch60: clamp01(proc60 / 20),
    switchAccel: clamp01(accel / 4),
    dwellCur: logCompress(dwellSec, 600),
    fracAllow60: clamp01(raw.fracAllow60),
    fracOther60: clamp01(raw.fracOther60),
    otherDwell30: clamp01(otherDwell30 / 30),
    distinct60: clamp01(distinct.size / 8),
    sinceBlock: clamp01(1 - logCompress(sinceBlockSec, 600)),
    streak: logCompress(streakSec, 1800),
    deskPresent30: clamp01(present30),
    deskConfMean30: clamp01(confMean30),
    deskConfStd30: clamp01(4 * confStd30),
    deskFlicker60: clamp01(flicker60 / 6),
    sessionMin: clamp01(sessionMinutes / 50),
    priorDrifts: clamp01(priorDrifts / 5),
    titleChurn30: clamp01(title30 / 12),
    titleChurn60: clamp01(title60 / 24),
    deskSagSlope30: clamp01(sagPerMin / DESK_SAG_FULL_SCALE_PER_MIN),
    dwellShrink30v90: clamp01(dwellShrink / 4),
    titleChurnAccel: clamp01(titleAccel / 4),
    greyLeaky120: clamp01(greyLeaky),
    absenceRun60: clamp01(absenceRun / 20),
    deskConfDrop120: clamp01(deskDrop / DESK_DROP_FULL_SCALE),
  };

  return {
    raw,
    values: FORECAST_FEATURE_KEYS.map((key) => encoded[key]),
  };
}

function isGrey(frame: TelemetryFrame): boolean {
  return frame.focusKind === "other";
}

function deskConfidenceOf(frame: TelemetryFrame): number {
  return frame.deskConfidence;
}

/** Distinct process keys over a frame window + both ends of its proc transitions. */
function processKeysIn(
  frames: readonly TelemetryFrame[],
  procTransitions: readonly Transition[],
  currentKey: string,
): Set<string> {
  const keys = new Set<string>();
  for (const frame of frames) {
    if (frame.processKey !== "") {
      keys.add(frame.processKey);
    }
  }
  for (const transition of procTransitions) {
    if (transition.fromKey !== "") {
      keys.add(transition.fromKey);
    }
    if (transition.toKey !== "") {
      keys.add(transition.toKey);
    }
  }
  if (currentKey !== "") {
    keys.add(currentKey);
  }
  return keys;
}

function meanConfidence(frames: readonly TelemetryFrame[]): number {
  let sum = 0;
  for (const frame of frames) {
    sum += frame.deskConfidence;
  }
  const mean = sum / frames.length;
  return Number.isFinite(mean) ? mean : DESK_NEUTRAL;
}

/** Population standard deviation of desk confidence. */
function stdConfidence(frames: readonly TelemetryFrame[], mean: number): number {
  let sum = 0;
  for (const frame of frames) {
    const delta = frame.deskConfidence - mean;
    sum += delta * delta;
  }
  const std = Math.sqrt(sum / frames.length);
  return Number.isFinite(std) ? std : 0;
}

/** Presence-label changes between consecutive webcam-on frames. */
function presenceFlickers(frames: readonly TelemetryFrame[]): number {
  let flickers = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1];
    const cur = frames[i];
    if (prev && cur && prev.deskPresence !== cur.deskPresence) {
      flickers += 1;
    }
  }
  return flickers;
}

/**
 * Least-squares slope of desk confidence against time over the webcam-on
 * frames, expressed as confidence LOST per minute (a rising trend reads 0).
 * Needs `DESK_TREND_MIN_FRAMES` samples and a non-degenerate time spread;
 * anything less is 0, which is also the webcam-off value.
 */
function deskSagPerMinute(frames: readonly TelemetryFrame[], ts: number): number {
  if (frames.length < DESK_TREND_MIN_FRAMES) {
    return 0;
  }
  let sumX = 0;
  let sumY = 0;
  for (const frame of frames) {
    sumX += (frame.ts - ts) / 1000;
    sumY += frame.deskConfidence;
  }
  const meanX = sumX / frames.length;
  const meanY = sumY / frames.length;
  if (!Number.isFinite(meanX) || !Number.isFinite(meanY)) {
    return 0;
  }
  let num = 0;
  let den = 0;
  for (const frame of frames) {
    const dx = (frame.ts - ts) / 1000 - meanX;
    num += dx * (frame.deskConfidence - meanY);
    den += dx * dx;
  }
  if (!(den > 1e-9)) {
    return 0;
  }
  const perSecond = num / den;
  if (!Number.isFinite(perSecond)) {
    return 0;
  }
  return Math.max(0, -perSecond) * 60;
}

/** Longest run of consecutive frames satisfying `predicate`, in frames. */
function longestRun(
  frames: readonly TelemetryFrame[],
  predicate: (frame: TelemetryFrame) => boolean,
): number {
  let best = 0;
  let run = 0;
  for (const frame of frames) {
    if (predicate(frame)) {
      run += 1;
      if (run > best) {
        best = run;
      }
    } else {
      run = 0;
    }
  }
  return best;
}

/** Exponentially age-weighted occupancy of `predicate`, τ in seconds; [0,1]. */
function leakyOccupancy(
  frames: readonly TelemetryFrame[],
  ts: number,
  tauSec: number,
  predicate: (frame: TelemetryFrame) => boolean,
): number {
  let num = 0;
  let den = 0;
  for (const frame of frames) {
    const weight = Math.exp(-Math.max(0, (ts - frame.ts) / 1000) / tauSec);
    den += weight;
    if (predicate(frame)) {
      num += weight;
    }
  }
  return den > 0 ? num / den : 0;
}

/** Mean of `value` over frames, or null when the window is too thin to trust. */
function meanOf(
  frames: readonly TelemetryFrame[],
  value: (frame: TelemetryFrame) => number,
): number | null {
  if (frames.length < DESK_TREND_MIN_FRAMES) {
    return null;
  }
  let sum = 0;
  for (const frame of frames) {
    sum += value(frame);
  }
  const mean = sum / frames.length;
  return Number.isFinite(mean) ? mean : null;
}

/** One-sided `earlier − current` drop; 0 when either window is missing. */
function windowDrop(current: number | null, earlier: number | null): number {
  if (current === null || earlier === null) {
    return 0;
  }
  const drop = earlier - current;
  return Number.isFinite(drop) && drop > 0 ? drop : 0;
}
