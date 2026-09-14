/**
 * Nudges: the moment FocusPlug notices a drift (phone, looking away, walking
 * off, or a blocked app), it brings itself back to the front with the timer
 * and a short motivational line — and, in `nudge` plug mode, switches the
 * lamp on.
 *
 * A confirmed drift goes one step further and stops the study clock. That
 * escalation rides the same `NudgeEvent` (`pause: true`) rather than a second
 * channel, and only two kinds are ever allowed to carry it — see `PauseKind`.
 */

import type { DeskModelId } from "./types.ts";

/** A drift the desk camera can see. `uncertain` is deliberately not one. */
export type DeskDrift = "away" | "phone" | "unfocused";

export type NudgeKind = DeskDrift | "blocked";

/**
 * The only drifts allowed to stop the clock.
 *
 * `unfocused` is missing on purpose: "eyes off the page" is the vaguest thing
 * the attention head says and the easiest to say wrongly, so it pulls you back
 * and nothing more. `phone` is in the list but is the weakest signal that is —
 * the attention head's phone recall is 50-69% and it calls roughly 17% of
 * non-phone photos "phone" — which is why `pauseOnPhoneEnabled` defaults off
 * and needs both a higher confidence floor and more sustained readings than
 * `away`.
 *
 * Being on the list is necessary and not sufficient. `away` is a *presence*
 * reading, and only one of the presence models this app ships has a number
 * that earns a stopped clock — see `deskModelMayPauseOnAway`.
 */
export type PauseKind = "away" | "phone";

export interface NudgeEvent {
  ts: number;
  kind: NudgeKind;
  /** Foreground process for `blocked` nudges, e.g. "Discord.exe". */
  app?: string;
  /**
   * Main confirmed this drift hard enough to stop the study clock: sustained
   * readings of one kind, every one of them above that kind's confidence
   * floor, with the matching setting on. The renderer's timer pauses on it and
   * never resumes itself. Absent or `false` is an ordinary pull-back.
   */
  pause?: boolean;
  /**
   * Frames from this pause are being held for a verdict. Present ONLY on a
   * pause-carrying nudge, only on `deskModelId: "custom"`, only with
   * `deskCorrectionsEnabled`, and only when the ring actually had frames.
   * Absent means the paused screen offers no verdict row.
   */
  correctionId?: string;
}

/**
 * What enabled plugs do when you drift.
 * - `nudge`: switch on (a lamp that pulls you back).
 * - `cut`: power off on kill, back on when you recover (the original enforcer).
 */
export type PlugMode = "nudge" | "cut";

export function isPlugMode(value: unknown): value is PlugMode {
  return value === "nudge" || value === "cut";
}

export function isNudgeKind(value: unknown): value is NudgeKind {
  return value === "phone" || value === "unfocused" || value === "away" || value === "blocked";
}

export function isPauseKind(value: unknown): value is PauseKind {
  return value === "away" || value === "phone";
}

/**
 * Which presence model is trusted to STOP THE CLOCK on `away`.
 *
 * The consequence follows the head that earns it. `away` comes from the
 * presence head, and the presence models this app ships are not the same
 * instrument:
 *
 * - `custom` — the head trained in this repo, and the only one with an `away`
 *   class it was taught. On the pack's held-out desk eval it makes 294 `away`
 *   calls and 272 are right: 92.5% precision at 95.4% recall, and 4.3% of
 *   at-desk frames (20 of 460) come back `away`. That is the number the
 *   fifteen-second pause is proportioned against.
 * - `blazeface` — the shipped default, and a *face detector*: it has no `away`
 *   class, so `away` is simply what `classifyDesk` answers when no usable face
 *   is in the frame. A dim room, a bad angle or a head turned away all read as
 *   an empty chair. Same eval: 594 `away` calls, 250 right — 42.1% precision,
 *   with 66.7% of at-desk frames (307 of 460) called `away`. The confidence
 *   floor cannot rescue that, because these calls are a constant rather than a
 *   score: `pauseAwayConfidence` at its shipped 0.75 screens 4 of the 344
 *   wrong ones, and at its 0.95 ceiling it screens all of them by screening
 *   every away call the model can make.
 * - `stub` — a fixture with no eval at all.
 *
 * So on anything but the trained head an `away` nudges and stops there: window
 * forward, overlay, lamp — cheap, reversible, and the right response to a
 * reading that is wrong more often than not. It is the rule `unfocused`
 * already lives under, applied to the model rather than to the label, and it
 * is structural: `pauseOnAwayEnabled` is the student's preference and cannot
 * buy a consequence the model has not paid for.
 *
 * Numbers: `docs/CUSTOM-MODEL.md § Away, on the model that actually ships`.
 */
