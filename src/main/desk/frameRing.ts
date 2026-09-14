import {
  CORRECTION_RING_FRAMES,
  CORRECTION_RING_SPACING_MS,
} from "@shared/correction/constants";
import type { DeskSnapshot } from "@shared/types";
import type { RgbFrame } from "./types";

/**
 * One frame the desk model already looked at, kept just long enough that a
 * pause can hand it to a correction.
 *
 * `snapshot` is the model's own call on THIS frame, not on the pause: the
 * review screen and the CSV note both show what was being corrected, and a
 * confidence averaged over the run would not be that.
 */
export interface RetainedFrame {
  at: number;
  frame: RgbFrame;
  snapshot: DeskSnapshot;
}

export interface FrameRingOptions {
  /** Slots. 6 x 5 s covers `PAUSE_SUSTAIN_PHONE_MS`, the longest run. */
  capacity?: number;
  /** Minimum gap between retained frames. */
  spacingMs?: number;
}

/**
 * A bounded, spacing-enforcing ring of recent frames.
 *
 * Two rules, both structural rather than advisory:
 *
 * **Bounded.** `CORRECTION_RING_FRAMES` slots and no more, so the memory this
 * costs is a constant (≈5.5 MB at 640x480x3) rather than a function of how
 * long the session has run.
 *
 * **Spaced.** The desk monitor reads at 250 ms, and six consecutive readings
 * are six copies of one photograph. Keeping them would be exactly the
 * near-duplicate trap `scripts/desk-model/first-person.ts` exists to close, so
 * the ring enforces `CORRECTION_RING_SPACING_MS` on admission rather than
 * trusting the selection step to fix it afterwards.
 *
 * It holds pictures of a person, so it exists only while a correction could
 * actually come out of it and is cleared the moment one cannot — see
 * `DeskMonitor.setCorrectionCapture`.
 */
export class FrameRing {
  private readonly capacity: number;
  private readonly spacingMs: number;
  /** Oldest first. Never longer than `capacity`. */
  private frames: RetainedFrame[] = [];

  constructor(options: FrameRingOptions = {}) {
    this.capacity = Math.max(1, Math.trunc(options.capacity ?? CORRECTION_RING_FRAMES));
    this.spacingMs = Math.max(0, options.spacingMs ?? CORRECTION_RING_SPACING_MS);
  }

  get size(): number {
    return this.frames.length;
  }

  /**
   * Admit a frame, or refuse it for spacing. Returns whether it was kept, so
   * the caller can be tested on the refusal rather than on the side effect.
   *
   * A frame older than the newest slot (a clock that went backwards, a
   * scripted source replaying) is refused too: the ring is ordered by
   * construction and the selection step relies on that.
   */
  push(entry: RetainedFrame): boolean {
    if (!Number.isFinite(entry.at)) {
      return false;
    }
    const newest = this.frames[this.frames.length - 1];
    if (newest !== undefined && entry.at - newest.at < this.spacingMs) {
      return false;
    }
    this.frames.push(entry);
    if (this.frames.length > this.capacity) {
      this.frames.splice(0, this.frames.length - this.capacity);
    }
    return true;
  }

  /**
   * The frames at or after `sinceMs`, oldest first.
   *
   * A COPY of the array, holding the same frame objects: the caller keeps its
   * selection alive across `clear()`, which is the only ordering that works —
   * a pause stops the session, a stopped session stops the monitor, and the
   * monitor drops the ring on the way down.
   */
  peek(sinceMs: number): RetainedFrame[] {
    return this.frames.filter((entry) => entry.at >= sinceMs);
  }

  /** Everything currently retained, oldest first. */
  all(): RetainedFrame[] {
    return [...this.frames];
  }

  /** A stopped session holds no pictures of anybody. */
  clear(): void {
    this.frames = [];
  }
}
