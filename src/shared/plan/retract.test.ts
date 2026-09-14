import { describe, expect, it } from "vitest";

import { PLAN_MAX_DRIFTS_PER_ROUND, PLAN_MIN_ROUND_SEC } from "./constants";
import { makeRound } from "./fixtures";
import {
  retractLastAwayDrift,
  retractedNote,
  retractionLogLine,
  retractionNotice,
} from "./retract";
import type { PlanRetractionRefusal } from "../correction/types";
import type { PlanRound } from "./types";

/**
 * The retraction is an edit to a student's measured history, so every one of
 * its refusals has to be reachable and named — a retraction that quietly did
 * nothing is the one failure the student could not see.
 *
 * `docs/CORRECTION-LOOP.md § 5`.
 */

const OPEN = { enabled: true, pinned: false, lastDecision: "AWAY" as const };

function round(overrides: Partial<PlanRound> = {}): PlanRound {
  return {
    ...makeRound({ plannedFocusMin: 25, servedMin: 25, driftMin: 6, driftsMin: [6, 14] }),
    ...overrides,
  };
}

describe("retractLastAwayDrift — the happy path", () => {
  it("removes the last onset and nothing else", () => {
    const before = round();
    const out = retractLastAwayDrift({ ...OPEN, round: before });

    expect(out.retraction.retracted).toBe(true);
    expect(out.retraction.retractedAtSec).toBe(14 * 60);
    expect(out.round?.driftsSec).toEqual([6 * 60]);
    expect(out.round?.retractedDriftsSec).toEqual([14 * 60]);
    // The first onset survives untouched, so the headline number does not move.
    expect(out.retraction.firstDriftSecBefore).toBe(6 * 60);
    expect(out.retraction.firstDriftSecAfter).toBe(6 * 60);
    expect(out.round?.firstDriftType).toBe(before.firstDriftType);
    // And the input is not mutated: the caller decides what to persist.
    expect(before.driftsSec).toEqual([6 * 60, 14 * 60]);
    expect(before.retractedDriftsSec).toBeUndefined();
  });

  it("censors a single-onset round and drops firstDriftType with it", () => {
    const out = retractLastAwayDrift({
      ...OPEN,
      round: makeRound({ plannedFocusMin: 25, servedMin: 25, driftMin: 6, driftsMin: [6] }),
    });

    expect(out.retraction.retracted).toBe(true);
    expect(out.round?.driftsSec).toEqual([]);
    expect(out.round?.firstDriftSec).toBeNull();
    // firstDriftType is only ever recorded for the FIRST onset, so it needs no
    // recomputation: it goes null exactly when firstDriftSec does.
    expect(out.round?.firstDriftType).toBeNull();
    expect(out.retraction.firstDriftSecAfter).toBeNull();
  });

  it("reclassifies rather than subtracting — a short clean round is discarded", () => {
    // Four minutes served, one drift at two. With the drift it is real data;
    // without it, it is noise and must not enter the estimator as a censored
    // four-minute observation.
    const short = makeRound({ plannedFocusMin: 25, servedMin: 4, driftMin: 2, driftsMin: [2] });
    expect(short.servedSec).toBeLessThan(PLAN_MIN_ROUND_SEC);
    expect(short.status).not.toBe("discarded");

    const out = retractLastAwayDrift({ ...OPEN, round: short });
    expect(out.round?.status).toBe("discarded");
  });

  it("keeps a long clean round countable after the retraction", () => {
    const long = makeRound({ plannedFocusMin: 25, servedMin: 25, driftMin: 12, driftsMin: [12] });
    const out = retractLastAwayDrift({ ...OPEN, round: long });
    expect(out.round?.status).toBe("completed");
  });

  it("accumulates a second retraction on the same round, in order", () => {
    const first = retractLastAwayDrift({ ...OPEN, round: round() });
    const second = retractLastAwayDrift({ ...OPEN, round: first.round as PlanRound });
    expect(second.round?.retractedDriftsSec).toEqual([6 * 60, 14 * 60]);
    expect(second.round?.driftsSec).toEqual([]);
  });

  it("leaves countdowns and kills alone — they happened", () => {
    const burnt = makeRound({
      plannedFocusMin: 25,
      servedMin: 25,
      driftMin: 6,
      driftsMin: [6],
      countdowns: 2,
      kills: 1,
    });
    const out = retractLastAwayDrift({ ...OPEN, round: burnt });
    expect(out.round?.countdowns).toBe(2);
    expect(out.round?.kills).toBe(1);
  });
});

