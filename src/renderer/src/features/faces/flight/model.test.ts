import { describe, expect, it } from "vitest";
import type { FaceProps } from "../types";
import { MAX_CRUISE_KMH } from "./math";
import { buildFlightModel } from "./model";
import { DEFAULT_ARR, DEFAULT_DEP, resolveRoute } from "./airports";
import { toFlightClock } from "./clock";
import { formatRemainHms, studiedSeconds } from "./remain";

const NOW = Date.parse("2026-09-12T16:00:00.000Z");

describe("flight model", () => {
  it("defaults to DUB→EDI and honors a persisted pair", () => {
    const route = resolveRoute(undefined);
    expect(route.dep.code).toBe("DUB");
    expect(route.arr.code).toBe("EDI");
    expect(DEFAULT_DEP.lat).toBeCloseTo(53.4264, 3);
    expect(DEFAULT_ARR.lon).toBeCloseTo(-3.3725, 3);
    const custom = resolveRoute({ dep: "JFK", arr: "LHR" });
    expect(custom.dep.code).toBe("JFK");
    expect(custom.arr.code).toBe("LHR");
  });

  it("keeps the remaining clock on the session they chose", () => {
    const model = buildFlightModel({
      remaining: 27 * 60,
      estimateMinutes: 50,
      now: NOW,
      paused: false,
      complete: false,
      reducedMotion: false,
    });
    expect(model.dep.code).toBe("DUB");
    expect(model.arr.code).toBe("EDI");
    expect(model.phase).toBe("cruise");
    expect(formatRemainHms(model.remaining)).toBe("0:27:00");
    expect(studiedSeconds(model.estimateMinutes, model.remaining)).toBe(23 * 60);
    expect(model.gsKmh).toBeLessThan(1000);
  });

  it("pulls back and names the destination when complete", () => {
    const model = buildFlightModel({
      remaining: 0,
      estimateMinutes: 90,
      now: NOW,
      paused: true,
      complete: true,
      reducedMotion: false,
    });
    expect(model.phase).toBe("complete");
    expect(model.arr.name).toBe("Edinburgh");
    expect(model.remainKm).toBe(0);
    expect(model.gsKmh).toBe(0);
    expect(model.planeLat).toBeCloseTo(DEFAULT_ARR.lat, 3);
    expect(formatRemainHms(model.remaining)).toBe("0:00:00");
  });

  it("keeps DUB–EDI ground speed under 1,000 kph on a 5-minute lock break", () => {
    const now = new Date("2026-09-12T16:00:00.000Z");
    const props: FaceProps = {
      progress: 0.4,
      phase: "break",
      elapsedMs: 120_000,
      remainingMs: 180_000,
      estimateMinutes: 5,
      sessionProgress: 25 / 55,
      sessionElapsedMs: 25 * 60_000,
      sessionRemainingMs: 30 * 60_000,
      sessionEstimateMinutes: 55,
      sessionId: "lock",
      events: [],
      killCount: 0,
      now,
      width: 1280,
      height: 800,
      paused: false,
    };
    const model = buildFlightModel(toFlightClock(props));
    expect(model.estimateMinutes).toBe(55);
    expect(model.remaining).toBeCloseTo(30 * 60, 5);
    expect(formatRemainHms(model.remaining)).toBe("0:30:00");
    expect(model.gsKmh).toBeGreaterThan(100);
    expect(model.gsKmh).toBeLessThan(1000);
    expect(model.gsKmh).toBeLessThanOrEqual(MAX_CRUISE_KMH);
    expect(model.phase).not.toBe("complete");
  });

  it("keeps DUB–EDI ground speed under 1,000 kph in a 25-minute lock focus", () => {
    const now = new Date("2026-09-12T16:00:00.000Z");
    const props: FaceProps = {
      progress: 0.2,
      phase: "focus",
      elapsedMs: 5 * 60_000,
      remainingMs: 20 * 60_000,
      estimateMinutes: 25,
      sessionProgress: 5 / 55,
      sessionElapsedMs: 5 * 60_000,
      sessionRemainingMs: 50 * 60_000,
      sessionEstimateMinutes: 55,
      sessionId: "lock",
      events: [],
      killCount: 0,
      now,
      width: 1280,
      height: 800,
      paused: false,
    };
    const model = buildFlightModel(toFlightClock(props));
    expect(model.estimateMinutes).toBe(55);
    expect(model.gsKmh).toBeGreaterThan(100);
    expect(model.gsKmh).toBeLessThan(1000);
    expect(model.phase).toBe("cruise");
    expect(formatRemainHms(model.remaining)).toBe("0:50:00");
  });

  it("caps a short sit on JFK–LHR so focus ground speed stays under 1,000 kph", () => {
    const now = new Date("2026-09-12T16:00:00.000Z");
    const props: FaceProps = {
      progress: 0.5,
      phase: "focus",
      elapsedMs: 25 * 60_000,
      remainingMs: 25 * 60_000,
      estimateMinutes: 50,
      sessionProgress: 0.5,
      sessionElapsedMs: 25 * 60_000,
      sessionRemainingMs: 25 * 60_000,
      sessionEstimateMinutes: 50,
      sessionId: "lock",
      events: [],
      killCount: 0,
      now,
      width: 1280,
      height: 800,
      paused: false,
    };
    const model = buildFlightModel(
      toFlightClock(props, { settings: { dep: "JFK", arr: "LHR" } }),
    );
    expect(model.gsKmh).toBe(MAX_CRUISE_KMH);
    expect(model.gsKmh).toBeLessThan(1000);
    expect(model.remainKm).toBeGreaterThan(2000);
  });
});
