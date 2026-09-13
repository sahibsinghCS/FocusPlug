import { describe, expect, it } from "vitest";
import type { NudgeEvent, NudgeKind } from "@shared/nudge";
import { driftPauseStep, type DriftPauseInput } from "./driftPause";
import { planSegments } from "./plan";
import { positionAt, type RunStatus } from "./runtime";

const SEGMENTS = planSegments({ shape: "custom", focusMin: 25, breakMin: 5, rounds: 2 });
const IN_FOCUS = positionAt(SEGMENTS, 60);
const ON_BREAK = positionAt(SEGMENTS, 25 * 60 + 60);

function nudge(kind: NudgeKind, extra?: Partial<NudgeEvent>): NudgeEvent {
  return { ts: 1000, kind, ...extra };
}

function step(input: Partial<DriftPauseInput>): ReturnType<typeof driftPauseStep> {
  return driftPauseStep({
    nudge: null,
    handledTs: null,
    status: "running" as RunStatus,
    position: IN_FOCUS,
    ...input,
  });
}

describe("driftPauseStep", () => {
  it("stops the clock on a confirmed away and on a confirmed phone", () => {
    expect(step({ nudge: nudge("away", { pause: true }) })).toEqual({
      pause: "away",
      handledTs: 1000,
    });
    expect(step({ nudge: nudge("phone", { pause: true }) })).toEqual({
      pause: "phone",
      handledTs: 1000,
    });
  });

  it("leaves an ordinary nudge alone, and does not consume it", () => {
    for (const kind of ["away", "phone", "unfocused", "blocked"] as const) {
      expect(step({ nudge: nudge(kind) })).toEqual({ pause: null, handledTs: null });
      expect(step({ nudge: nudge(kind, { pause: false }) })).toEqual({
        pause: null,
        handledTs: null,
      });
    }
  });

  it("never stops the clock for unfocused or a blocked app", () => {
    // Main should never flag these, and if one ever arrives it is still refused
    // here — but it is consumed, so it cannot sit waiting for a restart.
    expect(step({ nudge: nudge("unfocused", { pause: true }) })).toEqual({
      pause: null,
      handledTs: 1000,
    });
    expect(step({ nudge: nudge("blocked", { pause: true }) })).toEqual({
      pause: null,
      handledTs: 1000,
    });
  });

  it("stops the clock once: the same event never stops it twice", () => {
    const event = nudge("away", { pause: true });
    const first = step({ nudge: event });
    expect(first.pause).toBe("away");
    expect(step({ nudge: event, handledTs: first.handledTs })).toEqual({
      pause: null,
      handledTs: 1000,
    });
  });

  it("a later confirmed drift stops it again", () => {
    const later: NudgeEvent = { ts: 2000, kind: "away", pause: true };
    expect(step({ nudge: later, handledTs: 1000 })).toEqual({ pause: "away", handledTs: 2000 });
  });

  it("only a running clock can be stopped", () => {
    for (const status of ["setup", "paused", "done"] as const) {
      expect(step({ nudge: nudge("away", { pause: true }), status })).toEqual({
        pause: null,
        handledTs: 1000,
      });
    }
  });

  it("a nudge that arrives while paused is spent, not stored up", () => {
    // The failure this guards: pausing, then restarting, and being paused again
    // on the spot by the event that was already on screen.
    const event = nudge("away", { pause: true });
    const arrived = step({ nudge: event, status: "paused" });
    expect(arrived).toEqual({ pause: null, handledTs: 1000 });
    expect(step({ nudge: event, handledTs: arrived.handledTs, status: "running" })).toEqual({
      pause: null,
      handledTs: 1000,
    });
  });

  it("a break is already not study time, so nothing stops there", () => {
    expect(step({ nudge: nudge("away", { pause: true }), position: ON_BREAK })).toEqual({
      pause: null,
      handledTs: 1000,
    });
  });

  it("no nudge changes nothing", () => {
    expect(step({ nudge: null, handledTs: 42 })).toEqual({ pause: null, handledTs: 42 });
  });
});
