import { describe, expect, it } from "vitest";
import {
  PLAN_REVISE_CALM_FRACTION,
  PLAN_REVISE_EARLY_SEC,
  PLAN_REVISE_EXTEND_SEC,
  PLAN_REVISE_LATE_SEC,
  PLAN_REVISE_MIN_DELTA_SEC,
  PLAN_REVISE_MIN_ELAPSED_FRACTION,
} from "./constants";
import { reviseBreak } from "./revise";
import type { PlanReviseInput } from "./types";

const ESTIMATE_MIN = 20;
const ESTIMATE_SEC = ESTIMATE_MIN * 60;

function input(over: Partial<PlanReviseInput> = {}): PlanReviseInput {
  return {
    elapsedSec: 0,
    remainingSec: 600,
    estimateMin: ESTIMATE_MIN,
    wobbled: false,
    risk: 0.2,
    nudgeRisk: 0.5,
    countdownActive: false,
    ...over,
  };
}

describe("the hard guards, tested first", () => {
  /*
   * The most important line in this module. The `blocked` nudge is emitted by
   * the controller AT `start_countdown` — while the fuse is burning. A break
   * offered at that instant is a one-tap escape hatch from the product's only
   * enforcement, and the product's identity is that the kill is not negotiated.
   */
  it("countdownActive returns null, even when every other condition is met", () => {
    const wouldFire = input({
      wobbled: true,
      elapsedSec: ESTIMATE_SEC,
      remainingSec: 600,
    });
    expect(reviseBreak(wouldFire)).not.toBeNull();
    expect(reviseBreak({ ...wouldFire, countdownActive: true })).toBeNull();
  });

  it("no estimate returns null — it never invents a comparison", () => {
    expect(
      reviseBreak(input({ estimateMin: null, wobbled: true, elapsedSec: ESTIMATE_SEC })),
    ).toBeNull();
  });

  it("non-finite clocks return null rather than rendering a NaN", () => {
    expect(reviseBreak(input({ wobbled: true, elapsedSec: Number.NaN }))).toBeNull();
    expect(reviseBreak(input({ wobbled: true, remainingSec: Number.POSITIVE_INFINITY }))).toBeNull();
  });
});

describe("earlier — hitting the limit sooner than planned", () => {
  const past = PLAN_REVISE_MIN_ELAPSED_FRACTION * ESTIMATE_SEC;

  it("fires at 0.6 x estimate with a wobble and three minutes left", () => {
    const revision = reviseBreak(
      input({ wobbled: true, elapsedSec: past, remainingSec: PLAN_REVISE_MIN_DELTA_SEC }),
    );
    expect(revision?.kind).toBe("earlier");
    expect(revision?.suggestedBreakInSec).toBe(PLAN_REVISE_EARLY_SEC);
  });

  it("does not fire at 0.5 x estimate", () => {
    expect(reviseBreak(input({ wobbled: true, elapsedSec: 0.5 * ESTIMATE_SEC }))).toBeNull();
  });

  it("does not fire without a real wobble — a bare risk reading is not enough", () => {
    expect(reviseBreak(input({ wobbled: false, elapsedSec: past, risk: 0.9 }))).toBeNull();
  });

  it("does not fire when the break is already close", () => {
    expect(
      reviseBreak(input({ wobbled: true, elapsedSec: past, remainingSec: PLAN_REVISE_MIN_DELTA_SEC - 1 })),
    ).toBeNull();
  });

  /* Three minutes is a break you walk to, not a fuse you dodge. */
  it("never suggests a break sooner than a minute, and never suggests now", () => {
    for (let remaining = PLAN_REVISE_MIN_DELTA_SEC; remaining < 3600; remaining += 37) {
      const revision = reviseBreak(input({ wobbled: true, elapsedSec: past, remainingSec: remaining }));
      expect(revision?.suggestedBreakInSec ?? 999).toBeGreaterThanOrEqual(60);
    }
  });

  it("never suggests a break later than the one already planned", () => {
    const revision = reviseBreak(
      input({ wobbled: true, elapsedSec: past, remainingSec: PLAN_REVISE_MIN_DELTA_SEC }),
    );
    expect(revision?.suggestedBreakInSec ?? 0).toBeLessThanOrEqual(
      revision?.plannedBreakInSec ?? 0,
    );
  });
});

describe("later — past the limit and still calm", () => {
  const calm = PLAN_REVISE_CALM_FRACTION * 0.5 - 0.01;
  const wellPast = ESTIMATE_SEC + PLAN_REVISE_LATE_SEC;

  it("fires only when calm, past the estimate, and near the block's end", () => {
    const revision = reviseBreak(
      input({ risk: calm, elapsedSec: wellPast, remainingSec: PLAN_REVISE_MIN_DELTA_SEC }),
    );
    expect(revision?.kind).toBe("later");
    expect(revision?.suggestedBreakInSec).toBe(PLAN_REVISE_MIN_DELTA_SEC + PLAN_REVISE_EXTEND_SEC);
  });

  it("does not fire while risk is up", () => {
    expect(
      reviseBreak(input({ risk: 0.45, elapsedSec: wellPast, remainingSec: PLAN_REVISE_MIN_DELTA_SEC })),
    ).toBeNull();
  });

  it("does not fire before the estimate plus its grace", () => {
    expect(
      reviseBreak(input({ risk: calm, elapsedSec: ESTIMATE_SEC, remainingSec: PLAN_REVISE_MIN_DELTA_SEC })),
    ).toBeNull();
  });

  it("does not fire with the break still far off", () => {
    expect(
      reviseBreak(input({ risk: calm, elapsedSec: wellPast, remainingSec: PLAN_REVISE_MIN_DELTA_SEC + 1 })),
    ).toBeNull();
  });

  it("does not fire with the forecast off — there is no calm to read", () => {
    expect(
      reviseBreak(input({ risk: null, elapsedSec: wellPast, remainingSec: PLAN_REVISE_MIN_DELTA_SEC })),
    ).toBeNull();
  });
});

describe("what the revision is", () => {
  it("is a pure function of its input and mutates nothing", () => {
    const source = input({ wobbled: true, elapsedSec: ESTIMATE_SEC });
    const snapshot = JSON.stringify(source);
    const first = reviseBreak(source);
    const second = reviseBreak(source);
    expect(JSON.stringify(source)).toBe(snapshot);
    expect(first).toEqual(second);
  });

  it("returns a string and nothing else — no control, no action, no handle", () => {
    const revision = reviseBreak(input({ wobbled: true, elapsedSec: ESTIMATE_SEC }));
    expect(revision).not.toBeNull();
    expect(Object.keys(revision ?? {}).sort()).toEqual([
      "copy",
      "kind",
      "plannedBreakInSec",
      "suggestedBreakInSec",
    ]);
    expect(Object.keys(revision?.copy ?? {})).toEqual(["line"]);
    expect(typeof revision?.copy.line).toBe("string");
    // It names the control that already exists rather than adding one.
    expect(revision?.copy.line).toContain("Skip round");
    expect(revision?.copy.line).toContain("nothing moves unless you move it");
  });

  it("says nothing at all in the ordinary calm middle of a round", () => {
    expect(reviseBreak(input())).toBeNull();
  });
});
