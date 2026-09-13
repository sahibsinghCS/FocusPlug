import { describe, expect, it } from "vitest";
import {
  breakCount,
  clampPlan,
  DEFAULT_PLAN,
  DEMO_ROUND,
  DEMO_ROUND_MIN,
  DEMO_ROUND_QUERY_KEY,
  DEMO_ROUND_STEP,
  DEMO_ROUND_STORAGE_KEY,
  demoRoundPinned,
  focusMinLimit,
  formatReadout,
  formatSpan,
  LIMITS,
  planEndsAt,
  planFromShape,
  planSegments,
  planSummary,
  planTotalSec,
  SHAPES,
  SHIPPED_FOCUS_MIN,
  SHIPPED_FOCUS_STEP,
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
    expect(planSummary(solo)).toBe("one unbroken block of 45m");
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
    expect(DEFAULT_PLAN.rounds).toBe(1);
  });

  it("formats spans and readouts the way the panel reads them", () => {
    expect(formatSpan(45 * 60)).toBe("45m");
    expect(formatSpan(2 * 3600 + 50 * 60)).toBe("2h 50m");
    expect(formatSpan(3 * 3600)).toBe("3h");
    // One second short of two hours must not render as "1h 60m".
    expect(formatSpan(2 * 3600 - 1)).toBe("2h");
    expect(formatSpan(3599)).toBe("1h");
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

/**
 * The demo round pin exists so the post-round debrief is reachable inside a
 * two-minute film: a block only reaches `completed` by serving its planned
 * length, and the shipped floor makes that five minutes of dead air. Every
 * test here is really one assertion — the pin is impossible to reach by
 * accident, and it changes nothing but the Length dial's floor.
 */
describe("the demo round pin", () => {
  it("is off by default, and the shipped floor is five minutes in steps of five", () => {
    expect(demoRoundPinned({})).toBe(false);
    expect(focusMinLimit(false)).toEqual({ min: SHIPPED_FOCUS_MIN, max: 120, step: SHIPPED_FOCUS_STEP });
    expect(SHIPPED_FOCUS_MIN).toBe(5);
    // No env, no storage key and no query flag in a bare test run, so the
    // module-level read must have resolved to the shipped floor.
    expect(DEMO_ROUND).toBe(false);
    expect(LIMITS.focusMin).toEqual({ min: 5, max: 120, step: 5 });
  });

  it("drops the floor to one minute, and nothing else", () => {
    expect(focusMinLimit(true)).toEqual({ min: DEMO_ROUND_MIN, max: 120, step: DEMO_ROUND_STEP });
    expect(focusMinLimit(true).max).toBe(focusMinLimit(false).max);
  });

  it.each([
    ["RENDERER_VITE_ env", { env: { RENDERER_VITE_FOCUSPLUG_DEMO_ROUND: "1" } }],
    ["VITE_ env", { env: { VITE_FOCUSPLUG_DEMO_ROUND: "true" } }],
    ["localStorage", { storage: { getItem: () => "1" } }],
    ["query flag", { search: `?${DEMO_ROUND_QUERY_KEY}=1` }],
  ])("%s pins it", (_name, sources) => {
    expect(demoRoundPinned(sources)).toBe(true);
  });

  it.each([
    ["no sources at all", {}],
    ["an empty env", { env: {} }],
    ["an unrelated env var", { env: { FOCUSPLUG_NO_ADAPT: "1", VITE_SOMETHING: "1" } }],
    ["the value 0", { env: { VITE_FOCUSPLUG_DEMO_ROUND: "0" } }],
    ["an empty value", { env: { VITE_FOCUSPLUG_DEMO_ROUND: "" } }],
    ["a storage miss", { storage: { getItem: () => null } }],
    ["another storage key set", { storage: { getItem: (key: string) => (key === "other" ? "1" : null) } }],
    ["an unrelated query", { search: "?scene=plan-measured" }],
    ["an empty query", { search: "" }],
  ])("%s does not", (_name, sources) => {
    expect(demoRoundPinned(sources)).toBe(false);
  });

  it("reads exactly the key it documents", () => {
    const seen: string[] = [];
    demoRoundPinned({
      storage: {
        getItem: (key) => {
          seen.push(key);
          return null;
        },
      },
    });
    expect(seen).toEqual([DEMO_ROUND_STORAGE_KEY]);
  });

  it("a storage that throws is not a pin and not a crash", () => {
    expect(
      demoRoundPinned({
        storage: {
          getItem: () => {
            throw new Error("this profile blocks storage");
          },
        },
      }),
    ).toBe(false);
  });

  it("unpinning pulls a demo-length plan back up to the shipped floor", () => {
    // The dial writes to localStorage; `loadPlan` clamps on the next read, so
    // forgetting to unset the pin cannot leave a real user on a 3-minute block.
    expect(clampPlan({ shape: "custom", focusMin: 3, breakMin: 5, rounds: 1 }).focusMin).toBe(
      LIMITS.focusMin.min,
    );
  });
});
