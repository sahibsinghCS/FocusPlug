import { describe, expect, it } from "vitest";
import { CITY_LIGHTS } from "./cities";
import { buildFlightModel, seedContrail } from "./model";
import { DEFAULT_ARR, DEFAULT_DEP, resolveRoute } from "./airports";

const NOW = Date.parse("2026-09-12T16:00:00.000Z");

describe("flight model", () => {
  it("defaults to JFK→LHR", () => {
    const route = resolveRoute(undefined);
    expect(route.dep.code).toBe("JFK");
    expect(route.arr.code).toBe("LHR");
    expect(DEFAULT_DEP.lat).toBeCloseTo(40.6413, 3);
    expect(DEFAULT_ARR.lon).toBeCloseTo(-0.4543, 3);
  });

  it("seeds a decaying 90s contrail behind the aircraft", () => {
    const samples = seedContrail(DEFAULT_DEP, DEFAULT_ARR, 0.5, 45 * 60, 90);
    expect(samples.length).toBeGreaterThan(20);
    expect(samples[0]?.ageSec).toBe(0);
    const last = samples[samples.length - 1];
    expect(last?.ageSec).toBeGreaterThan(80);
    expect(last?.ageSec).toBeLessThanOrEqual(90);
  });

  it("keeps the camera pointed near the aircraft, not a 6x zoom patch", () => {
    const model = buildFlightModel(
      { remaining: 45 * 60, estimateMinutes: 90, now: NOW },
      0.3,
    );
    expect(model.phase).toBe("cruise");
    expect(Math.abs(model.bank)).toBeLessThanOrEqual(25);
    expect(Math.abs(model.bank)).toBeGreaterThan(8);
    const look =
      model.planeLat * 0 +
      model.cameraForward[0] ** 2 +
      model.cameraForward[1] ** 2 +
      model.cameraForward[2] ** 2;
    expect(look).toBeCloseTo(1, 6);
  });

  it("pulls back and names the destination when complete", () => {
    const model = buildFlightModel({
      remaining: 0,
      estimateMinutes: 90,
      now: NOW,
      complete: true,
    });
    expect(model.phase).toBe("complete");
    expect(model.arr.name).toBe("London");
    expect(model.remainKm).toBe(0);
    expect(model.gsKmh).toBe(0);
    expect(model.planeLat).toBeCloseTo(DEFAULT_ARR.lat, 3);
  });

  it("lists about sixty city lights", () => {
    expect(CITY_LIGHTS.length).toBeGreaterThanOrEqual(60);
    expect(CITY_LIGHTS.length).toBeLessThan(80);
  });
});
