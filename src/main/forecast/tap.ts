import type { SessionState } from "../../shared/ipc.ts";
import type { DeskSnapshot, FocusSnapshot, PolicyEvent } from "../../shared/types.ts";
import type { SessionPush } from "../session/push.ts";

/**
 * Telemetry tap — the forecast's only view of the session. `SessionPush`
 * itself is never modified; the wrapper forwards every channel to the base
 * push FIRST, then mirrors the four channels the forecast observes. Because
 * `evaluateOnce` pushes each `PolicyEvent` BEFORE `applyPolicyEvent`, the tap
 * sees `start_countdown` in time to latch the burning fuse.
 *
 * The base push must never be affected by the forecast: monitor handlers are
 * try/caught internally (first error turns the forecast off for the session),
 * and the tap swallows anything that escapes anyway — an exception here would
 * otherwise ride the controller's push call straight into the kill path.
 */

/** The push-facing handlers of a ForecastMonitor (structural, test-friendly). */
export interface ForecastTap {
  onSessionState(state: SessionState): void;
  onPolicyEvent(event: PolicyEvent): void;
  onFocus(snap: FocusSnapshot): void;
  onDesk(snap: DeskSnapshot): void;
}

function swallow(fn: () => void): void {
  try {
    fn();
  } catch {
    // The monitor already latched itself off; the session must not notice.
  }
}

export function withForecast(base: SessionPush, forecast: ForecastTap): SessionPush {
  return {
    sessionState: (state) => {
      base.sessionState(state);
      swallow(() => forecast.onSessionState(state));
    },
    policyEvent: (event) => {
      base.policyEvent(event);
      swallow(() => forecast.onPolicyEvent(event));
    },
    focusSnapshot: (snap) => {
      base.focusSnapshot(snap);
      swallow(() => forecast.onFocus(snap));
    },
    deskSnapshot: (snap) => {
      base.deskSnapshot(snap);
      swallow(() => forecast.onDesk(snap));
    },
    sessionEvent: (event) => base.sessionEvent(event),
  };
}
