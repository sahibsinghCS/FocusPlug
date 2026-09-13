import { describe, expect, it } from "vitest";
import { PLAN_CONFIDENCE_ROUNDS } from "./constants";
import { planEstimate } from "./estimate";
import {
  abortedShort,
  abortedWithDrift,
  clean3,
  cleanOnly,
  drift19_22_20,
  fresh,
  improving,
  liveQuiet,
  liveWobble,
  makeRound,
  mixedRounds,
  pair,
  single,
} from "./fixtures";
import { selectWindow } from "./ledger";

function estimate(
  rounds: readonly Parameters<typeof selectWindow>[0][number][],
  over: { live?: Parameters<typeof planEstimate>[0]["live"]; forecastEnabled?: boolean } = {},
) {
  return planEstimate({
    rounds: selectWindow(rounds, { includeDiscarded: true }),
    live: over.live ?? null,
    forecastEnabled: over.forecastEnabled ?? true,
  });
}

describe("the cold-start ladder — a rung for every state, and no empty state", () => {
  it("zero history: rung no-history, with a named method and no invented number", () => {
    const e = estimate(fresh.rounds);
    expect(e.rung).toBe("no-history");
    expect(e.medianMin).toBeNull();
    expect(e.provisional).toBe(false);
    expect(e.refusal).toBe("no-rounds");
    expect(e.rounds).toBe(0);
    expect(e.method.length).toBeGreaterThan(0);
  });

  it("fresh install, live round at 12 min with no wobble: still no-history, but the floor is real", () => {
    const e = estimate(fresh.rounds, { live: liveQuiet });
    expect(e.rung).toBe("no-history");
    expect(e.lowerBoundMin).toBe(12);
    expect(e.provisional).toBe(false);
  });

  it("fresh install, live round with a forecast wobble at 11: wobble-only and provisional", () => {
    const e = estimate(fresh.rounds, { live: liveWobble });
    expect(e.rung).toBe("wobble-only");
    expect(e.medianMin).toBe(11);
    expect(e.provisional).toBe(true);
    expect(e.events).toBe(0);
  });

  /*
   * The ordering rule, pinned. A wobble says "the forecast thought you were
   * about to drift, and you didn't". Against three clean 25-minute rounds that
   * is evidence of nothing much, and recommending 11 to someone who
   * demonstrably holds 25 would be absurd.
   */
  it("three clean 25-minute rounds that each wobbled at 11 are censored-only, NOT wobble-only", () => {
    const e = estimate(clean3.rounds, { live: liveWobble });
    expect(e.rung).toBe("censored-only");
    expect(e.provisional).toBe(false);
    expect(e.medianMin).toBeNull();
    expect(e.lowerBoundMin).toBe(25);
  });

  it("forecast off: the wobble rung is unreachable and the refusal names why", () => {
    const e = estimate(fresh.rounds, { live: liveWobble, forecastEnabled: false });
    expect(e.rung).toBe("no-history");
    expect(e.refusal).toBe("forecast-off");
    expect(e.provisional).toBe(false);
  });

  it("one real drift retires the provisional reading entirely", () => {
    const e = estimate(single.rounds, { live: liveWobble });
    expect(e.rung).toBe("single");
    expect(e.provisional).toBe(false);
    expect(e.events).toBe(1);
    expect(e.medianMin).toBe(19);
  });

  it("a session with no drift at all is censored, never a zero-drift maximum", () => {
    const e = estimate(cleanOnly.rounds);
    expect(e.rung).toBe("censored-only");
    expect(e.events).toBe(0);
    expect(e.censored).toBe(1);
    expect(e.medianMin).toBeNull();
    expect(e.lowerBoundMin).toBe(25);
    expect(e.refusal).toBe("all-censored");
  });

  it("two drifts: rung pair, the middle of the two", () => {
    const e = estimate(pair.rounds);
    expect(e.rung).toBe("pair");
    expect(e.events).toBe(2);
  });

  it("three sessions drifting at 19, 22 and 20: measured, median 20", () => {
    const e = estimate(drift19_22_20.rounds);
    expect(e.rung).toBe("measured");
    expect(e.medianMin).toBe(20);
    expect(e.events).toBe(3);
    expect(e.days).toBe(3);
    expect(e.recentHoldsMin).toEqual([19, 22, 20]);
  });

  it("twenty sessions: measured, full trust, five recent holds and a real best", () => {
    const e = estimate(improving.rounds);
    expect(e.rung).toBe("measured");
    expect(e.rounds).toBe(20);
    expect(e.events).toBe(20);
    expect(e.trust).toBe(1);
    expect(e.recentHoldsMin).toHaveLength(5);
    expect(e.bestHeldMin).not.toBeNull();
  });
});

describe("aborted rounds", () => {
  it("an aborted round that drifted is an event — a drift you saw is a drift", () => {
    const e = estimate(abortedWithDrift.rounds);
    expect(e.rung).toBe("single");
    expect(e.events).toBe(1);
    expect(e.medianMin).toBe(6);
    expect(e.completedRounds).toBe(0);
  });

  it("an aborted clean round under five minutes vanishes from the estimator", () => {
    const e = estimate(abortedShort.rounds);
    expect(e.rung).toBe("no-history");
    expect(e.rounds).toBe(0);
  });
});

describe("what the estimate refuses to count", () => {
  it("started-drifted and discarded rounds are excluded from every count", () => {
    const e = estimate(mixedRounds.rounds);
    // Five rounds in the ledger; two of them do not measure attention.
    expect(mixedRounds.rounds).toHaveLength(5);
    expect(e.rounds).toBe(3);
    expect(e.events).toBe(2);
    expect(e.censored).toBe(1);
  });

  it("trust is capped at one and mirrors adapt's own bar", () => {
    const many = Array.from({ length: PLAN_CONFIDENCE_ROUNDS * 2 }, (_, i) =>
      makeRound({ day: i % 10, atMin: i * 30, driftMin: 20 }),
    );
    expect(estimate(many).trust).toBe(1);
    expect(estimate(many.slice(0, 3)).trust).toBeCloseTo(3 / PLAN_CONFIDENCE_ROUNDS, 10);
  });

  it("never emits a NaN, an Infinity or a negative count", () => {
    for (const ledger of [fresh, single, pair, clean3, drift19_22_20, improving, mixedRounds]) {
      const e = estimate(ledger.rounds);
      for (const value of [e.medianMin, e.lowerBoundMin, e.bestHeldMin]) {
        expect(value === null || Number.isFinite(value)).toBe(true);
      }
      for (const count of [e.rounds, e.completedRounds, e.events, e.censored, e.days]) {
        expect(Number.isInteger(count) && count >= 0).toBe(true);
      }
      expect(e.trust).toBeGreaterThanOrEqual(0);
      expect(e.trust).toBeLessThanOrEqual(1);
    }
  });
});
