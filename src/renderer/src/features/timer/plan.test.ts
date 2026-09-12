import { describe, expect, it } from "vitest";
import {
  breakCount,
  clampPlan,
  DEFAULT_PLAN,
  formatReadout,
  formatSpan,
  LIMITS,
  planEndsAt,
  planFromShape,
  planSegments,
  planSummary,
  planTotalSec,
  SHAPES,
  withEdit,
} from "./plan";

describe("timer plan", () => {
  it("lays a session out as focus, break, focus — never a trailing break", () => {
    const segments = planSegments({ shape: "classic", focusMin: 25, breakMin: 5, rounds: 3 });
    expect(segments.map((segment) => segment.kind)).toEqual([
      "focus",
      "break",
      "focus",
      "break",
      "focus",
    ]);
    expect(segments[0]).toMatchObject({ round: 1, seconds: 1500, startSec: 0, endSec: 1500 });
    expect(segments[1]).toMatchObject({ kind: "break", round: 1, startSec: 1500, endSec: 1800 });
    expect(segments[4]?.endSec).toBe(planTotalSec({
      shape: "classic",
      focusMin: 25,
      breakMin: 5,
      rounds: 3,
    }));
  });

  it("counts breaks as the gaps between rounds", () => {
    expect(breakCount({ shape: "custom", focusMin: 30, breakMin: 5, rounds: 4 })).toBe(3);
    expect(breakCount({ shape: "custom", focusMin: 30, breakMin: 5, rounds: 1 })).toBe(0);
  });

  it("a single round has no break and no gap in the total", () => {
    const solo = { shape: "custom", focusMin: 45, breakMin: 10, rounds: 1 } as const;
    expect(planSegments(solo)).toHaveLength(1);
    expect(planTotalSec(solo)).toBe(45 * 60);
    expect(planSummary(solo)).toBe("1 round of 45m · no breaks");
  });

  it("clamps dials to the limits instead of accepting nonsense", () => {
    const clamped = clampPlan({ shape: "custom", focusMin: 999, breakMin: 0, rounds: -4 });
    expect(clamped.focusMin).toBe(LIMITS.focusMin.max);
    expect(clamped.breakMin).toBe(LIMITS.breakMin.min);
    expect(clamped.rounds).toBe(LIMITS.rounds.min);
    expect(clampPlan({ shape: "custom", focusMin: Number.NaN, breakMin: 5, rounds: 3 }).focusMin)
      .toBe(LIMITS.focusMin.min);
  });

  it("drops to custom when an edit leaves the named shape, and snaps back when it matches", () => {
    const classic = planFromShape("classic");
    expect(withEdit(classic, { focusMin: 30 }).shape).toBe("custom");
    const backToDeep = withEdit(
      { shape: "custom", focusMin: 50, breakMin: 10, rounds: 4 },
      { rounds: 3 },
    );
    expect(backToDeep.shape).toBe("deep");
  });

  it("every named shape survives a round-trip through the clamp", () => {
    for (const shape of SHAPES) {
      const plan = planFromShape(shape.id);
      expect(clampPlan(plan)).toEqual(plan);
      expect(planSegments(plan).filter((segment) => segment.kind === "focus")).toHaveLength(
        shape.rounds,
      );
    }
    expect(DEFAULT_PLAN.shape).toBe("classic");
  });

  it("formats spans and readouts the way the panel reads them", () => {
    expect(formatSpan(45 * 60)).toBe("45m");
    expect(formatSpan(2 * 3600 + 50 * 60)).toBe("2h 50m");
    expect(formatSpan(3 * 3600)).toBe("3h");
    expect(formatReadout(1500)).toBe("25:00");
    expect(formatReadout(59)).toBe("00:59");
    expect(formatReadout(3840)).toBe("1:04:00");
    expect(formatReadout(-5)).toBe("00:00");
  });

  it("ends at start plus the planned total", () => {
    const plan = planFromShape("deep");
    expect(planEndsAt(plan, 0)).toBe(planTotalSec(plan) * 1000);
  });
});
