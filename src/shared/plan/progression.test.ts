import { describe, expect, it } from "vitest";
import { SHAPES } from "../../renderer/src/features/timer/plan";
import {
  PLAN_DEFAULT_FOCUS_MIN,
  PLAN_MAX_BREAK_MIN,
  PLAN_MAX_FOCUS_MIN,
  PLAN_MAX_REACH_MIN,
  PLAN_MIN_BREAK_MIN,
  PLAN_MIN_FOCUS_MIN,
} from "./constants";
import {
  clean3,
  cleanOnly,
  drift19_22_20,
  easeReady,
  fresh,
  liveWobble,
  makeRound,
  stretchReady,
} from "./fixtures";
import { selectWindow } from "./ledger";
import { breakFor, driftedEarly, heldToTarget, recommend } from "./progression";
import type { PlanRound } from "./types";

function plan(
  rounds: readonly PlanRound[],
  over: { stretchEnabled?: boolean; forecastEnabled?: boolean; live?: Parameters<typeof recommend>[0]["live"] } = {},
) {
  return recommend({
    rounds: selectWindow(rounds, { includeDiscarded: true }),
    live: over.live ?? null,
    forecastEnabled: over.forecastEnabled ?? true,
    stretchEnabled: over.stretchEnabled ?? true,
  });
}

describe("the decided examples reproduce", () => {
  it("fresh install: 25 / 5, cold, and no step", () => {
    const r = plan(fresh.rounds);
    expect([r.focusMin, r.breakMin]).toEqual([PLAN_DEFAULT_FOCUS_MIN, 5]);
    expect(r.step).toBe("hold");
    expect(r.cold).toBe(true);
  });

  /*
   * The brief's illustrative sentence is "aim for 20, break for 5". Under
   * round(focusMin / 5) a 20-minute block gets a FOUR-minute break, and that
   * divergence is deliberate: the /5 rule is the only one that reproduces all
   * three shipped SHAPES exactly (Classic 25/5, Deep work 50/10, Sprint 15/3),
   * and a five-minute floor would make the app's own Sprint shape unreachable
   * by its own recommender. Set PLAN_MIN_BREAK_MIN = 5 to restore the example,
   * at that cost. This is not a bug — do not "fix" it without reading §4.
   */
  it('"drifted at 19, 22 and 20 — aim for 20" gives 20 / 4, not 20 / 5', () => {
    const r = plan(drift19_22_20.rounds);
    expect(r.focusMin).toBe(20);
    expect(r.breakMin).toBe(4);
    expect(r.step).toBe("hold");
  });

  it('"held 18 last week, try 21 this week": median 18 and two clean rounds give 21 / 4', () => {
    const r = plan(stretchReady.rounds);
    expect(r.step).toBe("stretch");
    expect(r.baseMin).toBe(18);
    expect([r.focusMin, r.breakMin]).toEqual([21, 4]);
  });

  it("easing off is symmetric: median 20 with two early drifts gives 17 / 3", () => {
    const r = plan(easeReady.rounds);
    expect(r.step).toBe("ease");
    expect([r.focusMin, r.breakMin]).toEqual([17, 3]);
    expect(r.copy.reasoning).toContain("goes back up");
  });

  it("three clean 25-minute rounds go looking for the edge: 28 / 6", () => {
    const r = plan(clean3.rounds);
    expect(r.estimate.rung).toBe("censored-only");
    expect([r.focusMin, r.breakMin]).toEqual([28, 6]);
  });
});

describe("the break rule reproduces the shipped shapes", () => {
  it.each(SHAPES.filter((shape) => shape.id !== "custom"))(
    "$label: $focusMin minutes gets $breakMin off",
    (shape) => {
      expect(breakFor(shape.focusMin)).toBe(shape.breakMin);
    },
  );

  it("clamps at both ends", () => {
    expect(breakFor(PLAN_MAX_FOCUS_MIN)).toBe(PLAN_MAX_BREAK_MIN);
    expect(breakFor(PLAN_MIN_FOCUS_MIN)).toBe(PLAN_MIN_BREAK_MIN);
  });
});

