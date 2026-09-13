/**
 * Nudges: the moment FocusPlug notices a drift (phone, looking away, or a
 * blocked app), it brings itself back to the front with the timer and a short
 * motivational line — and, in `nudge` plug mode, switches the lamp on.
 */

export type NudgeKind = "phone" | "unfocused" | "blocked";

export interface NudgeEvent {
  ts: number;
  kind: NudgeKind;
  /** Foreground process for `blocked` nudges, e.g. "Discord.exe". */
  app?: string;
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
  return value === "phone" || value === "unfocused" || value === "blocked";
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

export function nudgeCopy(input: NudgeCopyInput): NudgeCopy {
  const app = appDisplayName(input.app);
  const title =
    input.kind === "phone"
      ? "Phone down."
      : input.kind === "unfocused"
        ? "Eyes back on it."
        : `${app ?? "That app"} can wait.`;

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
