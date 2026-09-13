import { describe, expect, it } from "vitest";
import { findDriftOnsets, type DecisionFrame } from "../forecast/labels";
import type { Decision } from "../types";
import {
  PLAN_MAX_DRIFTS_PER_ROUND,
  PLAN_MIN_ROUND_SEC,
  PLAN_RUNAWAY_FACTOR,
  PLAN_STARTED_DRIFTED_SEC,
} from "./constants";
import {
  INITIAL_ONSET_STATE,
  cappedDrifts,
  classifyRound,
  detectStartedDrifted,
  driftTypeOf,
  exclusionReason,
  firstOnsetStartedDrifted,
  foldOnsets,
  holdMinutes,
  isEligibleRound,
  stepOnset,
} from "./drift";
import { makeRound } from "./fixtures";

/** Compact frame notation: "O" on task, "D" distracted, "A" away, "I" idle. */
const CODES: Record<string, Decision> = {
  O: "ON_TASK",
  D: "DISTRACTED",
  A: "AWAY",
  I: "IDLE",
};

/** One frame per second unless `step` says otherwise. */
function frames(pattern: string, step = 1): DecisionFrame[] {
  return [...pattern].map((code, index) => ({
    t: index * step,
    decision: CODES[code] ?? "IDLE",
    countdownActive: false,
  }));
}

/** Explicit (t, decision) pairs, for the debounce cases. */
function at(pairs: ReadonlyArray<[number, string]>): DecisionFrame[] {
  return pairs.map(([t, code]) => ({
    t,
    decision: CODES[code] ?? "IDLE",
    countdownActive: false,
  }));
}

interface Case {
  name: string;
  frames: DecisionFrame[];
}

const CASES: Case[] = [
  { name: "empty", frames: [] },
  { name: "one frame", frames: frames("O") },
  { name: "never drifts", frames: frames("IOOOOOOO") },
  { name: "one tab out", frames: frames("IOOODDDOOO") },
  { name: "one walk away", frames: frames("IOOOAAAOOO") },
  { name: "starts drifted", frames: frames("IDDDOOO") },
  { name: "starts drifted from frame zero", frames: frames("DDDOOO") },
  { name: "flapping in and out", frames: frames("IOODOODOODOO", 40) },
  { name: "flapping fast (debounce merges)", frames: frames("IOODOODOODOO") },
  { name: "drift straight into away", frames: frames("IOODDAAOO") },
  { name: "away then back then distracted", frames: frames("IOOAAOOODDD", 20) },
  { name: "ends drifted", frames: frames("IOOOOODDD") },
  { name: "idle in the middle", frames: frames("IOOIIOODDD") },
  {
    name: "two onsets 29 s apart — merged",
    frames: at([
      [0, "I"],
      [10, "O"],
      [20, "D"],
      [30, "O"],
      [49, "D"],
      [60, "O"],
    ]),
  },
  {
    name: "two onsets 31 s apart — both kept",
    frames: at([
      [0, "I"],
      [10, "O"],
      [20, "D"],
      [30, "O"],
      [51, "D"],
      [60, "O"],
    ]),
  },
];

describe("drift onsets — one definition, pinned to the forecast", () => {
  /*
   * The highest-value test in the suite. Focus Plan does not get its own idea
   * of what a drift is: if `findDriftOnsets` ever changes, this fails and
   * Focus Plan follows it.
   */
  it.each(CASES)("stepOnset folded over $name equals findDriftOnsets", ({ frames: table }) => {
    expect(foldOnsets(table).onsetsSec).toEqual(findDriftOnsets(table).map((onset) => onset.t));
  });

  it("agrees with findDriftOnsets across a long pseudo-random stream", () => {
    // Deterministic LCG — no seeded-rng dependency, no wall clock.
    let state = 20_260_913;
    const codes = ["O", "O", "D", "A", "I", "O"];
    const stream: DecisionFrame[] = [];
    for (let t = 0; t < 4000; t += 1) {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      const code = codes[state % codes.length] ?? "O";
      stream.push({ t, decision: CODES[code] ?? "IDLE", countdownActive: false });
    }
    expect(foldOnsets(stream).onsetsSec).toEqual(findDriftOnsets(stream).map((o) => o.t));
  });

  it("labels DISTRACTED tab_out and AWAY walk_away, and nothing else", () => {
    expect(driftTypeOf("DISTRACTED")).toBe("tab_out");
    expect(driftTypeOf("AWAY")).toBe("walk_away");
    expect(driftTypeOf("ON_TASK")).toBeNull();
    expect(driftTypeOf("IDLE")).toBeNull();
  });

  it("never treats the first frame as an onset — there is nothing to leave", () => {
    const first = stepOnset(INITIAL_ONSET_STATE, "DISTRACTED", 0);
    expect(first.onsetsSec).toEqual([]);
  });

  it("caps stored drifts without changing what an onset is", () => {
    const many = Array.from({ length: 30 }, (_, i) => i * 60);
    expect(cappedDrifts(many)).toHaveLength(PLAN_MAX_DRIFTS_PER_ROUND);
    expect(cappedDrifts(many)[0]).toBe(0);
  });
});

