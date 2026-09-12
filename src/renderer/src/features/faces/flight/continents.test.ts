import { describe, expect, it } from "vitest";
import { landCoverage } from "./continents";
import { latLonToUnit, unitToLatLon } from "./math";
import { buildFlightModel } from "./model";

const NOW = Date.parse("2026-09-12T16:00:00.000Z");

describe("continent mask", () => {
  it("marks New York and London as land and the mid-Atlantic as ocean", () => {
    expect(landCoverage(40.7, -74)).toBeGreaterThan(0.4);
    expect(landCoverage(51.5, -0.1)).toBeGreaterThan(0.4);
    expect(landCoverage(40, -40)).toBeLessThan(0.4);
  });

  it("keeps Dublin and Edinburgh on land and the Irish Sea as water", () => {
    expect(landCoverage(53.43, -6.25, "coast")).toBeGreaterThan(0.5);
    expect(landCoverage(55.95, -3.19, "coast")).toBeGreaterThan(0.5);
    expect(landCoverage(53.48, -2.24, "coast")).toBeGreaterThan(0.5);
    expect(landCoverage(51.48, -3.18, "coast")).toBeGreaterThan(0.5);
    expect(landCoverage(57.48, -4.23, "coast")).toBeGreaterThan(0.5);
    expect(landCoverage(53.8, -5.35, "coast")).toBeLessThan(0.35);
    expect(landCoverage(55.0, -5.6, "coast")).toBeLessThan(0.35);
    expect(landCoverage(50.7, 0.8, "coast")).toBeLessThan(0.35);
    expect(landCoverage(53.5, -12.5, "coast")).toBeLessThan(0.2);
    expect(landCoverage(54.0, -15.0, "coast")).toBeLessThan(0.2);
  });

  it("keeps the zoomed DUB–EDI cap from filling with fake land", () => {
    const model = buildFlightModel(
      {
        remaining: 27 * 60,
        estimateMinutes: 50,
        now: NOW,
        paused: true,
        complete: false,
        reducedMotion: false,
      },
      0.35,
    );
    const zoom = model.cameraZoom;
    const samples: string[] = [];
    for (const [sx, sy, name] of [
      [0, 0, "center"],
      [-1, 0, "left"],
      [1, 0, "right"],
      [0, 1, "up"],
      [0, -1, "down"],
      [-0.6, 0, "left60"],
    ] as const) {
      const vx = sx / zoom;
      const vy = sy / zoom;
      const rr = vx * vx + vy * vy;
      const vz = Math.sqrt(Math.max(0, 1 - rr));
      const wx =
        vx * model.cameraRight[0] + vy * model.cameraUp[0] + vz * model.cameraForward[0];
      const wy =
        vx * model.cameraRight[1] + vy * model.cameraUp[1] + vz * model.cameraForward[1];
      const wz =
        vx * model.cameraRight[2] + vy * model.cameraUp[2] + vz * model.cameraForward[2];
      const geo = unitToLatLon([wx, wy, wz]);
      const land = landCoverage(geo.lat, geo.lon, "coast");
      samples.push(`${name} ${geo.lat.toFixed(2)},${geo.lon.toFixed(2)} land=${land.toFixed(2)}`);
    }
    expect(landCoverage(model.planeLat, model.planeLon, "coast")).toBeLessThan(0.35);
    expect(samples.join(" | ")).toMatch(/center 54\.\d+,-4\.\d+ land=0/);
    expect(samples.join(" | ")).toMatch(/right .*,-22\.\d+ land=0/);
  });
});
