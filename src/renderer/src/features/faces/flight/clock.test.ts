import { describe, expect, it } from "vitest";
import type { FaceProps } from "../types";
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
