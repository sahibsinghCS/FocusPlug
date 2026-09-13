import type { ForecastEvent, ForecastPush, ForecastSnapshot } from "../../shared/forecast/types.ts";
import type { PlanTap } from "../../shared/plan/types.ts";
import type { SessionPush } from "../session/push.ts";

/**
 * Focus Plan's only view of a session — a structural mirror of
 * `src/main/forecast/tap.ts`, line for line, and for the same reason.
 *
 * `SessionPush` and `ForecastPush` are never modified. Both wrappers forward
 * to the base push FIRST and only then mirror the channels the plan recorder
 * observes, so a coaching layer can never delay, reorder or drop an
 * enforcement message. `swallow()` catches anything that escapes the
 * recorder's own `guard()`: an exception here would otherwise ride the
 * controller's push call straight into the kill path.
 *
 * Focus Plan observes four channels across the two pushes:
 *   sessionState      round open / close, and the served-seconds clock
 *   policyEvent       `status` (the one drift definition), countdowns, kills
 *   forecastSnapshot  peak risk and when it peaked
 *   forecastEvent     wobbles, stand-downs, and the hit's lead time
 *
 * It observes `sessionEvent`, `nudge`, `focusSnapshot` and `deskSnapshot`
 * NOT AT ALL: no process name, no window title and no frame ever reaches the
 * ledger, which is what makes §5.3's privacy claim structural.
 */

function swallow(fn: () => void): void {
  try {
    fn();
  } catch {
    // The recorder already latched itself off; the session must not notice.
  }
}

export function withPlan(base: SessionPush, plan: PlanTap): SessionPush {
  return {
    sessionState: (state) => {
      base.sessionState(state);
      swallow(() => plan.onSessionState(state));
    },
    policyEvent: (event) => {
      base.policyEvent(event);
      swallow(() => plan.onPolicyEvent(event));
    },
    // Not observed by Focus Plan, but SessionPush owns them, and forwarding is
    // not optional: production wires `withPlan(push, recorder)`, so a dropped
    // channel is a crash on the first snapshot, not a missing card.
    focusSnapshot: (snap) => base.focusSnapshot(snap),
    deskSnapshot: (snap) => base.deskSnapshot(snap),
    sessionEvent: (event) => base.sessionEvent(event),
    nudge: (event) => base.nudge(event),
  };
}

export function withPlanForecast(base: ForecastPush, plan: PlanTap): ForecastPush {
  return {
    snapshot: (snap: ForecastSnapshot) => {
      base.snapshot(snap);
      swallow(() => plan.onForecastSnapshot(snap));
    },
    event: (event: ForecastEvent) => {
      base.event(event);
      swallow(() => plan.onForecastEvent(event));
    },
  };
}
