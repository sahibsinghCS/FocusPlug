import { describe, expect, it } from "vitest";
import type { Decision } from "../types";
import {
  DRIFT_DEBOUNCE_SEC,
  RECOVERY_EXCLUDE_SEC,
  driftTypeFor,
  findDriftOnsets,
  isDriftedDecision,
  labelFrames,
  type DecisionFrame,
} from "./labels";
import { FORECAST_HORIZON_SEC, FORECAST_WARMUP_SEC } from "./types";

/** 1 Hz decision series from a compact spec: [decision, seconds] runs. */
function series(runs: Array<[Decision, number]>, countdownAt: number[] = []): DecisionFrame[] {
  const frames: DecisionFrame[] = [];
  let t = 0;
  for (const [decision, seconds] of runs) {
    for (let i = 0; i < seconds; i += 1) {
      frames.push({ t, decision, countdownActive: countdownAt.includes(t) });
      t += 1;
    }
  }
  return frames;
}

function labelAt(labels: ReturnType<typeof labelFrames>, t: number) {
  const found = labels.find((label) => label.t === t);
  expect(found, `frame at t=${t}`).toBeDefined();
  return found as NonNullable<typeof found>;
}

describe("drift decision helpers", () => {
  it("classifies decisions the way policy does", () => {
    expect(isDriftedDecision("DISTRACTED")).toBe(true);
    expect(isDriftedDecision("AWAY")).toBe(true);
    expect(isDriftedDecision("ON_TASK")).toBe(false);
    expect(isDriftedDecision("IDLE")).toBe(false);
    expect(driftTypeFor("DISTRACTED")).toBe("tab_out");
    expect(driftTypeFor("AWAY")).toBe("walk_away");
    expect(driftTypeFor("ON_TASK")).toBeNull();
    expect(driftTypeFor("IDLE")).toBeNull();
  });
});

describe("findDriftOnsets", () => {
  it("detects the entry frame of each drift with its type", () => {
    const frames = series([
      ["ON_TASK", 100],
      ["DISTRACTED", 10],
      ["ON_TASK", 100],
      ["AWAY", 10],
      ["ON_TASK", 20],
    ]);
    expect(findDriftOnsets(frames)).toEqual([
      { t: 100, driftType: "tab_out" },
      { t: 210, driftType: "walk_away" },
    ]);
  });

  it("a session that starts drifted yields no onset at frame 0", () => {
    const frames = series([
      ["DISTRACTED", 10],
      ["ON_TASK", 50],
    ]);
    expect(findDriftOnsets(frames)).toEqual([]);
  });

  it("DISTRACTED flowing into AWAY is one drift, not two", () => {
    const frames = series([
      ["ON_TASK", 50],
      ["DISTRACTED", 5],
      ["AWAY", 5],
      ["ON_TASK", 50],
    ]);
    expect(findDriftOnsets(frames)).toEqual([{ t: 50, driftType: "tab_out" }]);
  });

  it("merges onsets within the 30 s debounce of the previous kept onset", () => {
    const frames = series([
      ["ON_TASK", 50],
      ["DISTRACTED", 3], // onset t=50 (kept)
      ["ON_TASK", 10],
      ["DISTRACTED", 3], // onset t=63 — within 30 s of t=50, merged
      ["ON_TASK", 20],
      ["DISTRACTED", 3], // onset t=86 — 36 s after t=50, kept
      ["ON_TASK", 30],
    ]);
    expect(DRIFT_DEBOUNCE_SEC).toBe(30);
    expect(findDriftOnsets(frames)).toEqual([
      { t: 50, driftType: "tab_out" },
      { t: 86, driftType: "tab_out" },
    ]);
  });
});

