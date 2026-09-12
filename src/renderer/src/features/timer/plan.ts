/**
 * The session plan: what you are about to commit to, before anything is locked.
 *
 * A plan is a shape (focus length, break length, round count). Everything the
 * setup page draws — the ribbon, the totals, the finish time — is derived here
 * so the picture on screen and the clock in lock mode can never disagree.
 */

export type ShapeId = "classic" | "deep" | "sprint" | "custom";

export interface TimerPlan {
  shape: ShapeId;
  /** Minutes of work per round. */
  focusMin: number;
  /** Minutes of break between rounds. */
  breakMin: number;
  /** Focus blocks in the session. Breaks sit between them, so breaks = rounds - 1. */
  rounds: number;
}

export interface ShapeDef {
  id: ShapeId;
  label: string;
  /** What this shape is for, in the student's words. */
  blurb: string;
  focusMin: number;
  breakMin: number;
  rounds: number;
}

export type SegmentKind = "focus" | "break";

export interface PlanSegment {
  /** Position in the run, 0-based. */
  index: number;
  kind: SegmentKind;
  /** 1-based focus block. A break carries the round it follows. */
  round: number;
  seconds: number;
  /** Offset from session start. */
  startSec: number;
  endSec: number;
}

export const LIMITS = {
  focusMin: { min: 5, max: 120, step: 5 },
  breakMin: { min: 1, max: 30, step: 1 },
  rounds: { min: 1, max: 10, step: 1 },
} as const;

export const SHAPES: readonly ShapeDef[] = [
  {
    id: "classic",
    label: "Classic",
    blurb: "The original pomodoro. Short enough that starting is easy.",
    focusMin: 25,
    breakMin: 5,
    rounds: 4,
  },
  {
    id: "deep",
    label: "Deep work",
    blurb: "Long blocks for essays and problem sets that need a running start.",
    focusMin: 50,
    breakMin: 10,
    rounds: 3,
  },
  {
    id: "sprint",
    label: "Sprint",
    blurb: "Tight rounds for readings, flashcards, and a brain that will not sit still.",
    focusMin: 15,
    breakMin: 3,
    rounds: 6,
  },
  {
    id: "custom",
    label: "Custom",
    blurb: "Your own shape. Set it once and it is remembered.",
    focusMin: 40,
    breakMin: 8,
    rounds: 3,
  },
];

/** One block, no breaks. Rounds are available, they are just not the default. */
export const DEFAULT_PLAN: TimerPlan = {
  shape: "custom",
  focusMin: 50,
  breakMin: 10,
  rounds: 1,
};

export function shapeDef(id: ShapeId): ShapeDef {
  const found = SHAPES.find((shape) => shape.id === id);
  if (!found) {
    throw new Error(`Unknown timer shape: ${id}`);
  }
  return found;
}

export function planFromShape(id: ShapeId): TimerPlan {
  const shape = shapeDef(id);
  return {
    shape: shape.id,
    focusMin: shape.focusMin,
    breakMin: shape.breakMin,
    rounds: shape.rounds,
  };
}

function clampStep(value: number, limit: { min: number; max: number }): number {
  if (!Number.isFinite(value)) {
    return limit.min;
  }
  return Math.min(limit.max, Math.max(limit.min, Math.round(value)));
}

export function clampPlan(plan: TimerPlan): TimerPlan {
  return {
    shape: plan.shape,
    focusMin: clampStep(plan.focusMin, LIMITS.focusMin),
    breakMin: clampStep(plan.breakMin, LIMITS.breakMin),
    rounds: clampStep(plan.rounds, LIMITS.rounds),
  };
}

/**
 * Editing any dial drops you out of a named shape unless the numbers still
 * match it — so the picker never lies about what is loaded.
 */
export function withEdit(plan: TimerPlan, patch: Partial<TimerPlan>): TimerPlan {
  const next = clampPlan({ ...plan, ...patch });
  const matching = SHAPES.find(
    (shape) =>
      shape.id !== "custom" &&
      shape.focusMin === next.focusMin &&
      shape.breakMin === next.breakMin &&
      shape.rounds === next.rounds,
  );
  return { ...next, shape: matching ? matching.id : "custom" };
}

/** focus, break, focus, … focus. No trailing break: the session ends on work. */
export function planSegments(plan: TimerPlan): PlanSegment[] {
  const safe = clampPlan(plan);
  const segments: PlanSegment[] = [];
  let cursor = 0;
  for (let round = 1; round <= safe.rounds; round += 1) {
    const focusSec = safe.focusMin * 60;
    segments.push({
      index: segments.length,
      kind: "focus",
      round,
      seconds: focusSec,
      startSec: cursor,
      endSec: cursor + focusSec,
    });
    cursor += focusSec;
    if (round < safe.rounds) {
      const breakSec = safe.breakMin * 60;
      segments.push({
        index: segments.length,
        kind: "break",
        round,
        seconds: breakSec,
        startSec: cursor,
        endSec: cursor + breakSec,
      });
      cursor += breakSec;
    }
  }
  return segments;
}

export function planTotalSec(plan: TimerPlan): number {
  const safe = clampPlan(plan);
  return safe.rounds * safe.focusMin * 60 + Math.max(0, safe.rounds - 1) * safe.breakMin * 60;
}

export function planFocusSec(plan: TimerPlan): number {
  const safe = clampPlan(plan);
  return safe.rounds * safe.focusMin * 60;
}

export function breakCount(plan: TimerPlan): number {
  return Math.max(0, clampPlan(plan).rounds - 1);
}

/** "2h 50m" / "45m" — never "0h 45m". */
export function formatSpan(totalSec: number): string {
  const safe = Math.max(0, Math.round(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.round((safe % 3600) / 60);
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

/** "25:00" / "1:04:00" — the readout in lock mode. */
export function formatReadout(totalSec: number): string {
  const safe = Math.max(0, Math.ceil(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function planEndsAt(plan: TimerPlan, startMs: number): number {
  return startMs + planTotalSec(plan) * 1000;
}

/** One line under the ribbon: the whole commitment, in plain words. */
export function planSummary(plan: TimerPlan): string {
  const safe = clampPlan(plan);
  const breaks = breakCount(safe);
  const roundWord = safe.rounds === 1 ? "round" : "rounds";
  if (breaks === 0) {
    return `one unbroken block of ${safe.focusMin}m`;
  }
  return `${safe.rounds} ${roundWord} of ${safe.focusMin}m · ${breaks} break${
    breaks === 1 ? "" : "s"
  } of ${safe.breakMin}m`;
}
