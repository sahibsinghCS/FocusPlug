/**
 * Where the session is right now. Pure: elapsed seconds in, position out.
 *
 * The clock is derived from wall time rather than counted by ticks, so a
 * dropped frame, a sleeping laptop, or a slow render can never make the
 * session shorter than the plan you agreed to.
 */

import type { PlanSegment, SegmentKind } from "./plan";

export type RunStatus = "setup" | "running" | "paused" | "done";

export interface RunPosition {
  segment: PlanSegment;
  /** Seconds left in this segment, rounded up so "00" only shows at the end. */
  remainingSec: number;
  /** 0..1 through this segment. */
  segmentProgress: number;
  /** 0..1 through the whole session. */
  planProgress: number;
  /** 1-based round the readout names. */
  round: number;
  roundsTotal: number;
}

export function totalSec(segments: readonly PlanSegment[]): number {
  const last = segments[segments.length - 1];
  return last ? last.endSec : 0;
}

export function roundsIn(segments: readonly PlanSegment[]): number {
  return segments.reduce((max, segment) => Math.max(max, segment.round), 0);
}

/** `null` once the plan is spent — the caller shows the finish screen. */
export function positionAt(
  segments: readonly PlanSegment[],
  elapsedSec: number,
): RunPosition | null {
  const total = totalSec(segments);
  if (segments.length === 0 || elapsedSec >= total) {
    return null;
  }
  const clamped = Math.max(0, elapsedSec);
  const segment = segments.find((item) => clamped < item.endSec) ?? segments[segments.length - 1];
  if (!segment) {
    return null;
  }
  const into = Math.max(0, clamped - segment.startSec);
  return {
    segment,
    remainingSec: Math.max(0, Math.ceil(segment.seconds - into)),
    segmentProgress: segment.seconds === 0 ? 1 : Math.min(1, into / segment.seconds),
    planProgress: total === 0 ? 1 : Math.min(1, clamped / total),
    round: segment.round,
    roundsTotal: roundsIn(segments),
  };
}

/** Seconds of focus actually reached so far. Break time never counts as work. */
export function focusSecondsDone(segments: readonly PlanSegment[], elapsedSec: number): number {
  const clamped = Math.max(0, elapsedSec);
  return segments
    .filter((segment) => segment.kind === "focus")
    .reduce(
      (sum, segment) =>
        sum + Math.min(Math.max(clamped - segment.startSec, 0), segment.seconds),
      0,
    );
}

/** Elapsed seconds at the start of the next segment — what Skip jumps to. */
export function skipTo(segments: readonly PlanSegment[], elapsedSec: number): number {
  const position = positionAt(segments, elapsedSec);
  if (!position) {
    return totalSec(segments);
  }
  return position.segment.endSec;
}

/** Enforcement is armed during focus and released on a break. */
export function shouldEnforce(position: RunPosition | null, status: RunStatus): boolean {
  if (status !== "running" || !position) {
    return false;
  }
  return position.segment.kind === "focus";
}

export function kindLabel(kind: SegmentKind): string {
  return kind === "focus" ? "Focus" : "Break";
}

/** What the readout says under the time. */
export function positionCaption(position: RunPosition | null, status: RunStatus): string {
  if (status === "done" || !position) {
    return "Session complete";
  }
  if (position.segment.kind === "break") {
    return `Break · after round ${position.round} of ${position.roundsTotal}`;
  }
  // A single block has no rounds to count, and saying "1 of 1" only adds noise.
  if (position.roundsTotal <= 1) {
    return "Focus";
  }
  return `Focus · round ${position.round} of ${position.roundsTotal}`;
}
