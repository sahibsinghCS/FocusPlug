import { describe, expect, it } from "vitest";
import { parseFlightMapView } from "./mapView";
import {
  flightStatusLine,
  formatRemainHms,
  formatStudied,
  studiedSeconds,
} from "./remain";
import { bezierPoint, FLIGHT_DRAW_TRIANGLES_MAX, buildTerrainMesh, hashRouteSeed, ROUTE_PATH } from "./terrain";

describe("session remaining clock", () => {
  it("prints the sit they chose as H:MM:SS, not a fake 10h hop", () => {
    expect(formatRemainHms(50 * 60)).toBe("0:50:00");
    expect(formatRemainHms(27 * 60)).toBe("0:27:00");
    expect(formatRemainHms(10 * 3600 + 38 * 60 + 53)).toBe("10:38:53");
    expect(formatRemainHms(0)).toBe("0:00:00");
  });

  it("tracks studied time from the same session remaining", () => {
    expect(studiedSeconds(50, 27 * 60)).toBe(23 * 60);
    expect(formatStudied(0)).toBe("0m");
    expect(formatStudied(23 * 60)).toBe("23m");
    expect(formatStudied(64 * 60)).toBe("1h 4m");
  });

  it("names climb / cruise / descent without a fake altitude", () => {
    expect(flightStatusLine("climb", false)).toBe("IN FLIGHT · CLIMBING OUT");
    expect(flightStatusLine("cruise", false)).toBe("IN FLIGHT · CRUISE");
    expect(flightStatusLine("descent", false)).toBe("IN FLIGHT · DESCENDING");
    expect(flightStatusLine("complete", true)).toBe("ARRIVED");
  });
});

describe("map view", () => {
  it("keeps the whole-map path under the remaining clock", () => {
    for (let i = 0; i <= 20; i += 1) {
      expect(bezierPoint(ROUTE_PATH, i / 20).y).toBeGreaterThan(0.58);
    }
  });

  it("defaults to the close in-flight plate", () => {
    expect(parseFlightMapView(null)).toBe("close");
    expect(parseFlightMapView("close")).toBe("close");
    expect(parseFlightMapView("route")).toBe("route");
    expect(parseFlightMapView("whole")).toBe("route");
  });
});

describe("cheap terrain", () => {
  it("stays under the triangle budget for both views", () => {
    const close = buildTerrainMesh(1280, 800, hashRouteSeed("DUB", "EDI"), "close");
    const route = buildTerrainMesh(1280, 800, hashRouteSeed("DUB", "EDI"), "route");
    expect(close.triangles.length).toBeGreaterThan(40);
    expect(close.triangles.length).toBeLessThanOrEqual(FLIGHT_DRAW_TRIANGLES_MAX);
    expect(route.triangles.length).toBeLessThanOrEqual(FLIGHT_DRAW_TRIANGLES_MAX);
    expect(close.river.length).toBeGreaterThan(10);
    expect(route.river.length).toBeGreaterThan(10);
  });

  it("is deterministic for a route seed", () => {
    const a = buildTerrainMesh(200, 120, hashRouteSeed("JFK", "LHR"), "close");
    const b = buildTerrainMesh(200, 120, hashRouteSeed("JFK", "LHR"), "close");
    expect(a.triangles.length).toBe(b.triangles.length);
    expect(a.triangles[0]?.color).toBe(b.triangles[0]?.color);
  });
});
