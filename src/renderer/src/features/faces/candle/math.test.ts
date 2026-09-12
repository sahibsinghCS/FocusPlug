import { describe, expect, it } from "vitest";
import type { FacePhase } from "@shared/faces";
import {
  CANDLE_GEOM,
  DRIP_SITES,
  STILL_CLOCK_MS,
  buildCandlePose,
  dripLength,
  fitCandleView,
  flameScale,
  flameSputter,
  halfWidthAt,
  meltAmount,
  poolRadius,
  poseDrips,
  resolveClockMs,
  waxColumnHeight,
  waxRemain,
  waxTopY,
} from "./math";

describe("candle melt from progress", () => {
  it("burns shorter as session progress advances — elapsed up, wax down", () => {
    expect(meltAmount(0)).toBe(0);
    expect(meltAmount(1)).toBe(1);
    expect(meltAmount(0.5)).toBe(0.5);
    expect(meltAmount(1.4)).toBe(1);
    expect(meltAmount(Number.NaN)).toBe(0);
    expect(waxRemain(0)).toBe(1);
    expect(waxRemain(0.5)).toBe(0.5);
    expect(waxRemain(1)).toBe(0);

    const startH = waxColumnHeight(0.04);
    const midH = waxColumnHeight(0.5);
    const endH = waxColumnHeight(0.92);
    expect(startH).toBeGreaterThan(midH);
    expect(midH).toBeGreaterThan(endH);
    expect(waxTopY(0.04)).toBeLessThan(waxTopY(0.5));
    expect(waxTopY(0.5)).toBeLessThan(waxTopY(0.92));
    expect(endH / startH).toBeLessThan(0.4);
  });

  it("keeps a tall pillar at start and a stub near the end", () => {
    expect(waxTopY(0)).toBe(CANDLE_GEOM.fullTop);
    expect(waxTopY(1)).toBe(CANDLE_GEOM.stubTop);
    expect(waxColumnHeight(0)).toBeGreaterThan(400);
    expect(waxColumnHeight(0.92)).toBeLessThan(160);
    expect(waxColumnHeight(0.92)).toBeGreaterThan(80);
  });
});

describe("candle silhouette", () => {
  it("is a tapered pillar, not a flat rectangle", () => {
    expect(CANDLE_GEOM.topHalfW).toBeLessThan(CANDLE_GEOM.midHalfW);
    expect(CANDLE_GEOM.midHalfW).toBeLessThan(CANDLE_GEOM.baseHalfW);
    const top = halfWidthAt(waxTopY(0.5) + 8, 0.5);
    const base = halfWidthAt(CANDLE_GEOM.holderY - 8, 0.5);
    expect(base).toBeGreaterThan(top);
    expect(CANDLE_GEOM.baseHalfW).toBeGreaterThan(40);
    expect(CANDLE_GEOM.baseHalfW / waxColumnHeight(0)).toBeLessThan(0.15);
  });
});

describe("drips and pool follow progress, not the clock", () => {
  it("grows side drips and the base pool as the wax melts", () => {
    expect(poseDrips(0.02)).toHaveLength(0);
    const start = poseDrips(0.08);
    const mid = poseDrips(0.5);
    const end = poseDrips(0.92);
    expect(start.length).toBeGreaterThan(0);
    expect(mid.length).toBeGreaterThanOrEqual(start.length);
    expect(end.length).toBeGreaterThanOrEqual(2);
    expect(mid[0]!.length).toBeGreaterThan(start[0]!.length);
    expect(poolRadius(0.92)).toBeGreaterThan(poolRadius(0.5));
    expect(poolRadius(0.5)).toBeGreaterThan(poolRadius(0.04));
  });

  it("derives the same geometry from the same progress (stall-proof)", () => {
    const a = buildCandlePose(0.5, "focus", 0);
    const b = buildCandlePose(0.5, "focus", 0);
    expect(a.waxTop).toBe(b.waxTop);
    expect(a.waxHeight).toBe(b.waxHeight);
    expect(a.poolRx).toBe(b.poolRx);
    expect(a.drips.map((drip) => drip.length)).toEqual(b.drips.map((drip) => drip.length));
    expect(resolveClockMs(12, true)).toBe(STILL_CLOCK_MS);
    expect(resolveClockMs(STILL_CLOCK_MS, false)).toBe(STILL_CLOCK_MS);
  });

  it("does not rebuild wax height from killCount — only the flame sputters", () => {
    const healthy = buildCandlePose(0.5, "focus", 0);
    const stakes = buildCandlePose(0.5, "focus", 3);
    expect(stakes.waxTop).toBe(healthy.waxTop);
    expect(stakes.waxHeight).toBe(healthy.waxHeight);
    expect(stakes.poolRx).toBe(healthy.poolRx);
    expect(stakes.flame.scale).toBeLessThan(healthy.flame.scale);
    expect(stakes.flame.sputter).toBeGreaterThan(0);
    expect(flameSputter(0)).toBe(0);
    expect(flameScale("focus", 3)).toBeLessThan(flameScale("focus", 0));
  });

  it("keeps drip sites attached to the current rim", () => {
    const mid = poseDrips(0.5);
    const main = mid.find((drip) => drip.id === "left-main");
    expect(main).toBeDefined();
    expect(main!.y0).toBeGreaterThan(waxTopY(0.5));
    expect(main!.y0 + main!.length).toBeLessThan(CANDLE_GEOM.holderY + 8);
    expect(dripLength(0.5, DRIP_SITES[0]!)).toBeGreaterThan(20);
  });
});

describe("candle flame phases", () => {
  it("is brighter while focused and quieter while idle", () => {
    const live: FacePhase[] = ["focus", "break", "idle"];
    expect(flameScale("focus", 0)).toBeGreaterThan(flameScale("idle", 0));
    expect(flameScale("focus", 0)).toBeGreaterThan(flameScale("break", 0));
    for (const phase of live) {
      expect(flameScale(phase, 0)).toBeGreaterThan(0.4);
    }
  });
});

describe("candle view fit", () => {
  it("scales the pillar to a 1280×800 still and a short host", () => {
    const solo = fitCandleView(1280, 800);
    const host = fitCandleView(960, 300);
    expect(solo.scale).toBeGreaterThan(1);
    expect(host.scale).toBeGreaterThan(0.4);
    expect(host.scale).toBeLessThan(solo.scale);
  });
});
