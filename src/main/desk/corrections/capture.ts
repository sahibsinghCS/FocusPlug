import {
  CORRECTION_ANSWER_WINDOW_MS,
  CORRECTION_FRAMES_PER_CORRECTION,
} from "@shared/correction/constants";
import type { PendingCorrection } from "@shared/correction/types";
import type { PauseKind } from "@shared/nudge";
import type { DeskModelId, DeskSnapshot } from "@shared/types";
import type { RetainedFrame } from "../frameRing";

/**
 * The pause that is waiting for an answer, and the frames it is holding.
 *
 * NOTHING HERE TOUCHES THE DISK. That is the single most important privacy
 * property in this feature and it is structural rather than a setting: there
 * is no code path from "a pause happened" to "a file exists". The default
 * route through the feature — pause, restart, carry on — writes nothing at
 * all, because the bytes below are freed the moment the offer lapses.
 *
 * `docs/CORRECTION-LOOP.md § 2.2 – § 2.4`.
 */

/** Why a held capture was dropped. Only `answered` ever produced a record. */
export type PendingDrop = "answered" | "dismissed" | "expired" | "superseded" | "stopped";

export interface HeldCapture {
  id: string;
  at: number;
  kind: PauseKind;
  /** What the model said at the pause instant, in the vocabulary of `kind`. */
  modelLabel: string;
  modelConfidence: number;
  deskModelId: DeskModelId;
  expiresAt: number;
  /**
   * The store was already at `CORRECTION_CAP_GROUPS` when this pause landed.
   * The verdict still resumes, still silences and still retracts; only the
   * photos are skipped, and the record says so rather than losing them
   * silently.
   */
  capped: boolean;
  /** Raw frames, still in memory. Encoded only if a verdict arrives. */
  frames: RetainedFrame[];
}

/**
 * What the model called THIS frame, read in the vocabulary of the pause.
 *
 * An `away` pause rides the presence head, a `phone` pause rides the attention
 * head, and they are different instruments with different numbers — so the
 * confidence a correction records is the one belonging to the head that
 * actually stopped the clock.
 */
export function framePrediction(
  snapshot: DeskSnapshot,
  kind: PauseKind,
): { predicted: string; confidence: number } {
  if (kind === "phone") {
    const attention = snapshot.attention;
    if (attention) {
      return { predicted: attention.label, confidence: attention.confidence };
    }
  }
  return { predicted: snapshot.label, confidence: snapshot.confidence };
}

/**
 * The first, the middle and the last of the confirmed run.
 *
 * Three because that is enough for the student to recognise the moment and
 * enough to average over a blink or a hand crossing the lens, and few enough
 * that the cap fits in about 9 MB of their disk. Fewer than three available (a
 * short ring after a camera restart) is a valid correction; ZERO frames is
 * not, and the caller issues no `correctionId` for it.
 */
export function selectCorrectionFrames(
  frames: readonly RetainedFrame[],
  want: number = CORRECTION_FRAMES_PER_CORRECTION,
): RetainedFrame[] {
  const take = Math.max(1, Math.trunc(want));
  if (frames.length <= take) {
    return [...frames];
  }
  if (take === 1) {
    // The last frame is the one closest to the instant the clock stopped.
    const last = frames[frames.length - 1];
    return last === undefined ? [] : [last];
  }
  const picked: RetainedFrame[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < take; i += 1) {
    // Evenly spread across the window, endpoints included: first, middle,
    // last at take === 3, and still spread at any other count.
    const index = Math.round((i * (frames.length - 1)) / (take - 1));
    if (seen.has(index)) {
      continue;
    }
    seen.add(index);
    const frame = frames[index];
    if (frame !== undefined) {
      picked.push(frame);
    }
  }
  return picked;
}

export interface OpenCaptureInput {
  id: string;
  at: number;
  kind: PauseKind;
  deskModelId: DeskModelId;
  capped: boolean;
  frames: readonly RetainedFrame[];
  answerWindowMs?: number;
}

/**
 * One pending capture at a time.
 *
 * A second pause supersedes the first, because the newer moment is the one on
 * screen and a verdict about a pause the student can no longer see is not a
 * label. Everything this holds is freed on every exit path — answered,
 * dismissed, lapsed, superseded, session stopped — and there is no path that
 * keeps it.
 */
export class PendingCaptureHolder {
  private held: HeldCapture | null = null;
  private onDrop: ((capture: HeldCapture, reason: PendingDrop) => void) | undefined;

  constructor(options: { onDrop?: (capture: HeldCapture, reason: PendingDrop) => void } = {}) {
    this.onDrop = options.onDrop;
  }

  /**
   * Hold a pause's frames, superseding any earlier one. Returns `null` — and
   * holds nothing — when the ring had no frames, which is exactly when the
   * paused screen must offer no verdict row.
   */
  open(input: OpenCaptureInput): HeldCapture | null {
    const frames = selectCorrectionFrames(input.frames);
    if (frames.length === 0) {
      // No frames means no chips: a verdict with nothing behind it is a
      // button that would fail, and silence is better than that.
      this.drop("superseded");
      return null;
    }
    this.drop("superseded");
    const last = frames[frames.length - 1];
    const prediction =
      last !== undefined
        ? framePrediction(last.snapshot, input.kind)
        : { predicted: input.kind, confidence: 0 };
    const held: HeldCapture = {
      id: input.id,
      at: input.at,
      kind: input.kind,
      modelLabel: prediction.predicted,
      modelConfidence: prediction.confidence,
      deskModelId: input.deskModelId,
      expiresAt: input.at + (input.answerWindowMs ?? CORRECTION_ANSWER_WINDOW_MS),
      capped: input.capped,
      frames,
    };
    this.held = held;
    return held;
  }

  /**
   * The capture still on offer, or `null`.
   *
   * Reading it is what expires it: a verdict given ten minutes and one context
   * switch later is about a moment the student no longer remembers, so the
   * window lapsing frees the bytes rather than merely hiding the buttons.
   */
  peek(now: number): HeldCapture | null {
    const held = this.held;
    if (held === null) {
      return null;
    }
    if (now >= held.expiresAt) {
      this.drop("expired");
      return null;
    }
    return held;
  }

  /** Consume the capture for `id`, or `null` when it is gone or is another. */
  take(id: string, now: number): HeldCapture | null {
    const held = this.peek(now);
    if (held === null || held.id !== id) {
      return null;
    }
    this.held = null;
    this.onDrop?.(held, "answered");
    return held;
  }

  /** Free the bytes. `dismissed` is *Start the clock again* with no verdict. */
  drop(reason: PendingDrop): void {
    const held = this.held;
    if (held === null) {
      return;
    }
    this.held = null;
    this.onDrop?.(held, reason);
  }

  /** The renderer's view of the offer. No pixels cross this wire. */
  wire(now: number): PendingCorrection | null {
    const held = this.peek(now);
    if (held === null) {
      return null;
    }
    return {
      id: held.id,
      at: held.at,
      kind: held.kind,
      modelLabel: held.modelLabel,
      modelConfidence: held.modelConfidence,
      frames: held.frames.length,
      expiresAt: held.expiresAt,
      capped: held.capped,
    };
  }
}
