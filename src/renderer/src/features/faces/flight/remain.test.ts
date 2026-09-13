import { describe, expect, it } from "vitest";
import { parseFlightMapView } from "./mapView";
import {
  flightStatusLine,
  formatRemainHms,
  formatStudied,
  studiedSeconds,
} from "./remain";
import {
  bezierPoint,
  buildTerrainMesh,
  CLOSE_PAD,
  CLOSE_RIVER,
  CLOSE_RIVER_TAIL,
  FLIGHT_DRAW_TRIANGLES_MAX,
  hashRouteSeed,
  ROUTE_PATH,
} from "./terrain";

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
  it("keeps the whole-map route between the stepped-up clock and the stats strip", () => {
    for (let i = 0; i <= 20; i += 1) {
      const y = bezierPoint(ROUTE_PATH, i / 20).y;
      expect(y).toBeGreaterThan(0.38);
      expect(y).toBeLessThan(0.62);
    }
  });

  it("keeps the close river clear of the plane, the clock and the stats", () => {
    // Screen fraction of the padded close layer, the way drawFlightFace blits it.
    const toScreen = (v: number): number => v * (1 + 2 * CLOSE_PAD) - CLOSE_PAD;
    for (const curve of [CLOSE_RIVER, CLOSE_RIVER_TAIL]) {
      for (let i = 0; i <= 40; i += 1) {
        const p = bezierPoint(curve, i / 40);
        const x = toScreen(p.x);
        const y = toScreen(p.y);
        if (y > 0.2) {
          expect(x).toBeLessThan(0.24);
        }
        expect(y).toBeLessThan(0.7);
      }
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

  it("keeps a straight frame: border vertices sit on the edges", () => {
    const width = 640;
    const height = 400;
    const mesh = buildTerrainMesh(width, height, hashRouteSeed("DUB", "EDI"), "route");
    const verts = [...new Set(mesh.triangles.flatMap((t) => [t.a, t.b, t.c]))];
    expect(verts.filter((v) => v.x === 0)).toHaveLength(mesh.rows + 1);
    expect(verts.filter((v) => v.x === width)).toHaveLength(mesh.rows + 1);
    expect(verts.filter((v) => v.y === 0)).toHaveLength(mesh.cols + 1);
    expect(verts.filter((v) => v.y === height)).toHaveLength(mesh.cols + 1);
    for (const v of verts) {
      expect(v.x).toBeGreaterThanOrEqual(0);
      expect(v.x).toBeLessThanOrEqual(width);
      expect(v.y).toBeGreaterThanOrEqual(0);
      expect(v.y).toBeLessThanOrEqual(height);
    }
  });

  it("is deterministic for a route seed", () => {
    const a = buildTerrainMesh(200, 120, hashRouteSeed("JFK", "LHR"), "close");
    const b = buildTerrainMesh(200, 120, hashRouteSeed("JFK", "LHR"), "close");
    expect(a.triangles.length).toBe(b.triangles.length);
    expect(a.triangles[0]?.color).toBe(b.triangles[0]?.color);
  });
});
