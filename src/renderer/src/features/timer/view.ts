/**
 * What the shell puts on screen for the session. Pure: lifecycle in, view out.
 *
 * One route, three states, and the distinction that matters is *lock* versus
 * *live*. A live session is one the main process is enforcing; lock mode is
 * only how you are looking at it. Keeping those apart is what gives the console
 * — decision hero, forecast instrument, sensor rail, enforcement timeline — a
 * state it can actually be reached in, because enforcement is armed exactly
 * when the plan is running, and the plan running used to mean the full-screen
 * face and nothing else.
 *
 *   plan    — nothing is running; SetupPage, the block you edit.
 *   lock    — a live session, seen full screen: the face running out.
 *   console — the same live session, instrumented, with the app chrome back.
 */

import type { RunStatus } from "./runtime";

export type ShellView = "plan" | "lock" | "console";

export interface ShellViewInput {
  /** Where the plan timer is. */
  status: RunStatus;
  /** The viewer stepped out of lock mode. Only meaningful mid-session. */
  consoleOpen: boolean;
  /**
   * Whether the main process is enforcing. Normally implied by a running plan,
   * but a session can also be live with no plan behind it — the seeded mock
   * scenes the stills and the action smoke drive, and any future start path
   * that is not the hold switch.
   */
  sessionActive: boolean;
}

export function shellView(input: ShellViewInput): ShellView {
  // The finish screen belongs to lock mode: the plan is spent, and the way out
  // is its own "Back to the panel", not a console for a session that is over.
  if (input.status === "done") {
    return "lock";
  }
  if (input.status === "running" || input.status === "paused") {
    return input.consoleOpen ? "console" : "lock";
  }
  return input.sessionActive ? "console" : "plan";
}

/** Lock mode owns the whole window: no rail, no nav, no other route. */
export function viewIsLocked(view: ShellView): boolean {
  return view === "lock";
}