describe("labelFrames horizon edges", () => {
  // Onset at t=100 in a 200 s session — long enough that nothing here is
  // right-censored or warm-up.
  const frames = series([
    ["ON_TASK", 100],
    ["DISTRACTED", 5],
    ["ON_TASK", 95],
  ]);
  const onsets = findDriftOnsets(frames);
  const labels = labelFrames(frames, onsets, 199);

  it("secs_to_drift 30 is a positive, 31 is not", () => {
    expect(FORECAST_HORIZON_SEC).toBe(30);
    const at70 = labelAt(labels, 70);
    expect(at70.secsToDrift).toBe(30);
    expect(at70.label).toBe(1);
    expect(at70.driftType).toBe("tab_out");
    const at69 = labelAt(labels, 69);
    expect(at69.secsToDrift).toBe(31);
    expect(at69.label).toBe(0);
    expect(at69.driftType).toBeNull();
  });

  it("one second before onset is a positive; the onset frame itself is excluded", () => {
    const at99 = labelAt(labels, 99);
    expect(at99.secsToDrift).toBe(1);
    expect(at99.label).toBe(1);
    expect(at99.excluded).toBe(false);
    const at100 = labelAt(labels, 100);
    expect(at100.label).toBe(0);
    expect(at100.excluded).toBe(true); // active drift
  });
});

describe("labelFrames exclusion zones", () => {
  it("excludes the warm-up: t < 15 out, t = 15 in", () => {
    const frames = series([["ON_TASK", 100], ["DISTRACTED", 5], ["ON_TASK", 95]]);
    const labels = labelFrames(frames, findDriftOnsets(frames), 199);
    expect(FORECAST_WARMUP_SEC).toBe(15);
    expect(labelAt(labels, 14).excluded).toBe(true);
    expect(labelAt(labels, 15).excluded).toBe(false);
  });

  it("excludes active-drift and active-countdown frames", () => {
    const frames = series(
      [["ON_TASK", 100], ["DISTRACTED", 5], ["ON_TASK", 95]],
      [98, 99], // countdown burning just before the kill
    );
    const labels = labelFrames(frames, findDriftOnsets(frames), 199);
    expect(labelAt(labels, 98).excluded).toBe(true);
    expect(labelAt(labels, 102).excluded).toBe(true);
    expect(labelAt(labels, 97).excluded).toBe(false);
  });

  it("excludes the 10 s after recovery, inclusive start, exclusive end", () => {
    const frames = series([["ON_TASK", 100], ["DISTRACTED", 5], ["ON_TASK", 95]]);
    const labels = labelFrames(frames, findDriftOnsets(frames), 199);
    expect(RECOVERY_EXCLUDE_SEC).toBe(10);
    // Drift covers t=100..104; recovery frame is t=105.
    expect(labelAt(labels, 105).excluded).toBe(true);
    expect(labelAt(labels, 114).excluded).toBe(true);
    expect(labelAt(labels, 115).excluded).toBe(false);
  });

  it("right-censors the final 30 s only when no onset lies ahead", () => {
    const frames = series([["ON_TASK", 200]]);
    const labels = labelFrames(frames, [], 199);
    expect(labelAt(labels, 169).excluded).toBe(false);
    expect(labelAt(labels, 170).excluded).toBe(true); // 199-170 < 30
    expect(labelAt(labels, 199).excluded).toBe(true);
    // With a drift at the very end the same frames are eligible positives.
    const drifting = series([["ON_TASK", 195], ["DISTRACTED", 5]]);
    const labeled = labelFrames(drifting, findDriftOnsets(drifting), 199);
    const at180 = labelAt(labeled, 180);
    expect(at180.excluded).toBe(false);
    expect(at180.secsToDrift).toBe(15);
    expect(at180.label).toBe(1);
  });

  it("a positive can still be excluded (countdown) — exclusion wins downstream", () => {
    const frames = series(
      [["ON_TASK", 100], ["DISTRACTED", 5], ["ON_TASK", 95]],
      [95],
    );
    const labels = labelFrames(frames, findDriftOnsets(frames), 199);
    const at95 = labelAt(labels, 95);
    expect(at95.label).toBe(1);
    expect(at95.excluded).toBe(true);
  });
});
