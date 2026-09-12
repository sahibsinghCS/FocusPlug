import { describe, expect, it } from "vitest";
import {
  bloomAmount,
  fireflyAlpha,
  gardenPhase,
  gardenPhaseLabel,
  grassSway,
  moonDisk,
  starAlpha,
  sunDisk,
  sunElevation,
} from "./math";
import { buildGardenWorld } from "./world";

describe("garden sunrise math", () => {
  it("treats progress as sun elevation and keeps the disk below the horizon at night", () => {
    expect(sunElevation(-2)).toBe(0);
    expect(sunElevation(1.4)).toBe(1);
    expect(sunElevation(Number.NaN)).toBe(0);
    const night = sunDisk(0, 1280, 380);
    const dawn = sunDisk(0.48, 1280, 380);
    const day = sunDisk(1, 1280, 380);
    expect(night.aboveHorizon).toBe(false);
    expect(night.y).toBeGreaterThan(dawn.y);
    expect(dawn.aboveHorizon).toBe(true);
    expect(day.y).toBeLessThan(dawn.y);
    expect(day.x).toBeGreaterThan(night.x);
    expect(day.elevation).toBe(1);
  });

  it("shows the moon at night and fades it by full day", () => {
    const night = moonDisk(0, 1280, 380);
    const day = moonDisk(1, 1280, 380);
    expect(night.alpha).toBeGreaterThan(0.9);
    expect(day.alpha).toBe(0);
    expect(starAlpha(0)).toBeGreaterThan(0.8);
    expect(starAlpha(1)).toBe(0);
    expect(fireflyAlpha(0)).toBeGreaterThan(0.7);
    expect(fireflyAlpha(1)).toBe(0);
  });

  it("names night, twilight, dawn, and day from elevation", () => {
    expect(gardenPhase(0)).toBe("night");
    expect(gardenPhaseLabel("night")).toBe("NIGHT");
    expect(gardenPhase(0.3)).toBe("twilight");
    expect(gardenPhase(0.55)).toBe("dawn");
    expect(gardenPhase(0.9)).toBe("day");
    expect(bloomAmount(0)).toBeLessThan(0.1);
    expect(bloomAmount(1)).toBe(1);
  });

  it("keeps grass phase-offset so freeze-at-zero still sways", () => {
    expect(grassSway(0, 0.1, 0)).not.toBe(grassSway(0, 0.8, 0));
    expect(grassSway(0, 0.4, 0)).not.toBe(0);
  });
});

describe("garden world", () => {
  it("seeds a colorful orchard from sessionId and stays deterministic", () => {
    const a = buildGardenWorld("gauntlet-garden-01");
    const b = buildGardenWorld("gauntlet-garden-01");
    expect(a.trees.length).toBeGreaterThanOrEqual(5);
    expect(a.flowers.length).toBeGreaterThan(40);
    expect(a.blades.length).toBeGreaterThan(80);
    expect(a.stars.length).toBeGreaterThan(20);
    expect(a.fireflies.length).toBeGreaterThan(8);
    expect(a.trees.map((tree) => tree.x)).toEqual(b.trees.map((tree) => tree.x));
    expect(a.flowers[0]?.kind).toBe(b.flowers[0]?.kind);
    expect(() => buildGardenWorld("")).toThrow(/sessionId/);
  });
});