export function deskModelMayPauseOnAway(id: DeskModelId): boolean {
  return id === "custom";
}

export interface NudgeCopyInput {
  kind: NudgeKind;
  app?: string;
  /** Seconds left on the running timer, or null when no timer is running. */
  remainingSec: number | null;
  /** Whether the timer counts down to a break or to the end of the session. */
  until: "break" | "end";
}

export interface NudgeCopy {
  title: string;
  line: string;
}

/** "Discord.exe" → "Discord"; blank → null. */
export function appDisplayName(app: string | undefined): string | null {
  const base = (app ?? "").trim().replace(/\.exe$/i, "");
  if (base.length === 0) {
    return null;
  }
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function formatRemainingWords(seconds: number): string {
  if (seconds < 60) {
    return "under a minute";
  }
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

function nudgeTitle(kind: NudgeKind, app: string | null): string {
  switch (kind) {
    case "phone":
      return "Phone down.";
    case "unfocused":
      return "Eyes back on it.";
    case "away":
      return "Back to your desk.";
    case "blocked":
      return `${app ?? "That app"} can wait.`;
  }
}

export function nudgeCopy(input: NudgeCopyInput): NudgeCopy {
  const app = appDisplayName(input.app);
  const title = nudgeTitle(input.kind, app);

  const remaining =
    input.remainingSec !== null && Number.isFinite(input.remainingSec) && input.remainingSec > 0
      ? formatRemainingWords(input.remainingSec)
      : null;

  let line: string;
  if (remaining === null) {
    line = input.kind === "blocked" ? "Close it and keep going." : "You got this — back to it.";
  } else if (input.kind === "blocked") {
    line =
      input.until === "break"
        ? `Just ${remaining} to your break — keep going.`
        : `Just ${remaining} left — keep going.`;
  } else {
    line =
      input.until === "break"
        ? `Only ${remaining} to your break — you got this.`
        : `Only ${remaining} longer to go — you got this.`;
  }
  return { title, line };
}

/** Why the clock stopped, and the one thing that starts it again. */
export interface PauseNotice {
  /** Short label for the paused header. */
  kicker: string;
  /** Plain language: what happened, and that nothing restarts on its own. */
  line: string;
  /** Label for the single button that starts the clock again. */
  action: string;
}

/**
 * Copy for a clock stopped by a confirmed drift. It has to say *why* in words
 * a tired student reads once, and it has to be honest about both halves of a
 * stopped clock: the timer will sit there until they act — study time not
 * served is the whole point of pausing — and, exactly as with the Pause
 * button, nothing is enforced while it sits there. A screen that hid the
 * second half would be describing a lock that is not on.
 */
export function pauseNotice(kind: PauseKind): PauseNotice {
  if (kind === "away") {
    return {
      kicker: "Paused — you left the desk",
      line:
        "The clock stopped when you walked away, and it will not start itself. " +
        "Time away from the desk is not study time. Nothing is enforced until " +
        "you start it again.",
      action: "Start the clock again",
    };
  }
  return {
    kicker: "Paused — phone",
    line:
      "The clock stopped because the camera kept seeing a phone, and it will not " +
      "start itself. Put it face down and start again — nothing is enforced " +
      "until you do.",
    action: "Start the clock again",
  };
}