describe("the ratchet", () => {
  const held = (day: number): PlanRound =>
    makeRound({ day, plannedFocusMin: 18, driftMin: null });
  const early = (day: number): PlanRound =>
    makeRound({ day, plannedFocusMin: 20, driftMin: 11 });
  const base = (day: number, driftMin: number): PlanRound =>
    makeRound({ day, plannedFocusMin: 25, driftMin });

  it("stretch needs TWO consecutive held rounds — one held plus one drifted holds", () => {
    const rounds = [base(0, 14), base(1, 18), base(2, 18), base(3, 22), held(4), base(5, 17)];
    expect(plan(rounds).step).toBe("hold");
  });

  it("ease needs two consecutive early drifts, and recovers after a single held round", () => {
    const drifting = [base(0, 20), base(1, 20), base(2, 20), early(3), early(4)];
    expect(plan(drifting).step).toBe("ease");
    expect(plan([...drifting, held(5)]).step).toBe("hold");
  });

  it("heldToTarget and driftedEarly are the two rules, and nothing else", () => {
    expect(heldToTarget(held(0))).toBe(true);
    expect(heldToTarget(early(0))).toBe(false);
    expect(driftedEarly(early(0))).toBe(true);
    // 19 of a planned 20 is past the 80% mark: that is not an early drift.
    expect(driftedEarly(makeRound({ plannedFocusMin: 20, driftMin: 19 }))).toBe(false);
  });

  it("a provisional estimate never steps", () => {
    const r = plan(fresh.rounds, { live: liveWobble });
    expect(r.estimate.provisional).toBe(true);
    expect(r.step).toBe("hold");
  });

  it("an unreached median never steps either — there is nothing to step from", () => {
    const r = plan(cleanOnly.rounds);
    expect(r.estimate.medianMin).toBeNull();
    expect(r.step).toBe("hold");
  });

  it("focusPlanStretchEnabled: false keeps the measurement and removes the step", () => {
    const off = plan(stretchReady.rounds, { stretchEnabled: false });
    expect(off.step).toBe("hold");
    expect(off.focusMin).toBe(18);
    expect(off.estimate.medianMin).toBe(18);
  });
});

describe("the clamps", () => {
  it("the plan can climb but cannot leap: best held plus ten is a hard cap", () => {
    // Three clean 20-minute rounds want 20 + 3; the cap is 20 + 10, so it binds
    // only when the base is already far above the best hold.
    const rounds = [
      makeRound({ day: 0, plannedFocusMin: 20, driftMin: null }),
      makeRound({ day: 1, plannedFocusMin: 20, driftMin: null }),
      makeRound({ day: 2, plannedFocusMin: 20, driftMin: null }),
    ];
    const r = plan(rounds);
    expect(r.estimate.bestHeldMin).toBe(20);
    expect(r.focusMin).toBeLessThanOrEqual(20 + PLAN_MAX_REACH_MIN);
  });

  it("censored-only stretches only once there are two completed rounds", () => {
    const one = [makeRound({ day: 0, plannedFocusMin: 25, driftMin: null })];
    const two = [...one, makeRound({ day: 1, plannedFocusMin: 25, driftMin: null })];
    expect(plan(one).focusMin).toBe(25);
    expect(plan(two).focusMin).toBe(28);
  });

  it("never goes under the floor or over the ceiling", () => {
    const tiny = [
      makeRound({ day: 0, plannedFocusMin: 25, servedMin: 6, driftMin: 2, status: "aborted" }),
      makeRound({ day: 1, plannedFocusMin: 25, servedMin: 6, driftMin: 2, status: "aborted" }),
      makeRound({ day: 2, plannedFocusMin: 25, servedMin: 6, driftMin: 2, status: "aborted" }),
    ];
    expect(plan(tiny).focusMin).toBe(PLAN_MIN_FOCUS_MIN);

    const huge = Array.from({ length: 4 }, (_, i) =>
      makeRound({ day: i, plannedFocusMin: 200, driftMin: 180 }),
    );
    expect(plan(huge).focusMin).toBeLessThanOrEqual(PLAN_MAX_FOCUS_MIN);
  });

  it("the reasoning owns the clamp rather than quoting a number it did not use", () => {
    const tiny = [makeRound({ day: 0, plannedFocusMin: 25, servedMin: 8, driftMin: 6, status: "aborted" })];
    const r = plan(tiny);
    expect(r.focusMin).toBe(PLAN_MIN_FOCUS_MIN);
    expect(r.copy.reasoning).toContain("never goes under");
  });
});

describe("the evidence disclosure (H9)", () => {
  it("shows every round in the window, counted or not, each with its reason", () => {
    const rounds = [
      makeRound({ day: 0, driftMin: 19 }),
      makeRound({ day: 1, servedMin: 2, driftMin: null, status: "discarded" }),
      makeRound({ day: 2, driftMin: 0.2, startedDrifted: true }),
    ];
    const r = plan(rounds);
    expect(r.evidence).toHaveLength(3);
    expect(r.evidence.filter((row) => row.counted)).toHaveLength(1);
    for (const row of r.evidence) {
      expect(row.counted).toBe(row.excludedBecause === null);
      if (!row.counted) {
        expect(row.excludedBecause?.length ?? 0).toBeGreaterThan(0);
      }
    }
    // The reader can always reconcile the two counts.
    expect(r.evidence.filter((row) => row.counted)).toHaveLength(r.estimate.rounds);
  });

  it("rounds are never recommended — the plan touches focus and break only", () => {
    const r = plan(drift19_22_20.rounds);
    expect(Object.keys(r)).not.toContain("rounds");
    expect(Object.keys(r)).toEqual(
      expect.arrayContaining(["focusMin", "breakMin", "step", "baseMin", "estimate", "trend", "cold", "evidence", "copy"]),
    );
  });
});
