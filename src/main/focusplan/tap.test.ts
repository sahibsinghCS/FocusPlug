import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_STATE } from "../../shared/defaults.ts";
import type { SessionState } from "../../shared/ipc.ts";
import type { ForecastPush } from "../../shared/forecast/types.ts";
import type { DeskSnapshot, FocusSnapshot, PolicyEvent, SessionEvent } from "../../shared/types.ts";
import type { PlanTap } from "../../shared/plan/types.ts";
import { discordFocus, docsFocus, presentDesk } from "../session/harness.ts";
import type { SessionPush } from "../session/push.ts";
import { hitEvent, riskSnapshot, throwingPlanTap } from "./harness.ts";
import { withPlan, withPlanForecast } from "./tap.ts";

function recordingBase(calls: string[]): SessionPush {
  return {
    sessionState: () => calls.push("base:sessionState"),
    policyEvent: () => calls.push("base:policyEvent"),
    focusSnapshot: () => calls.push("base:focusSnapshot"),
    deskSnapshot: () => calls.push("base:deskSnapshot"),
    sessionEvent: () => calls.push("base:sessionEvent"),
    nudge: () => calls.push("base:nudge"),
  };
}

function recordingForecastBase(calls: string[]): ForecastPush {
  return {
    snapshot: () => calls.push("base:snapshot"),
    event: () => calls.push("base:event"),
  };
}

function recordingTap(calls: string[]): PlanTap {
  return {
    onSessionState: () => calls.push("plan:onSessionState"),
    onPolicyEvent: () => calls.push("plan:onPolicyEvent"),
    onForecastSnapshot: () => calls.push("plan:onForecastSnapshot"),
    onForecastEvent: () => calls.push("plan:onForecastEvent"),
  };
}

const state: SessionState = { ...DEFAULT_SESSION_STATE, sessionActive: true };
const policyEvent: PolicyEvent = { type: "start_countdown", reason: "blocked_focus", seconds: 5 };
const focusSnap: FocusSnapshot = docsFocus(1_000);
const deskSnap: DeskSnapshot = presentDesk(1_000);
const sessionEvent: SessionEvent = { ts: 1_000, kind: "session", detail: "Session started" };

describe("withPlan", () => {
  it("forwards the two observed channels, base push always first", () => {
    const calls: string[] = [];
    const push = withPlan(recordingBase(calls), recordingTap(calls));

    push.sessionState(state);
    push.policyEvent(policyEvent);

    expect(calls).toEqual([
      "base:sessionState",
      "plan:onSessionState",
      "base:policyEvent",
      "plan:onPolicyEvent",
    ]);
  });

  it("never sees focus, desk, log or nudge — no window title ever reaches the ledger", () => {
    const calls: string[] = [];
    const push = withPlan(recordingBase(calls), recordingTap(calls));

    push.focusSnapshot(focusSnap);
    push.deskSnapshot(deskSnap);
    push.sessionEvent(sessionEvent);
    push.nudge({ ts: 1_000, kind: "blocked", app: "discord.exe" });

    expect(calls).toEqual([
      "base:focusSnapshot",
      "base:deskSnapshot",
      "base:sessionEvent",
      "base:nudge",
    ]);
  });

  it("passes payloads through unchanged", () => {
    const seen: unknown[] = [];
    const push = withPlan(recordingBase([]), {
      onSessionState: (value) => seen.push(value),
      onPolicyEvent: (value) => seen.push(value),
      onForecastSnapshot: (value) => seen.push(value),
      onForecastEvent: (value) => seen.push(value),
    });

    push.sessionState(state);
    push.policyEvent(policyEvent);

    expect(seen).toEqual([state, policyEvent]);
  });

  it("a throwing plan handler never reaches the session, base already delivered", () => {
    const calls: string[] = [];
    const push = withPlan(recordingBase(calls), throwingPlanTap());

    expect(() => push.sessionState(state)).not.toThrow();
    expect(() => push.policyEvent({ ...policyEvent })).not.toThrow();
    expect(() => push.focusSnapshot(discordFocus(2_000))).not.toThrow();
    expect(() => push.deskSnapshot(presentDesk(2_000))).not.toThrow();
    expect(() => push.sessionEvent(sessionEvent)).not.toThrow();
    expect(() => push.nudge({ ts: 2_000, kind: "phone" })).not.toThrow();

    expect(calls).toEqual([
      "base:sessionState",
      "base:policyEvent",
      "base:focusSnapshot",
      "base:deskSnapshot",
      "base:sessionEvent",
      "base:nudge",
    ]);
  });
});

describe("withPlanForecast", () => {
  it("forwards both channels, base push always first", () => {
    const calls: string[] = [];
    const push = withPlanForecast(recordingForecastBase(calls), recordingTap(calls));

    push.snapshot(riskSnapshot(1_000, 0.4));
    push.event(hitEvent(1_000, 14));

    expect(calls).toEqual([
      "base:snapshot",
      "plan:onForecastSnapshot",
      "base:event",
      "plan:onForecastEvent",
    ]);
  });

  it("a throwing plan handler never reaches the forecast fan-out", () => {
    const calls: string[] = [];
    const push = withPlanForecast(recordingForecastBase(calls), throwingPlanTap());

    expect(() => push.snapshot(riskSnapshot(1_000, 0.4))).not.toThrow();
    expect(() => push.event(hitEvent(1_000, 14))).not.toThrow();

    expect(calls).toEqual(["base:snapshot", "base:event"]);
  });
});
