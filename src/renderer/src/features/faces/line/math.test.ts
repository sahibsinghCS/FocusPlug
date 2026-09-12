import { describe, expect, it } from "vitest";
import { DEMO_ROUNDS } from "../fixtures";
import { faceFixture } from "../fixtures";
import {
  assertOrthogonal,
  pointAtProgress,
  resolveStations,
  segmentKindAt,
  segmentMetrics,
  transitPolyline,
  twoStopStations,
} from "./math";

describe("line transit math", () => {
  it("keeps a 45° / 90° polyline and interpolates along cumulative length", () => {
    const path = transitPolyline();
    expect(assertOrthogonal(path)).toBe(true);
    const { total } = segmentMetrics(path);
    expect(total).toBeGreaterThan(0.5);
    const start = pointAtProgress(path, 0);
    const end = pointAtProgress(path, 1);
    const mid = pointAtProgress(path, 0.5);
    expect(start.x).toBeCloseTo(path[0]!.x, 5);
    expect(end.x).toBeCloseTo(path[path.length - 1]!.x, 5);
    expect(mid.traveled).toBeCloseTo(total * 0.5, 5);
    expect(mid.x).not.toBeCloseTo(start.x, 2);
  });

  it("uses plan round boundaries, thirds, or a two-stop line", () => {
    const rounds = resolveStations(faceFixture("line", "rounds"));
    expect(rounds.length).toBeGreaterThan(3);
    expect(rounds.some((station) => station.kind === "break")).toBe(true);
    expect(rounds[0]?.label).toBe("Start");
    expect(rounds[rounds.length - 1]?.label).toBe("End");

    const thirds = resolveStations(faceFixture("line", "thirds"));
    expect(thirds.map((station) => station.at)).toEqual([0, 1 / 3, 2 / 3, 1]);

    const plain = resolveStations(faceFixture("line", "plain"));
    expect(plain).toEqual(twoStopStations());

    const idle = resolveStations(faceFixture("line", "idle"));
    expect(idle).toHaveLength(2);
  });

  it("colors break segments from phase / rounds", () => {
    expect(segmentKindAt(DEMO_ROUNDS, 0.34, "focus")).toBe("break");
    expect(segmentKindAt(DEMO_ROUNDS, 0.5, "focus")).toBe("focus");
    expect(segmentKindAt(undefined, 0.5, "break")).toBe("break");
  });
});