describe("startedDrifted — a round-eligibility rule, not a drift rule", () => {
  it("fires at 19 s and not at 21 s", () => {
    const early = at([
      [0, "I"],
      [PLAN_STARTED_DRIFTED_SEC - 1, "D"],
    ]);
    const late = at([
      [0, "I"],
      [PLAN_STARTED_DRIFTED_SEC + 1, "D"],
    ]);
    expect(detectStartedDrifted(early)).toBe(true);
    expect(detectStartedDrifted(late)).toBe(false);
  });

  it("does not fire at 5 s when a clean decision was seen first", () => {
    const seenWorking = at([
      [0, "I"],
      [2, "O"],
      [5, "D"],
    ]);
    expect(detectStartedDrifted(seenWorking)).toBe(false);
  });

  it("leaves the onset itself in place — findDriftOnsets still finds it", () => {
    const table = at([
      [0, "I"],
      [3, "D"],
    ]);
    expect(findDriftOnsets(table).map((o) => o.t)).toEqual([3]);
    expect(detectStartedDrifted(table)).toBe(true);
  });

  it("only the FIRST onset can mark a round as started drifted", () => {
    const before = { last: "ON_TASK" as Decision, onsetsSec: [600], sawClean: true };
    const after = stepOnset(before, "DISTRACTED", 700);
    expect(firstOnsetStartedDrifted(before, after)).toBe(false);
  });
});

describe("round classification — every row of the §3.3 table", () => {
  const planned = 25 * 60;

  it("ran to its planned end and drifted: completed, an event", () => {
    expect(classifyRound({ servedSec: planned, plannedFocusSec: planned, firstDriftSec: 1140, sawStatus: true })).toBe(
      "completed",
    );
  });

  it("ran to its planned end and stayed clean: completed, censored", () => {
    expect(classifyRound({ servedSec: planned, plannedFocusSec: planned, firstDriftSec: null, sawStatus: true })).toBe(
      "completed",
    );
  });

  it("ended early with a drift: aborted, and still an event — a drift you saw is a drift", () => {
    expect(classifyRound({ servedSec: 120, plannedFocusSec: planned, firstDriftSec: 90, sawStatus: true })).toBe(
      "aborted",
    );
  });

  it("ended early and clean at or over five minutes: aborted, censored", () => {
    expect(
      classifyRound({
        servedSec: PLAN_MIN_ROUND_SEC,
        plannedFocusSec: planned,
        firstDriftSec: null,
        sawStatus: true,
      }),
    ).toBe("aborted");
  });

  it("ended early and clean under five minutes: discarded — not a measurement", () => {
    expect(
      classifyRound({
        servedSec: PLAN_MIN_ROUND_SEC - 1,
        plannedFocusSec: planned,
        firstDriftSec: null,
        sawStatus: true,
      }),
    ).toBe("discarded");
  });

  it("the short-round asymmetry is deliberate: a 2-minute round WITH a drift is kept", () => {
    const clean = classifyRound({ servedSec: 120, plannedFocusSec: planned, firstDriftSec: null, sawStatus: true });
    const drifted = classifyRound({ servedSec: 120, plannedFocusSec: planned, firstDriftSec: 80, sawStatus: true });
    expect([clean, drifted]).toEqual(["discarded", "aborted"]);
  });

  it("never produced a status event: discarded", () => {
    expect(classifyRound({ servedSec: planned, plannedFocusSec: planned, firstDriftSec: null, sawStatus: false })).toBe(
      "discarded",
    );
  });

  it("clock jumped past the runaway factor: discarded", () => {
    expect(
      classifyRound({
        servedSec: PLAN_RUNAWAY_FACTOR * planned + 1,
        plannedFocusSec: planned,
        firstDriftSec: null,
        sawStatus: true,
      }),
    ).toBe("discarded");
  });
});

describe("eligibility and its disclosure", () => {
  it("a started-drifted round is recorded, disclosed, and excluded", () => {
    const round = makeRound({ driftMin: 0.2, startedDrifted: true });
    expect(isEligibleRound(round)).toBe(false);
    expect(exclusionReason(round)).toBe("started with a blocked app already open");
  });

  it("a discarded short round names why", () => {
    const round = makeRound({ servedMin: 2, driftMin: null, status: "discarded" });
    expect(exclusionReason(round)).toBe("too short to count");
  });

  it("a counted round has no reason at all — null exactly when counted", () => {
    const round = makeRound({ driftMin: 19 });
    expect(isEligibleRound(round)).toBe(true);
    expect(exclusionReason(round)).toBeNull();
  });

  it("hold minutes are MUFD when drifted and served minutes when clean (H1)", () => {
    expect(holdMinutes(makeRound({ plannedFocusMin: 25, driftMin: 19 }))).toBe(19);
    expect(holdMinutes(makeRound({ plannedFocusMin: 25, driftMin: null }))).toBe(25);
  });
});
