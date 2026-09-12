import { describe, expect, it } from "vitest";
import { AIRPORTS } from "./airports";
import {
  bearing,
  estimateMinutes,
  formatKm,
  greatCircleKm,
  interpolate,
  routeForMinutes,
} from "./route";

const LHR = { lat: 51.47, lon: -0.45 };
const JFK = { lat: 40.64, lon: -73.78 };
const SYD = { lat: -33.95, lon: 151.18 };

describe("flight route", () => {
  it("measures great-circle distance against known pairs", () => {
    // Published LHR-JFK is about 5,540 km; LHR-SYD about 16,990 km.
    expect(greatCircleKm(LHR, JFK)).toBeGreaterThan(5450);
    expect(greatCircleKm(LHR, JFK)).toBeLessThan(5650);
    expect(greatCircleKm(LHR, SYD)).toBeGreaterThan(16800);
    expect(greatCircleKm(LHR, SYD)).toBeLessThan(17150);
    expect(greatCircleKm(LHR, LHR)).toBeCloseTo(0, 6);
  });

  it("walks the great circle from end to end", () => {
    expect(interpolate(LHR, JFK, 0)).toEqual({ lat: LHR.lat, lon: LHR.lon });
    expect(interpolate(LHR, JFK, 1)).toEqual({ lat: JFK.lat, lon: JFK.lon });

    // The midpoint of a northern-hemisphere crossing arcs poleward of both ends.
    const mid = interpolate(LHR, JFK, 0.5);
    expect(mid.lat).toBeGreaterThan(Math.max(LHR.lat, JFK.lat) - 3);
    expect(mid.lon).toBeLessThan(LHR.lon);
    expect(mid.lon).toBeGreaterThan(JFK.lon);
  });

  it("clamps interpolation outside the route", () => {
    expect(interpolate(LHR, JFK, -2)).toEqual(interpolate(LHR, JFK, 0));
    expect(interpolate(LHR, JFK, 9)).toEqual(interpolate(LHR, JFK, 1));
  });

  it("points roughly west leaving London for New York", () => {
    const heading = bearing(LHR, JFK);
    expect(heading).toBeGreaterThan(255);
    expect(heading).toBeLessThan(310);
    expect(bearing({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 4);
    expect(bearing({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 4);
  });

  it("estimates block time with ground movement included", () => {
    expect(estimateMinutes(0)).toBe(25);
    expect(estimateMinutes(800)).toBe(85);
  });

  it("picks a real pair, and the same pair every time for a given length", () => {
    for (const minutes of [5, 25, 50, 90, 120]) {
      const route = routeForMinutes(minutes);
      expect(route.from.iata).not.toBe(route.to.iata);
      expect(AIRPORTS).toContain(route.from);
      expect(AIRPORTS).toContain(route.to);
      expect(routeForMinutes(minutes)).toEqual(route);
    }
  });

  it("lands close to the asked-for length once a real flight that long exists", () => {
    for (const minutes of [50, 75, 120]) {
      const route = routeForMinutes(minutes);
      expect(Math.abs(route.minutes - minutes)).toBeLessThanOrEqual(3);
    }
  });

  it("falls back to the shortest hops when nothing is that brief", () => {
    // No scheduled flight is five minutes long, so the pick lands among the
    // shortest hops in the table rather than failing to draw anything.
    const route = routeForMinutes(5);
    expect(route.km).toBeLessThan(1200);
  });

  it("survives nonsense input instead of drawing nothing", () => {
    expect(routeForMinutes(Number.NaN).from.iata).toBeTruthy();
    expect(routeForMinutes(-10).from.iata).toBeTruthy();
  });

  it("formats distance with a thousands separator", () => {
    expect(formatKm(5555.4)).toBe("5,555 km");
    expect(formatKm(342)).toBe("342 km");
  });
});
