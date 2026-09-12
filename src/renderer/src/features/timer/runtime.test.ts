import { describe, expect, it } from "vitest";
import { planSegments } from "./plan";
import { positionAt, positionCaption, shouldEnforce, skipTo, totalSec } from "./runtime";

const PLAN = { shape: "custom", focusMin: 10, breakMin: 2, rounds: 3 } as const;
const SEGMENTS = planSegments(PLAN);

describe("timer runtime", () => {
  it("reports the segment, the time left in it, and progress through the plan", () => {
    const start = positionAt(SEGMENTS, 0);
    expect(start?.segment.kind).toBe("focus");
    expect(start?.remainingSec).toBe(600);
    expect(start?.round).toBe(1);
    expect(start?.roundsTotal).toBe(3);

    const midBreak = positionAt(SEGMENTS, 600 + 60);
    expect(midBreak?.segment.kind).toBe("break");
    expect(midBreak?.remainingSec).toBe(60);
    expect(midBreak?.segmentProgress).toBeCloseTo(0.5, 5);
  });

  it("hands the boundary second to the next segment", () => {
    expect(positionAt(SEGMENTS, 599.5)?.segment.kind).toBe("focus");
    expect(positionAt(SEGMENTS, 600)?.segment.kind).toBe("break");
  });

  it("returns null once the plan is spent", () => {
    expect(positionAt(SEGMENTS, totalSec(SEGMENTS))).toBeNull();
    expect(positionAt(SEGMENTS, totalSec(SEGMENTS) + 90)).toBeNull();
    expect(positionAt([], 0)).toBeNull();
  });

  it("skips to the start of the next segment, and to the end on the last one", () => {
    expect(skipTo(SEGMENTS, 12)).toBe(600);
    expect(skipTo(SEGMENTS, 610)).toBe(720);
    expect(skipTo(SEGMENTS, totalSec(SEGMENTS) - 1)).toBe(totalSec(SEGMENTS));
  });

  it("arms enforcement during focus only, and never while paused", () => {
    const focus = positionAt(SEGMENTS, 30);
    const onBreak = positionAt(SEGMENTS, 620);
    expect(shouldEnforce(focus, "running")).toBe(true);
    expect(shouldEnforce(onBreak, "running")).toBe(false);
    expect(shouldEnforce(focus, "paused")).toBe(false);
    expect(shouldEnforce(focus, "setup")).toBe(false);
    expect(shouldEnforce(null, "running")).toBe(false);
  });

  it("captions the readout with the round you are in", () => {
    expect(positionCaption(positionAt(SEGMENTS, 30), "running")).toBe("Focus · round 1 of 3");
    expect(positionCaption(positionAt(SEGMENTS, 620), "running")).toBe(
      "Break · after round 1 of 3",
    );
    expect(positionCaption(null, "done")).toBe("Session complete");
    const solo = planSegments({ shape: "custom", focusMin: 50, breakMin: 10, rounds: 1 });
    expect(positionCaption(positionAt(solo, 10), "running")).toBe("Focus");
  });
});
