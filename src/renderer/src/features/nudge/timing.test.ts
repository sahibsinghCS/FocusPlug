import { describe, expect, it } from "vitest";
import { planSegments } from "../timer/plan";
import { positionAt } from "../timer/runtime";
import { nudgeTiming } from "./timing";

describe("nudgeTiming", () => {
  // focus 0–25m · break 25–30m · focus 30–55m
  const segments = planSegments({ shape: "custom", focusMin: 25, breakMin: 5, rounds: 2 });

  it("counts to the break during a focus block that has one", () => {
    expect(nudgeTiming(positionAt(segments, 10 * 60))).toEqual({ remainingSec: 15 * 60, until: "break" });
  });

  it("counts to the end during the last focus block", () => {
    expect(nudgeTiming(positionAt(segments, 31 * 60))).toEqual({ remainingSec: 24 * 60, until: "end" });
  });

  it("has no countdown on a break or with nothing running", () => {
    expect(nudgeTiming(positionAt(segments, 26 * 60)).remainingSec).toBeNull();
    expect(nudgeTiming(null)).toEqual({ remainingSec: null, until: "end" });
  });
});
