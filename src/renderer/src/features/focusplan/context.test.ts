import { describe, expect, it } from "vitest";
import { recommend } from "@shared/plan";
import { drift19_22_20 } from "@shared/plan/fixtures";
import { normalizePlanContext } from "../../../../main/focusplan/recorder";
import { armContextFor, planContextFor, roundKeyFor } from "./context";
import { planSegments, type TimerPlan } from "../timer/plan";

const PLAN: TimerPlan = { shape: "classic", focusMin: 25, breakMin: 5, rounds: 4 };
const SEGMENTS = planSegments(PLAN);
const STARTED = 1_800_000_000_000;

function rec(focusMin: number) {
  const base = recommend({
    rounds: drift19_22_20.rounds,
    live: null,
    forecastEnabled: true,
    stretchEnabled: true,
  });
  return { ...base, focusMin };
}

describe("armContextFor", () => {
  it("describes the focus block being armed, and the break that follows it", () => {
    const arm = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: 0 });
    expect(arm).toEqual({
      roundKey: `${STARTED}-0`,
      round: 1,
      roundsTotal: 4,
      plannedFocusSec: 1500,
      plannedBreakSec: 300,
    });
  });

  it("reports no break after the last focus block", () => {
    const lastFocus = SEGMENTS.findIndex(
      (segment, index) => segment.kind === "focus" && index === SEGMENTS.length - 1,
    );
    const arm = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: lastFocus });
    expect(arm?.plannedBreakSec).toBe(0);
    expect(arm?.round).toBe(4);
  });

  it("declares nothing for a break, an unknown index, or a run that never started", () => {
    const breakIndex = SEGMENTS.findIndex((segment) => segment.kind === "break");
    expect(armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: breakIndex })).toBeNull();
    expect(armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: 99 })).toBeNull();
    expect(armContextFor({ startedAtMs: null, segments: SEGMENTS, index: 0 })).toBeNull();
  });
});

describe("roundKey identity — pause/resume must not manufacture two rounds", () => {
  it("is stable across a pause and resume of the same segment", () => {
    const first = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: 2 });
    const afterResume = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: 2 });
    expect(first?.roundKey).toBe(afterResume?.roundKey);
  });

  it("is distinct across segments, and across runs", () => {
    const one = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: 0 });
    const two = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: 2 });
    const nextRun = armContextFor({ startedAtMs: STARTED + 5_000, segments: SEGMENTS, index: 0 });
    expect(one?.roundKey).not.toBe(two?.roundKey);
    expect(one?.roundKey).not.toBe(nextRun?.roundKey);
    expect(roundKeyFor(STARTED, 2)).toBe(`${STARTED}-2`);
  });
});

describe("planContextFor", () => {
  const arm = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: 0 })!;

  it("records acceptance by measuring the block, not by trusting a click", () => {
    expect(planContextFor(arm, rec(25))).toMatchObject({
      recommendedFocusSec: 1500,
      acceptedRecommendation: true,
    });
    expect(planContextFor(arm, rec(20))).toMatchObject({
      recommendedFocusSec: 1200,
      acceptedRecommendation: false,
    });
  });

  it("says plainly that nothing was recommended when nothing was", () => {
    expect(planContextFor(arm, null)).toMatchObject({
      recommendedFocusSec: null,
      acceptedRecommendation: false,
    });
  });

  it("carries the arm context through untouched", () => {
    const context = planContextFor(arm, rec(25));
    expect(context.roundKey).toBe(arm.roundKey);
    expect(context.round).toBe(arm.round);
    expect(context.roundsTotal).toBe(arm.roundsTotal);
    expect(context.plannedFocusSec).toBe(arm.plannedFocusSec);
    expect(context.plannedBreakSec).toBe(arm.plannedBreakSec);
  });
});

/**
 * The seam. `Shell` composes exactly this — the run clock's `EnforceArm`
 * through `armContextFor`, then `planContextFor` — and hands it to
 * `SESSION_START`, where main's `declareRound` runs it through
 * `normalizePlanContext` before trusting a field of it.
 *
 * Testing the two ends apart is what let the renderer compute a context that
 * nothing ever sent, so this asserts them together: what the renderer builds
 * must survive main's validator UNCHANGED, or the round is recorded unlabelled
 * and the plan quietly stops knowing what it recommended.
 */
describe("what the renderer sends is what main accepts", () => {
  it("survives normalizePlanContext byte for byte, on every focus block", () => {
    for (const [index, segment] of SEGMENTS.entries()) {
      const arm = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index });
      if (segment.kind !== "focus") {
        expect(arm).toBeNull();
        continue;
      }
      const sent = planContextFor(arm!, rec(25));
      expect(normalizePlanContext(sent)).toEqual(sent);
    }
  });

  it("survives it with nothing recommended, which is the fresh-install call", () => {
    const arm = armContextFor({ startedAtMs: STARTED, segments: SEGMENTS, index: 0 })!;
    const sent = planContextFor(arm, null);
    expect(normalizePlanContext(sent)).toEqual(sent);
  });

  it("still refuses the shapes an older or hostile renderer could send", () => {
    expect(normalizePlanContext(undefined)).toBeNull();
    expect(normalizePlanContext({ round: 1 })).toBeNull();
  });
});
