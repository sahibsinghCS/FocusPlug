import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@shared/ipc";
import type { RunPosition } from "../../timer/runtime";
import { buildLockFaceProps } from "../lockProps";
import type { FaceProps } from "../types";
import { buildFlightModel } from "./model";
import { toFlightClock } from "./clock";

const NOW = new Date("2026-09-12T16:00:00.000Z");

function face(partial: Partial<FaceProps>): FaceProps {
  return {
    progress: 0.46,
    phase: "focus",
    elapsedMs: 420 * 60_000 * 0.46,
    remainingMs: 420 * 60_000 * 0.54,
    estimateMinutes: 420,
    sessionId: "sess-1",
    events: [],
    killCount: 0,
    now: NOW,
    width: 1280,
    height: 800,
    ...partial,
  };
}

describe("toFlightClock", () => {
  it("reads remainingMs and estimateMinutes honestly in focus", () => {
    const clock = toFlightClock(face({}));
    expect(clock.estimateMinutes).toBe(420);
    expect(clock.remaining).toBeCloseTo(420 * 60 * 0.54, 6);
    expect(clock.paused).toBe(false);
    expect(clock.complete).toBe(false);
    expect(clock.now).toBe(NOW.getTime());
  });

  it("honors FaceProps.paused so catalog previews do not keep flying", () => {
    const clock = toFlightClock(face({ paused: true }));
    expect(clock.paused).toBe(true);
  });

  it("does not treat a fuse countdown as ground speed during break", () => {
    const clock = toFlightClock(
      face({
        phase: "break",
        remainingMs: 8_000,
        elapsedMs: 420 * 60_000 * 0.46,
      }),
    );
    expect(clock.paused).toBe(true);
    expect(clock.remaining).toBeCloseTo(420 * 60 * 0.54, 5);
    expect(clock.complete).toBe(false);
  });

  it("keeps flying when FaceProps.paused is false, even on a scheduled rest", () => {
    const clock = toFlightClock(
      face({
        phase: "break",
        paused: false,
        remainingMs: 180_000,
        elapsedMs: 120_000,
        estimateMinutes: 5,
      }),
    );
    expect(clock.paused).toBe(false);
  });

  it("uses whole-session remaining so a 5-minute break is not its own hop", () => {
    const clock = toFlightClock(
      face({
        phase: "break",
        progress: 0.4,
        remainingMs: 180_000,
        elapsedMs: 120_000,
        estimateMinutes: 5,
        sessionProgress: 25 / 55,
        sessionElapsedMs: 25 * 60_000,
        sessionRemainingMs: 30 * 60_000,
        sessionEstimateMinutes: 55,
      }),
    );
    expect(clock.estimateMinutes).toBe(55);
    expect(clock.remaining).toBeCloseTo(30 * 60, 5);
    expect(clock.complete).toBe(false);
    expect(clock.paused).toBe(true);
  });

  it("uses whole-session remaining in focus so a 25-minute round is not a new flight", () => {
    const clock = toFlightClock(
      face({
        phase: "focus",
        progress: 0.2,
        remainingMs: 20 * 60_000,
        elapsedMs: 5 * 60_000,
        estimateMinutes: 25,
        sessionProgress: 30 / 55,
        sessionElapsedMs: 30 * 60_000,
        sessionRemainingMs: 25 * 60_000,
        sessionEstimateMinutes: 55,
      }),
    );
    expect(clock.estimateMinutes).toBe(55);
    expect(clock.remaining).toBeCloseTo(25 * 60, 5);
    expect(clock.paused).toBe(false);
    expect(clock.complete).toBe(false);
  });

  it("maps a live lock break through session fields to a plausible DUB–EDI cruise", () => {
    const now = new Date("2026-09-12T16:00:00.000Z");
    const position: RunPosition = {
      segment: {
        index: 1,
        kind: "break",
        round: 1,
        seconds: 300,
        startSec: 1500,
        endSec: 1800,
      },
      remainingSec: 180,
      segmentProgress: 0.4,
      planProgress: 1500 / 3300,
      round: 1,
      roundsTotal: 2,
    };
    const log: SessionEvent[] = [];
    const props = buildLockFaceProps({
      status: "running",
      position,
      elapsedSec: 1620,
      remainingSec: 1680,
      planFocusMin: 25,
      log,
      now,
      width: 1280,
      height: 800,
    });
    expect(props.estimateMinutes).toBe(5);
    expect(props.sessionEstimateMinutes).toBe(55);
    const model = buildFlightModel(toFlightClock(props));
    expect(model.estimateMinutes).toBe(55);
    expect(model.remaining).toBeCloseTo(1680, 5);
    expect(model.gsKmh).toBeGreaterThan(100);
    expect(model.gsKmh).toBeLessThan(1000);
  });

  it("marks destination-set when the host progress is done", () => {
    const clock = toFlightClock(
      face({
        progress: 1,
        remainingMs: 0,
        elapsedMs: 420 * 60_000,
      }),
    );
    expect(clock.complete).toBe(true);
    expect(clock.remaining).toBe(0);
  });
});
