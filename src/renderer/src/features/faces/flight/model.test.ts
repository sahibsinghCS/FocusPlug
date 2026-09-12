import { describe, expect, it } from "vitest";
import { CITY_LIGHTS } from "./cities";
import { latLonToUnit } from "./math";
import { buildFlightModel, projectWorld, seedContrail } from "./model";
import { DEFAULT_ARR, DEFAULT_DEP, resolveRoute } from "./airports";

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

  it("seeds a decaying 90s contrail behind the aircraft", () => {
    const samples = seedContrail(DEFAULT_DEP, DEFAULT_ARR, 0.5, 45 * 60, 90);
    expect(samples.length).toBeGreaterThan(20);
    expect(samples[0]?.ageSec).toBe(0);
    const last = samples[samples.length - 1];
    expect(last?.ageSec).toBeGreaterThan(80);
    expect(last?.ageSec).toBeLessThanOrEqual(90);
  });

  it("zooms a short hop tightly and orbits while keeping the plane near center", () => {
    const model = buildFlightModel(
      {
        remaining: 25 * 60,
        estimateMinutes: 50,
        now: NOW,
        paused: false,
        complete: false,
        reducedMotion: false,
      },
      0.9,
    );
    expect(model.dep.code).toBe("DUB");
    expect(model.arr.code).toBe("EDI");
    expect(model.phase).toBe("cruise");
    expect(model.cameraZoom).toBeGreaterThan(8);
    expect(model.orbit).toBeCloseTo(0.9, 6);
    expect(Math.abs(model.bank)).toBeLessThanOrEqual(25);
    const pr = projectWorld(
      latLonToUnit(model.planeLat, model.planeLon),
      model,
      200,
      200,
      90,
    );
    expect(pr.visible).toBe(true);
    expect(Math.abs(pr.x - 200)).toBeLessThan(14);
    expect(Math.abs(pr.y - 200)).toBeLessThan(14);
  });

  it("uses a milder zoom on a long haul and a different orbit angle", () => {
    const a = buildFlightModel(
      {
        remaining: 45 * 60,
        estimateMinutes: 90,
        now: NOW,
        paused: false,
        complete: false,
        reducedMotion: false,
        settings: { dep: "JFK", arr: "LHR" },
      },
      0.2,
    );
    const b = buildFlightModel(
      {
        remaining: 45 * 60,
        estimateMinutes: 90,
        now: NOW,
        paused: false,
        complete: false,
        reducedMotion: false,
        settings: { dep: "JFK", arr: "LHR" },
      },
      1.4,
    );
    expect(a.cameraZoom).toBeGreaterThan(2);
    expect(a.cameraZoom).toBeLessThan(5);
    expect(a.orbit).not.toBeCloseTo(b.orbit, 3);
    expect(a.cameraRight[0]).not.toBeCloseTo(b.cameraRight[0], 3);
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
  });

  it("lists about sixty city lights", () => {
    expect(CITY_LIGHTS.length).toBeGreaterThanOrEqual(60);
    expect(CITY_LIGHTS.length).toBeLessThan(80);
  });
});
