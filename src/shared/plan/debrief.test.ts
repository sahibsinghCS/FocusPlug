import { describe, expect, it } from "vitest";
import { debriefFor, rhythmMinutes } from "./debrief";
import { cleanOnly, drift19_22_20, easeReady, makeRound, single } from "./fixtures";
import { selectWindow } from "./ledger";
import type { PlanRound } from "./types";

function debrief(
  round: PlanRound,
  rounds: readonly PlanRound[],
  over: { forecastEnabled?: boolean; lifetimeRounds?: number; signalPhrase?: string } = {},
) {
  return debriefFor({
    round,
    rounds: selectWindow(rounds, { includeDiscarded: true }),
    forecastEnabled: over.forecastEnabled ?? true,
    stretchEnabled: true,
    lifetimeRounds: over.lifetimeRounds,
    signalPhrase: over.signalPhrase ?? null,
  });
}

describe("rhythm", () => {
  it("is the median gap between onsets, and null below two", () => {
    expect(rhythmMinutes([])).toBeNull();
    expect(rhythmMinutes([19 * 60])).toBeNull();
    expect(rhythmMinutes([19 * 60, 26 * 60, 31 * 60])).toBe(6);
  });
});

describe("the debrief always states what was and was not measured (H11)", () => {
  const cases: Array<[string, () => ReturnType<typeof debrief>]> = [
    ["a drifted round", () => debrief(single.rounds[0]!, single.rounds)],
    ["a clean round", () => debrief(cleanOnly.rounds[0]!, cleanOnly.rounds)],
    [
      "a short aborted round",
      () => {
        const round = makeRound({ servedMin: 3, driftMin: null, status: "discarded" });
        return debrief(round, [round]);
      },
    ],
    [
      "a round that started drifted",
      () => {
        const round = makeRound({ driftMin: 0.2, startedDrifted: true });
        return debrief(round, [round]);
      },
    ],
    [
      "a round with the forecast off",
      () => {
        const round = makeRound({ driftMin: 19, forecastOn: false });
        return debrief(round, [round], { forecastEnabled: false });
      },
    ],
  ];

  it.each(cases)("%s has a non-empty theNumber and nextRound", (_name, build) => {
    const d = build();
    expect(d.copy.theNumber.length).toBeGreaterThan(0);
    expect(d.copy.nextRound.length).toBeGreaterThan(0);
    expect(d.copy.headline.length).toBeGreaterThan(0);
    expect(d.copy.kicker.length).toBeGreaterThan(0);
  });

  it("a censored round says 'past X and nothing more precise', never a drift time (H1, H2)", () => {
    const d = debrief(cleanOnly.rounds[0]!, cleanOnly.rounds);
    expect(d.censored).toBe(true);
    expect(d.heldMin).toBeNull();
    expect(d.copy.theNumber).toContain("did not drift");
    expect(d.copy.theNumber).toContain("past 25 minutes");
    expect(d.copy.theNumber).toContain("nothing more precise");
  });

  it("a drifted round reports MUFD and the median beside it", () => {
    const round = drift19_22_20.rounds[2]!;
    const d = debrief(round, drift19_22_20.rounds);
    expect(d.heldMin).toBe(20);
    expect(d.notCounted).toBe(false);
    expect(d.copy.theNumber).toContain("Minutes to first drift: 20");
    expect(d.copy.theNumber).toContain("median is 20");
  });

  it("a short round is recorded, disclosed, and changes nothing", () => {
    const round = makeRound({ servedMin: 3, driftMin: null, status: "discarded" });
    const d = debrief(round, [round]);
    expect(d.notCounted).toBe(true);
    expect(d.copy.notCountedLine).not.toBeNull();
    expect(d.copy.theNumber).toContain("Too short to measure");
    expect(d.next.estimate.rung).toBe("no-history");
  });

  it("a round that started drifted says the drift was minute zero, and is left out", () => {
    const round = makeRound({ driftMin: 0.2, startedDrifted: true });
    const d = debrief(round, [round]);
    expect(d.notCounted).toBe(true);
    expect(d.copy.headline).toContain("started with a blocked app");
    expect(d.copy.theNumber).toContain("window layout");
    expect(d.series).toHaveLength(0);
  });

  it("notCountedLine is present exactly when the round is not counted", () => {
    const counted = debrief(single.rounds[0]!, single.rounds);
    expect(counted.notCounted).toBe(false);
    expect(counted.copy.notCountedLine).toBeNull();
  });
});

