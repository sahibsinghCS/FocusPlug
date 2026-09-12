import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_STATE } from "../../shared/defaults.ts";
import type { SessionState } from "../../shared/ipc.ts";
import type { DeskSnapshot, FocusSnapshot, PolicyEvent, SessionEvent } from "../../shared/types.ts";
import { discordFocus, docsFocus, presentDesk } from "../session/harness.ts";
import type { SessionPush } from "../session/push.ts";
import { withForecast, type ForecastTap } from "./tap.ts";

function recordingBase(calls: string[]): SessionPush {
  return {
    sessionState: () => calls.push("base:sessionState"),
    policyEvent: () => calls.push("base:policyEvent"),
    focusSnapshot: () => calls.push("base:focusSnapshot"),
    deskSnapshot: () => calls.push("base:deskSnapshot"),
    sessionEvent: () => calls.push("base:sessionEvent"),
  };
}

function recordingTap(calls: string[]): ForecastTap {
  return {
    onSessionState: () => calls.push("forecast:onSessionState"),
    onPolicyEvent: () => calls.push("forecast:onPolicyEvent"),
    onFocus: () => calls.push("forecast:onFocus"),
    onDesk: () => calls.push("forecast:onDesk"),
  };
}

const sessionState: SessionState = { ...DEFAULT_SESSION_STATE, sessionActive: true };
const policyEvent: PolicyEvent = { type: "start_countdown", reason: "blocked_focus", seconds: 5 };
const focusSnap: FocusSnapshot = docsFocus(1_000);
const deskSnap: DeskSnapshot = presentDesk(1_000);
const sessionEvent: SessionEvent = { ts: 1_000, kind: "session", detail: "Session started" };

describe("withForecast", () => {
  it("forwards the four observed channels, base push always first", () => {
    const calls: string[] = [];
    const push = withForecast(recordingBase(calls), recordingTap(calls));

    push.sessionState(sessionState);
    push.policyEvent(policyEvent);
    push.focusSnapshot(focusSnap);
    push.deskSnapshot(deskSnap);

    expect(calls).toEqual([
      "base:sessionState",
      "forecast:onSessionState",
      "base:policyEvent",
      "forecast:onPolicyEvent",
      "base:focusSnapshot",
      "forecast:onFocus",
      "base:deskSnapshot",
      "forecast:onDesk",
    ]);
  });

  it("does not mirror sessionEvent — the forecast writes those, never reads them", () => {
    const calls: string[] = [];
    const push = withForecast(recordingBase(calls), recordingTap(calls));

    push.sessionEvent(sessionEvent);

    expect(calls).toEqual(["base:sessionEvent"]);
  });

  it("passes payloads through unchanged", () => {
    const seen: unknown[] = [];
    const base = recordingBase([]);
    const push = withForecast(base, {
      onSessionState: (state) => seen.push(state),
      onPolicyEvent: (event) => seen.push(event),
      onFocus: (snap) => seen.push(snap),
      onDesk: (snap) => seen.push(snap),
    });

    push.sessionState(sessionState);
    push.policyEvent(policyEvent);
    push.focusSnapshot(focusSnap);
    push.deskSnapshot(deskSnap);

    expect(seen).toEqual([sessionState, policyEvent, focusSnap, deskSnap]);
  });

  it("a throwing forecast handler never reaches the session, base already delivered", () => {
    const calls: string[] = [];
    const throwingTap: ForecastTap = {
      onSessionState: () => {
        throw new Error("forecast exploded");
      },
      onPolicyEvent: () => {
        throw new Error("forecast exploded");
      },
      onFocus: () => {
        throw new Error("forecast exploded");
      },
      onDesk: () => {
        throw new Error("forecast exploded");
      },
    };
    const push = withForecast(recordingBase(calls), throwingTap);

    expect(() => push.sessionState(sessionState)).not.toThrow();
    expect(() => push.policyEvent({ ...policyEvent })).not.toThrow();
    expect(() => push.focusSnapshot(discordFocus(2_000))).not.toThrow();
    expect(() => push.deskSnapshot(presentDesk(2_000))).not.toThrow();

    expect(calls).toEqual([
      "base:sessionState",
      "base:policyEvent",
      "base:focusSnapshot",
      "base:deskSnapshot",
    ]);
  });
});
