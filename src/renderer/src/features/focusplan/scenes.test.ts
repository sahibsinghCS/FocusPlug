import { describe, expect, it } from "vitest";
import { PLAN_DEBRIEF_FRESH_MS, debriefFor, recommend, selectWindow } from "@shared/plan";
import { PLAN_SCENES, planSceneState, readPlanScene } from "./scenes";
import { holdSparkline, isFreshDebrief, newestRound } from "./model";

const NOW = 1_800_000_000_000;

describe("readPlanScene", () => {
  it("reads the scene from the query or the hash, and ignores session scenes", () => {
    expect(readPlanScene("?scene=plan-cold", "")).toBe("plan-cold");
    expect(readPlanScene("", "#/session?scene=debrief-clean")).toBe("debrief-clean");
    expect(readPlanScene("?scene=golden", "")).toBeNull();
    expect(readPlanScene("", "")).toBeNull();
  });
});

describe("planSceneState", () => {
  it("has a state for every advertised scene", () => {
    for (const scene of PLAN_SCENES) {
      expect(planSceneState(scene, NOW)).not.toBeNull();
    }
    expect(planSceneState(null, NOW)).toBeNull();
  });

  it("plan-cold is the fresh install — and the card still says something", () => {
    const state = planSceneState("plan-cold", NOW)!;
    expect(state.rounds).toHaveLength(0);
    const rec = recommend({
      rounds: state.rounds,
      live: null,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    expect(rec.estimate.rung).toBe("no-history");
    expect(rec.copy.headline.length).toBeGreaterThan(0);
  });

  it("plan-measured reproduces the decided 19 / 22 / 20 beat", () => {
    const state = planSceneState("plan-measured", NOW)!;
    const rec = recommend({
      rounds: selectWindow(state.rounds, { includeDiscarded: true }),
      live: null,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    expect(rec.focusMin).toBe(20);
  });

  it("debrief-flat is the refused-but-not-short history, and the caption says which", () => {
    // The scene exists so there is a still of the case the caption used to get
    // wrong: every volume gate cleared, and the trend refused anyway.
    const state = planSceneState("debrief-flat", NOW)!;
    const rounds = selectWindow(state.rounds, { nowMs: NOW, includeDiscarded: true });
    const debrief = debriefFor({
      round: newestRound(rounds)!,
      rounds,
      forecastEnabled: true,
      stretchEnabled: true,
    });
    expect(debrief.next.trend.blockedBy).toBe("below-noise");
    const spark = holdSparkline(debrief.series, {
      medianMin: debrief.next.estimate.medianMin,
      trend: debrief.next.trend,
    });
    expect(spark.empty).toBe(false);
    expect(spark.line).toBeNull();
    expect(spark.caption).toBe("dots only — the change is smaller than your round-to-round spread.");
  });

  it("the debrief scenes land inside the freshness window the setup card uses", () => {
    for (const scene of ["debrief-drifted", "debrief-clean", "debrief-flat"] as const) {
      const state = planSceneState(scene, NOW)!;
      const round = newestRound(state.rounds)!;
      expect(isFreshDebrief(round, NOW)).toBe(true);
      expect(NOW - round.endedAt).toBeLessThan(PLAN_DEBRIEF_FRESH_MS);
    }
  });

  it("rebasing keeps the day spread the fixture wrote, so the gates do not move", () => {
    const original = planSceneState("plan-measured", NOW)!;
    const rebased = planSceneState("debrief-drifted", NOW)!;
    expect(new Set(rebased.rounds.map((round) => round.day)).size).toBe(
      new Set(original.rounds.map((round) => round.day)).size,
    );
    expect(rebased.rounds.map((round) => round.firstDriftSec)).toEqual(
      original.rounds.map((round) => round.firstDriftSec),
    );
  });
});