describe("where it went", () => {
  it("names the peak and its lead over the drift", () => {
    const d = debrief(single.rounds[0]!, single.rounds);
    expect(d.copy.whereItWent).toContain("78%");
    expect(d.copy.whereItWent).toContain("14 minutes in");
    expect(d.copy.whereItWent).toContain("before your first drift");
  });

  it("a wobble that stood down is reported as a warning, not a drift (H7)", () => {
    const round = makeRound({
      driftMin: null,
      wobbleMin: 11,
      standDowns: 1,
      peakRisk: 0.55,
      peakRiskMin: 11,
    });
    const d = debrief(round, [round]);
    expect(d.copy.whereItWent).toContain("wobble");
    expect(d.copy.whereItWent).toContain("warning, not a drift");
    expect(d.copy.rhythm).toBeNull();
  });

  it("a clean round with no warning at all says so", () => {
    const round = makeRound({ driftMin: null, peakRisk: 0.41, peakRiskMin: 18 });
    const d = debrief(round, [round]);
    expect(d.copy.whereItWent).toContain("came back down on its own");
    expect(d.copy.whereItWent).toContain("No nudge, no fuse.");
  });

  it("with the forecast off it says there is no risk curve, and never invents one", () => {
    const round = makeRound({ driftMin: 19, forecastOn: false });
    const d = debrief(round, [round], { forecastEnabled: false });
    expect(d.copy.whereItWent).toContain("Focus Forecast is off");
    expect(d.copy.whereItWent).not.toMatch(/\d+%/);
  });

  it("the feature phrase comes from the renderer, never from a second copy table here", () => {
    const d = debrief(single.rounds[0]!, single.rounds, {
      signalPhrase: "grey-app time (64% of the last 60 s)",
    });
    expect(d.copy.whereItWent).toContain("The strongest signal at that moment was");
    expect(d.copy.whereItWent).toContain("grey-app time");
    // Never "because": an attribution is an occlusion delta, not a cause.
    expect(d.copy.whereItWent).not.toContain("because");
  });
});

describe("rhythm and cost", () => {
  it("reports several drifts and the gap between them", () => {
    const round = makeRound({ driftMin: 19, driftsMin: [19, 26, 31], countdowns: 2, kills: 1 });
    const d = debrief(round, [round]);
    expect(d.rhythmMin).toBe(6);
    expect(d.copy.rhythm).toContain("3 drifts");
    expect(d.copy.rhythm).toContain("19, 26 and 31");
    expect(d.copy.rhythm).toContain("roughly every 6 minutes");
  });

  it("names the cost only when something actually burned", () => {
    const quiet = makeRound({ driftMin: null });
    expect(debrief(quiet, [quiet]).copy.cost).toBeNull();
    const costly = makeRound({ driftMin: 19, countdowns: 1, kills: 1 });
    expect(debrief(costly, [costly]).copy.cost).toContain("1 fuse burned");
    expect(debrief(costly, [costly]).copy.cost).toContain("Nothing else was touched");
  });
});

describe("the next round", () => {
  it("is recomputed with this round folded in", () => {
    const round = easeReady.rounds[easeReady.rounds.length - 1]!;
    const d = debrief(round, easeReady.rounds);
    expect(d.next.step).toBe("ease");
    expect(d.copy.nextRound).toContain("17 minutes");
    expect(d.copy.nextRound).toContain("goes back up");
  });

  it("the first round ever logged says it is the baseline", () => {
    const d = debrief(single.rounds[0]!, single.rounds, { lifetimeRounds: 1 });
    expect(d.copy.headline).toContain("First round logged");
  });

  it("the sparkline series carries one mark per eligible round, oldest first", () => {
    const d = debrief(drift19_22_20.rounds[2]!, drift19_22_20.rounds);
    expect(d.series.map((point) => point.minutes)).toEqual([19, 22, 20]);
    expect(d.series.every((point) => point.censored === false)).toBe(true);
  });
});
