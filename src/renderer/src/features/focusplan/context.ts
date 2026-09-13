import type { PlanRecommendation, SessionArmContext, SessionPlanContext } from "@shared/ipc";
import type { PlanSegment } from "../timer/plan";

/**
 * What the renderer tells main when a focus block arms enforcement.
 *
 * It rides `SESSION_START` as one optional argument and is consumed in
 * `src/main/index.ts` by `FocusPlan.declareRound` — the session controller
 * never sees it, so Focus Plan has no seam into the fuse.
 */

/**
 * `<plan startedAtMs>-<segment index>`. A pause emits `stopSession()` and the
 * resume emits `startSession()` with the SAME key, which is what lets the
 * recorder merge them into one round instead of manufacturing two short bogus
 * ones. `end()` clears `startedAtMs`, so a fresh run is a fresh namespace.
 */
export function roundKeyFor(startedAtMs: number, segmentIndex: number): string {
  return `${startedAtMs}-${segmentIndex}`;
}

export interface ArmContextInput {
  /** `timer.startedAtMs`. Null before the switch is thrown. */
  startedAtMs: number | null;
  segments: readonly PlanSegment[];
  /** Index of the focus segment that is arming. */
  index: number;
}

/**
 * Everything the run clock knows about the block being armed. Null for a break
 * segment, an out-of-range index, or a run that has not started — enforcement
 * is armed per focus segment, so those are all "no round to declare".
 */
export function armContextFor(input: ArmContextInput): SessionArmContext | null {
  const { startedAtMs, segments, index } = input;
  if (startedAtMs === null || !Number.isFinite(startedAtMs)) {
    return null;
  }
  const segment = segments[index];
  if (segment === undefined || segment.kind !== "focus") {
    return null;
  }
  const next = segments[index + 1];
  return {
    roundKey: roundKeyFor(startedAtMs, segment.index),
    round: segment.round,
    roundsTotal: segments.reduce((max, item) => Math.max(max, item.round), 0),
    plannedFocusSec: segment.seconds,
    plannedBreakSec: next !== undefined && next.kind === "break" ? next.seconds : 0,
  };
}

/**
 * The arm context plus what Focus Plan offered, if it offered anything.
 *
 * `acceptedRecommendation` is measured, not asserted: it compares the block
 * actually being armed against the length the card recommended, so a student
 * who pressed "Use this plan" and then nudged the Dial is recorded as having
 * set their own.
 */
export function planContextFor(
  arm: SessionArmContext,
  recommendation: PlanRecommendation | null,
): SessionPlanContext {
  const recommendedFocusSec = recommendation === null ? null : recommendation.focusMin * 60;
  return {
    ...arm,
    recommendedFocusSec,
    acceptedRecommendation:
      recommendedFocusSec !== null && Math.round(arm.plannedFocusSec) === recommendedFocusSec,
  };
}
