import { describe, expect, it } from "vitest";
import { kaplanMeier, survivalAt } from "./survival";
import type { HoldSample } from "./types";

function sample(minutes: number, censored = false, index = 0): HoldSample {
  return { minutes, censored, day: `2026-09-0${(index % 9) + 1}`, round: 1, at: 1000 + index };
}

function events(...minutes: number[]): HoldSample[] {
  return minutes.map((m, i) => sample(m, false, i));
}

describe("Kaplan-Meier", () => {
  it("the decided beat: 19, 22 and 20 all events gives 0.667 / 0.333 / 0 and a median of 20", () => {
    const curve = kaplanMeier(events(19, 22, 20));
    expect(curve.steps.map((s) => s.minutes)).toEqual([19, 20, 22]);
    expect(curve.steps.map((s) => Number(s.survival.toFixed(3)))).toEqual([0.667, 0.333, 0]);
    expect(curve.medianMin).toBe(20);
  });

  it("all censored: the median is refused and the lower bound is the longest hold", () => {
    const curve = kaplanMeier([sample(25, true, 0), sample(25, true, 1), sample(30, true, 2)]);
    expect(curve.medianMin).toBeNull();
    expect(curve.lowerBoundMin).toBe(30);
    expect(curve.events).toBe(0);
    expect(curve.censored).toBe(3);
  });

  /*
   * H2's load-bearing case. One early drift among three clean 25s must NOT
   * report 12: the curve only ever falls to 0.75, the student drifts in a
   * quarter of their rounds, and the honest answer is "at least 25".
   */
  it("one event at 12 against three censored at 25 never reaches a half — and must not return 12", () => {
    const curve = kaplanMeier([
      sample(12, false, 0),
      sample(25, true, 1),
      sample(25, true, 2),
      sample(25, true, 3),
    ]);
    expect(curve.steps).toHaveLength(1);
    expect(curve.steps[0]?.survival).toBeCloseTo(0.75, 10);
    expect(curve.medianMin).toBeNull();
    expect(curve.medianMin).not.toBe(12);
    expect(curve.lowerBoundMin).toBe(25);
  });

  it("ties: an event and a censoring at the same t keep the censoring in the risk set", () => {
    const curve = kaplanMeier([sample(20, false, 0), sample(20, true, 1), sample(30, false, 2)]);
    // At t=20 the risk set is all three, so S(20) = 1 - 1/3.
    expect(curve.steps[0]?.atRisk).toBe(3);
    expect(curve.steps[0]?.survival).toBeCloseTo(2 / 3, 10);
    // At t=30 only the 30 remains at risk, so the curve reaches zero there.
    expect(curve.steps[1]?.atRisk).toBe(1);
    expect(curve.medianMin).toBe(30);
  });

  it("empty input is an empty curve, not a throw", () => {
    const curve = kaplanMeier([]);
    expect(curve).toEqual({ steps: [], medianMin: null, lowerBoundMin: null, events: 0, censored: 0 });
  });

  it("a single event puts the whole mass at that time", () => {
    const curve = kaplanMeier(events(18));
    expect(curve.medianMin).toBe(18);
    expect(curve.lowerBoundMin).toBe(18);
  });

  it("drops non-finite and negative rows rather than trusting a corrupt ledger", () => {
    const curve = kaplanMeier([sample(Number.NaN, false, 0), sample(-3, false, 1), sample(20, false, 2)]);
    expect(curve.events).toBe(1);
    expect(curve.medianMin).toBe(20);
  });

  it("survivalAt reads the step function between its steps", () => {
    const curve = kaplanMeier(events(19, 22, 20));
    expect(survivalAt(curve, 18)).toBe(1);
    expect(survivalAt(curve, 19)).toBeCloseTo(2 / 3, 10);
    expect(survivalAt(curve, 21)).toBeCloseTo(1 / 3, 10);
    expect(survivalAt(curve, 99)).toBe(0);
  });

  it("censoring the good rounds is exactly what KM is here to avoid", () => {
    // Same five rounds, once treated honestly and once flattened into events.
    const honest = kaplanMeier([
      sample(15, false, 0),
      sample(40, true, 1),
      sample(40, true, 2),
      sample(40, true, 3),
      sample(40, true, 4),
    ]);
    const flattened = kaplanMeier(events(15, 40, 40, 40, 40));
    expect(honest.medianMin).toBeNull();
    expect(flattened.medianMin).toBe(40);
  });
});
