import type { PauseKind } from "../nudge";
import { CORRECTION_COOLDOWN_MS } from "./constants";
import type { CorrectionCooldown, DeskCorrection } from "./types";

/**
 * The immediate half of a correction, derived rather than stored.
 *
 * The obvious implementation — a timestamp inside `NudgeTracker` — is wrong in
 * a way that would ship and never be noticed: *I was working* RESUMES the
 * clock, the resume calls `startSession()`, and `SessionController.start()`
 * calls `this.nudges.reset()`. The cooldown would be wiped by the very tap
 * that armed it.
 *
 * So there is no second piece of state. The cooldown is computed from the
 * correction records, which are already on disk, and three properties fall
 * out for free: it survives `NudgeTracker.reset()`, it survives an app
 * restart, and deleting a correction drops the cooldown it armed — because
 * the state and the evidence for the state are the same object, and cannot
 * disagree.
 *
 * `docs/CORRECTION-LOOP.md § 4.2`.
 */

/** Which correction armed this kind's cooldown, and until when. */
export interface CooldownSource {
  kind: PauseKind;
  until: number;
  correctionId: string;
}

/**
 * The latest `verdict: "wrong"` correction of this kind and the moment its
 * silence lapses, or `null` when this kind is not silenced at `now`.
 *
 * Only `wrong` arms anything: "you were right" is data, not an instruction.
 */
export function silencedUntil(
  corrections: readonly DeskCorrection[],
  kind: PauseKind,
  now: number,
): CooldownSource | null {
  let best: CooldownSource | null = null;
  for (const correction of corrections) {
    if (correction.kind !== kind || correction.verdict !== "wrong") {
      continue;
    }
    if (!Number.isFinite(correction.at)) {
      continue;
    }
    const until = correction.at + CORRECTION_COOLDOWN_MS[kind];
    if (until <= now) {
      continue;
    }
    if (best === null || until > best.until) {
      best = { kind, until, correctionId: correction.id };
    }
  }
  return best;
}

/** Every live cooldown, in `PauseKind` order. Used by the UI and by Settings. */
export function liveCooldowns(
  corrections: readonly DeskCorrection[],
  now: number,
): CorrectionCooldown[] {
  const kinds: readonly PauseKind[] = ["away", "phone"];
  const out: CorrectionCooldown[] = [];
  for (const kind of kinds) {
    const source = silencedUntil(corrections, kind, now);
    if (source !== null) {
      out.push({ kind: source.kind, until: source.until, correctionId: source.correctionId });
    }
  }
  return out;
}

/**
 * The kinds `NudgeTracker` must treat as UNSURE this reading.
 *
 * `DriftPolicy.silenced` is typed `PauseKind[]`, which is what makes it
 * impossible for a correction to silence a `blocked` nudge or an `unfocused`
 * reading: neither is a `PauseKind`, so neither is expressible here.
 */
export function silencedKinds(
  corrections: readonly DeskCorrection[],
  now: number,
): PauseKind[] {
  return liveCooldowns(corrections, now).map((cooldown) => cooldown.kind);
}
