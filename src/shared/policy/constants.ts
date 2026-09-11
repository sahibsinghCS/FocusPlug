/** Machine-readable reasons on `start_countdown` / `kill` / plug events. */
export const REASONS = {
  blockedFocus: "blocked_focus",
  deskAway: "desk_away",
  unlock: "unlock",
} as const;

export type PolicyReason = (typeof REASONS)[keyof typeof REASONS];

/**
 * Sentinel kill target meaning "every enabled blocklist matcher".
 *
 * Session wiring MUST expand this to real process matchers before calling
 * `ProcessKiller`. Never treat it as an OS process name, and never put
 * allowlisted study-app names in `kill.targets`.
 */
export const ALL_BLOCKLIST_TARGET = "*blocklist*" as const;

export const SESSION_OFF_DETAIL = "Session off — observe only";