describe("retractLastAwayDrift — every refusal is reachable and named", () => {
  const cases: Array<[PlanRetractionRefusal, Parameters<typeof retractLastAwayDrift>[0]]> = [
    ["plan-off", { ...OPEN, enabled: false, round: round() }],
    ["pinned", { ...OPEN, pinned: true, round: round() }],
    ["no-round", { ...OPEN, round: null }],
    ["no-onset", { ...OPEN, round: makeRound({ driftMin: null }) }],
    ["not-open", { ...OPEN, lastDecision: "ON_TASK", round: round() }],
    ["not-away", { ...OPEN, lastDecision: "DISTRACTED", round: round() }],
    [
      "capped",
      {
        ...OPEN,
        round: makeRound({
          plannedFocusMin: 60,
          servedMin: 60,
          driftMin: 1,
          driftsMin: Array.from({ length: PLAN_MAX_DRIFTS_PER_ROUND }, (_, i) => i + 1),
        }),
      },
    ],
  ];

  it.each(cases)("refuses with %s", (refusal, input) => {
    const out = retractLastAwayDrift(input);
    expect(out.retraction.refusal).toBe(refusal);
    expect(out.retraction.retracted).toBe(false);
    expect(out.round).toBeNull();
    // A refusal never moves the number it declined to change.
    expect(out.retraction.firstDriftSecAfter).toBe(out.retraction.firstDriftSecBefore);
  });

  it("refuses `not-open` on a null last decision — a round that saw nothing", () => {
    const out = retractLastAwayDrift({ ...OPEN, lastDecision: null, round: round() });
    expect(out.retraction.refusal).toBe("not-open");
  });

  it("checks plan-off before everything, including a missing round", () => {
    const out = retractLastAwayDrift({ ...OPEN, enabled: false, round: null });
    expect(out.retraction.refusal).toBe("plan-off");
  });

  it("names the round it refused about, when it has one", () => {
    const target = round();
    const out = retractLastAwayDrift({ ...OPEN, lastDecision: "ON_TASK", round: target });
    expect(out.retraction.roundKey).toBe(target.roundKey);
  });
});

describe("the disclosure", () => {
  it("logs the retracted offset in minutes", () => {
    const out = retractLastAwayDrift({ ...OPEN, round: round() });
    expect(retractionLogLine(2, out.retraction)).toBe(
      "round 2 — drift at 14.0 min retracted (the away reading was wrong)",
    );
  });

  it("logs a refusal by name rather than going quiet", () => {
    const out = retractLastAwayDrift({ ...OPEN, lastDecision: "DISTRACTED", round: round() });
    expect(retractionLogLine(1, out.retraction)).toBe("round 1 — nothing retracted, not-away");
  });

  it("has a student-facing notice for every refusal, and none of them says error", () => {
    const refusals: PlanRetractionRefusal[] = [
      "plan-off",
      "pinned",
      "no-round",
      "no-onset",
      "not-open",
      "not-away",
      "capped",
    ];
    for (const refusal of refusals) {
      const line = retractionNotice({
        retracted: false,
        roundKey: null,
        retractedAtSec: null,
        firstDriftSecBefore: null,
        firstDriftSecAfter: null,
        refusal,
      });
      expect(line).toBeTruthy();
      expect(line).toContain("your focus history was not changed");
      expect(line?.toLowerCase()).not.toContain("error");
      expect(line?.toLowerCase()).not.toContain("failed");
    }
  });

  it("says plainly what a successful retraction did", () => {
    const out = retractLastAwayDrift({ ...OPEN, round: round() });
    expect(retractionNotice(out.retraction)).toBe(
      "That drift is out of your focus history — it was not one.",
    );
  });

  it("says nothing when no retraction was attempted", () => {
    expect(retractionNotice(null)).toBeNull();
  });

  it("counts retracted drifts for the evidence row, and stays silent at zero", () => {
    expect(retractedNote(0)).toBeNull();
    expect(retractedNote(1)).toBe("one drift retracted — you told us the camera was wrong");
    expect(retractedNote(3)).toBe("3 drifts retracted — you told us the camera was wrong");
  });
});
