import type { Decision } from "../types";
import { FORECAST_HORIZON_SEC, FORECAST_WARMUP_SEC, type DriftType } from "./types";

/**
 * Drift-onset detection + horizon labeling — shared by the offline dataset
 * builder and the runtime hit/miss ledger, so both agree on what counts as
 * a drift. A *drift onset* is the policy's own decision entering DISTRACTED
 * (`tab_out`) or AWAY (`walk_away`) from a non-drifted state — the forecast
 * never re-derives policy's verdicts.
 *
 * Eligibility censoring is what makes the task prediction, not detection:
 * frames during a drift, during a countdown, right after recovery, in the
 * warm-up, or in the right-censored session tail are excluded from train AND
 * eval.
 */

/** Onsets within this many seconds of the previous kept onset are merged. */
export const DRIFT_DEBOUNCE_SEC = 30;

/** Frames within this many seconds after recovery/unlock are excluded. */
export const RECOVERY_EXCLUDE_SEC = 10;

export function isDriftedDecision(decision: Decision): boolean {
  return decision === "DISTRACTED" || decision === "AWAY";
}

/** Drift flavor for a drifted decision; null for ON_TASK / IDLE. */
export function driftTypeFor(decision: Decision): DriftType | null {
  if (decision === "DISTRACTED") {
    return "tab_out";
  }
  if (decision === "AWAY") {
    return "walk_away";
  }
  return null;
}

/** One 1 Hz decision sample, `t` in seconds since session start. */
export interface DecisionFrame {
  t: number;
  decision: Decision;
  countdownActive: boolean;
}

export interface DriftOnset {
  t: number;
  driftType: DriftType;
}

export interface FrameLabel {
  t: number;
  /** 1 iff a drift onset lies within the next `FORECAST_HORIZON_SEC` seconds. */
  label: 0 | 1;
  /** Seconds until the nearest onset ahead, or null when none remains. */
  secsToDrift: number | null;
  driftType: DriftType | null;
  /** Censored — dropped from train AND eval by the dataset builder. */
  excluded: boolean;
}

/**
 * First frame where the decision enters {DISTRACTED, AWAY} after at least one
 * frame outside that set. A session that starts drifted yields no onset at
 * frame 0. Onsets within `DRIFT_DEBOUNCE_SEC` of the previous kept onset are
 * merged into it.
 */
export function findDriftOnsets(frames: readonly DecisionFrame[]): DriftOnset[] {
  const onsets: DriftOnset[] = [];
  for (let i = 1; i < frames.length; i += 1) {
    const prev = frames[i - 1];
    const cur = frames[i];
    if (!prev || !cur) {
      continue;
    }
    if (!isDriftedDecision(cur.decision) || isDriftedDecision(prev.decision)) {
      continue;
    }
    const driftType = driftTypeFor(cur.decision);
    if (driftType === null) {
      continue;
    }
    const last = onsets[onsets.length - 1];
    if (last !== undefined && cur.t - last.t < DRIFT_DEBOUNCE_SEC) {
      continue;
    }
    onsets.push({ t: cur.t, driftType });
  }
  return onsets;
}

/**
 * Labels every frame against the onset list. `sessionEndT` is the last
 * second of the session (right-censoring bound).
 *
 * Exclusion zones (any one suffices):
 * - the frame's decision is drifted (an active drift);
 * - a policy countdown is active;
 * - within `RECOVERY_EXCLUDE_SEC` seconds after a drift/countdown ended;
 * - the first `FORECAST_WARMUP_SEC` seconds (runtime is not ready anyway);
 * - right-censoring — the final `FORECAST_HORIZON_SEC` seconds with no onset
 *   ahead (the future is unknown, not calm).
 */
export function labelFrames(
  frames: readonly DecisionFrame[],
  onsets: readonly DriftOnset[],
  sessionEndT: number,
): FrameLabel[] {
  const labels: FrameLabel[] = [];
  let onsetIndex = 0;
  let recoveredAt: number | null = null;
  let wasHot = false; // previous frame drifted or counting down
  for (const frame of frames) {
    const hot = isDriftedDecision(frame.decision) || frame.countdownActive;
    if (!hot && wasHot) {
      recoveredAt = frame.t;
    }
    wasHot = hot;

    while (onsetIndex < onsets.length && (onsets[onsetIndex]?.t ?? Infinity) <= frame.t) {
      onsetIndex += 1;
    }
    const nextOnset = onsets[onsetIndex];
    const secsToDrift = nextOnset === undefined ? null : nextOnset.t - frame.t;
    const label: 0 | 1 =
      secsToDrift !== null && secsToDrift > 0 && secsToDrift <= FORECAST_HORIZON_SEC ? 1 : 0;

    const excluded =
      hot ||
      (recoveredAt !== null && frame.t - recoveredAt < RECOVERY_EXCLUDE_SEC) ||
      frame.t < FORECAST_WARMUP_SEC ||
      (secsToDrift === null && sessionEndT - frame.t < FORECAST_HORIZON_SEC);

    labels.push({
      t: frame.t,
      label,
      secsToDrift,
      driftType: label === 1 && nextOnset !== undefined ? nextOnset.driftType : null,
      excluded,
    });
  }
  return labels;
}
