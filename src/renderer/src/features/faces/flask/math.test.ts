import { describe, expect, it } from "vitest";
import type { FacePhase } from "@shared/faces";
import {
  FLASK_GEOM,
  STILL_CLOCK_MS,
  dripPhases,
  fitFlaskView,
  leakActive,
  radiusAtY,
  remainingFill,
  resolveClockMs,
  streamControls,
  waterCoversSpigot,
  waterLineY,
} from "./math";

describe("flask remaining water", () => {
  it("empties as session progress advances", () => {
    expect(remainingFill(0)).toBe(1);
    expect(remainingFill(1)).toBe(0);
    expect(remainingFill(0.62)).toBeCloseTo(0.38, 5);
    expect(remainingFill(1.4)).toBe(0);
    expect(remainingFill(Number.NaN)).toBe(1);
  });

  it("lowers the meniscus as the flask empties", () => {
    const full = waterLineY(1);
    const mid = waterLineY(0.38);
    const empty = waterLineY(0);
    expect(full).toBeLessThan(mid);
    expect(mid).toBeLessThan(empty);
    expect(mid).toBeGreaterThan(FLASK_GEOM.shoulderY);
    expect(mid).toBeLessThan(FLASK_GEOM.baseY);
  });

  it("keeps the mid-session meniscus above the spigot so the valve is wet", () => {
    expect(waterCoversSpigot(0.38)).toBe(true);
    expect(waterCoversSpigot(0)).toBe(false);
    expect(waterLineY(0.38)).toBeLessThan(FLASK_GEOM.spigotY);
  });
});

describe("flask silhouette", () => {
  it("is a bottle: neck much narrower than the belly", () => {
    expect(FLASK_GEOM.neckRx).toBeLessThan(FLASK_GEOM.bellyRx * 0.3);
    expect(FLASK_GEOM.lipRx).toBeLessThan(FLASK_GEOM.bellyRx * 0.4);
    expect(radiusAtY(FLASK_GEOM.neckY)).toBeLessThan(radiusAtY(FLASK_GEOM.bellyY) * 0.3);
    expect(radiusAtY(FLASK_GEOM.bellyY) - radiusAtY(FLASK_GEOM.neckY)).toBeGreaterThan(40);
  });

  it("is not a stadium capsule — shoulders sit between neck and belly", () => {
    const neck = radiusAtY(FLASK_GEOM.neckY);
    const shoulder = radiusAtY(FLASK_GEOM.shoulderY);
    const belly = radiusAtY(FLASK_GEOM.bellyY);
    expect(shoulder).toBeGreaterThan(neck);
    expect(belly).toBeGreaterThan(shoulder);
    expect(FLASK_GEOM.spigotY).toBeGreaterThan(FLASK_GEOM.bellyY);
    expect(FLASK_GEOM.spigotY).toBeLessThan(FLASK_GEOM.baseY);
  });
});

describe("flask leak", () => {
  it("leaks during a live session while water remains, never while idle", () => {
    const live: FacePhase[] = ["focus", "break"];
    for (const phase of live) {
      expect(leakActive(phase, 0.38)).toBe(true);
      expect(leakActive(phase, 0.02)).toBe(false);
    }
    expect(leakActive("idle", 1)).toBe(false);
    expect(leakActive("idle", 0.38)).toBe(false);
  });

  it("keeps drips on the stream at the frozen still clock", () => {
    const phases = dripPhases(STILL_CLOCK_MS, 4, 900);
    expect(phases).toHaveLength(4);
    expect(new Set(phases.map((p) => p.toFixed(3))).size).toBe(4);
    expect(phases.every((p) => p >= 0 && p < 1)).toBe(true);
    expect(resolveClockMs(12, true)).toBe(STILL_CLOCK_MS);
  });

  it("drops the stream from the spigot to the shelf", () => {
    const stream = streamControls();
    expect(stream.end.y).toBeGreaterThan(stream.start.y + 40);
    expect(stream.start.x).toBeGreaterThan(FLASK_GEOM.cx + FLASK_GEOM.bellyRx);
    expect(stream.end.y).toBeLessThan(FLASK_GEOM.shelfY);
  });
});

describe("flask view fit", () => {
  it("scales the bottle to a 1280×800 still and a short host", () => {
    const solo = fitFlaskView(1280, 800);
    const host = fitFlaskView(960, 300);
    expect(solo.scale).toBeGreaterThan(1);
    expect(host.scale).toBeGreaterThan(0.4);
    expect(host.scale).toBeLessThan(solo.scale);
  });
});
