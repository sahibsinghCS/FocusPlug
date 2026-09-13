import type { NudgeKind } from "@shared/nudge";
import type { DeskSnapshot } from "@shared/types";

/** Off-task desk readings in a row before a drift counts. One is flicker. */
export const NUDGE_SUSTAIN_READINGS = 2;
/** A drift that continues re-nudges at most this often. */
export const NUDGE_REPEAT_MS = 30_000;

type Attention = "focused" | "phone" | "unfocused" | null;

function readAttention(desk: DeskSnapshot | null, threshold: number): Attention {
  if (
    desk === null ||
    !desk.webcamEnabled ||
    desk.label !== "at_desk" ||
    !desk.attention ||
    !Number.isFinite(desk.attention.confidence) ||
    desk.attention.confidence < threshold
  ) {
    return null;
  }
  return desk.attention.label;
}

/**
 * Decides when a drift becomes a nudge. Readings the model is unsure about
 * (low confidence, away, webcam off, no attention head) are neither drift nor
 * recovery: they break a streak but do not re-arm. A confident `focused`
 * reading re-arms immediately, so a second drift after refocusing nudges again
 * without waiting out the repeat window.
 */
export class NudgeTracker {
  private streak = 0;
  private lastNudgeAt: number | null = null;

  observeDesk(desk: DeskSnapshot | null, threshold: number, now: number): NudgeKind | null {
    const attention = readAttention(desk, threshold);
    if (attention === "focused") {
      this.streak = 0;
      this.lastNudgeAt = null;
      return null;
    }
    if (attention === null) {
      this.streak = 0;
      return null;
    }
    this.streak += 1;
    if (this.streak < NUDGE_SUSTAIN_READINGS) {
      return null;
    }
    if (this.lastNudgeAt !== null && now - this.lastNudgeAt < NUDGE_REPEAT_MS) {
      return null;
    }
    this.lastNudgeAt = now;
    return attention;
  }

  /** A blocked-app nudge fired; hold attention nudges off for the repeat window. */
  blocked(now: number): void {
    this.lastNudgeAt = now;
  }

  reset(): void {
    this.streak = 0;
    this.lastNudgeAt = null;
  }
}
