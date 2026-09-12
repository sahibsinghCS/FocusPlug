import type { RunPosition } from "../timer/runtime";

export interface NudgeTiming {
  /** Seconds left in the current focus block, or null when no focus block is running. */
  remainingSec: number | null;
  /** Whether that block ends in a break or ends the session. */
  until: "break" | "end";
}

/**
 * Plans alternate focus and break with no break at the end, so a focus block
 * before the last round is followed by a break and the last one ends the plan.
 */
export function nudgeTiming(position: RunPosition | null): NudgeTiming {
  if (position === null || position.segment.kind !== "focus") {
    return { remainingSec: null, until: "end" };
  }
  return {
    remainingSec: position.remainingSec,
    until: position.round < position.roundsTotal ? "break" : "end",
  };
}
