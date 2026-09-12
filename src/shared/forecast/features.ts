import type { TelemetryFrame, TelemetryRing } from "./ring";
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
 */

/** ε in `(rate15 + ε)/(rate60 + ε)` — keeps the ratio 1 on a quiet ring. */
export const SWITCH_ACCEL_EPS = 0.01;

/** Neutral encoding for desk features when no webcam-on frame is in window. */
export const DESK_NEUTRAL = 0.5;

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

export function extractFeatures(ring: TelemetryRing, ts: number): FeatureExtraction {
  const frames60 = ring.framesInRange(ts - 60_000, ts);
  const frames30 = frames60.filter((frame) => frame.ts > ts - 30_000);
  const proc15 = ring.transitionsInRange(ts - 15_000, ts, "proc").length;
  const proc60 = ring.transitionsInRange(ts - 60_000, ts, "proc").length;
  const title30 = ring.transitionsInRange(ts - 30_000, ts, "title").length;
  const title60 = ring.transitionsInRange(ts - 60_000, ts, "title").length;

  // Switch acceleration: 15 s rate vs 60 s rate, in switches/second.
  const rate15 = proc15 / 15;
  const rate60 = proc60 / 60;
  const accel = (rate15 + SWITCH_ACCEL_EPS) / (rate60 + SWITCH_ACCEL_EPS);

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
  const distinct = new Set<string>();
  for (const frame of frames60) {
    if (frame.processKey !== "") {
      distinct.add(frame.processKey);
    }
  }
  for (const transition of ring.transitionsInRange(ts - 60_000, ts, "proc")) {
    if (transition.fromKey !== "") {
      distinct.add(transition.fromKey);
    }
    if (transition.toKey !== "") {
      distinct.add(transition.toKey);
    }
  }
  if (ring.currentProcessKey !== "") {
    distinct.add(ring.currentProcessKey);
  }

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
  };

  return {
    raw,
    values: FORECAST_FEATURE_KEYS.map((key) => encoded[key]),
  };
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
