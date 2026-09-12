import type { FacePhase } from "@shared/faces";
import { clamp01 } from "../clock";

export const CANDLE_DESIGN = {
  width: 400,
  height: 640,
} as const;

export const STILL_CLOCK_MS = 840;

/** Pillar in a dark room. Top melts down; drips and pool grow with progress. */
export const CANDLE_GEOM = {
  cx: 200,
  holderY: 550,
  dishRx: 118,
  dishRy: 18,
  shelfY: 598,
  fullTop: 100,
  stubTop: 430,
  baseHalfW: 70,
  midHalfW: 56,
  topHalfW: 40,
  collarExtra: 16,
  wickH: 20,
  flameH: 118,
  flameW: 38,
} as const;

export interface CandleDripSite {
  id: string;
  side: -1 | 1;
  /** Offset below the rim, as a fraction of remaining wax height. */
  attachT: number;
  /** Max run, as a fraction of remaining wax height. */
  lengthT: number;
  width: number;
  appear: number;
}

export const DRIP_SITES: readonly CandleDripSite[] = [
  { id: "left-main", side: -1, attachT: 0.02, lengthT: 0.86, width: 20, appear: 0.03 },
  { id: "right-main", side: 1, attachT: 0.06, lengthT: 0.78, width: 18, appear: 0.08 },
  { id: "left-late", side: -1, attachT: 0.14, lengthT: 0.52, width: 13, appear: 0.22 },
];

export interface CandleDripPose {
  id: string;
  side: -1 | 1;
  x: number;
  y0: number;
  length: number;
  width: number;
}

export interface CandleFlamePose {
  scale: number;
  bright: number;
  sputter: number;
  wickH: number;
}

export interface CandlePose {
  progress: number;
  melt: number;
  remain: number;
  waxTop: number;
  waxHeight: number;
  baseHalfW: number;
  midHalfW: number;
  topHalfW: number;
  collar: number;
  meniscusDepth: number;
  poolRx: number;
  poolRy: number;
  drips: readonly CandleDripPose[];
  flame: CandleFlamePose;
}

export function meltAmount(progress: number): number {
  return clamp01(progress);
}

export function waxRemain(progress: number): number {
  return 1 - meltAmount(progress);
}

/** Remaining wax height. Elapsed ↑ → this ↓. Independent of rAF. */
export function waxTopY(progress: number): number {
  const melt = meltAmount(progress);
  return CANDLE_GEOM.fullTop + (CANDLE_GEOM.stubTop - CANDLE_GEOM.fullTop) * melt;
}

export function waxColumnHeight(progress: number): number {
  return CANDLE_GEOM.holderY - waxTopY(progress);
}

export function halfWidthAt(y: number, progress: number): number {
  if (!Number.isFinite(y)) {
    throw new Error("y must be a finite number");
  }
  const top = waxTopY(progress);
  const bot = CANDLE_GEOM.holderY;
  const t = clamp01((y - top) / Math.max(1, bot - top));
  const { topHalfW, midHalfW, baseHalfW } = CANDLE_GEOM;
  if (t < 0.52) {
    return topHalfW + (midHalfW - topHalfW) * (t / 0.52);
  }
  return midHalfW + (baseHalfW - midHalfW) * ((t - 0.52) / 0.48);
}

export function poolRadius(progress: number): number {
  const melt = meltAmount(progress);
  return 34 + melt * 86;
}

export function poolHeight(progress: number): number {
  return 6 + meltAmount(progress) * 20;
}

export function dripLength(progress: number, site: CandleDripSite): number {
  const melt = meltAmount(progress);
  if (melt < site.appear) {
    return 0;
  }
  const grown = clamp01((melt - site.appear) / Math.max(0.08, 1 - site.appear));
  const remainH = waxColumnHeight(progress);
  return remainH * site.lengthT * (0.18 + 0.82 * grown);
}

export function resolveKillCount(killCount: number): number {
  if (!Number.isFinite(killCount)) {
    return 0;
  }
  return Math.max(0, Math.floor(killCount));
}

export function flameScale(phase: FacePhase, killCount: number): number {
  if (typeof phase !== "string") {
    throw new Error("phase must be a FacePhase string");
  }
  const stake = 1 / (1 + 0.17 * Math.min(resolveKillCount(killCount), 5));
  if (phase === "idle") {
    return 0.76 * stake;
  }
  if (phase === "break") {
    return 0.9 * stake;
  }
  return stake;
}

export function flameBrightness(phase: FacePhase, killCount: number): number {
  const scale = flameScale(phase, killCount);
  if (phase === "focus") {
    return Math.min(1, 0.72 + 0.28 * scale);
  }
  if (phase === "break") {
    return 0.58 * scale + 0.12;
  }
  return 0.48 * scale + 0.1;
}

export function flameSputter(killCount: number): number {
  return Math.min(1, resolveKillCount(killCount) * 0.24);
}

export function poseDrips(progress: number): CandleDripPose[] {
  const top = waxTopY(progress);
  const height = waxColumnHeight(progress);
  const posed: CandleDripPose[] = [];
  for (const site of DRIP_SITES) {
    const length = dripLength(progress, site);
    if (length <= 1.2) {
      continue;
    }
    const y0 = top + site.attachT * height + 5;
    const wall = halfWidthAt(y0, progress);
    posed.push({
      id: site.id,
      side: site.side,
      x: CANDLE_GEOM.cx + site.side * (wall + 2.5),
      y0,
      length,
      width: site.width,
    });
  }
  return posed;
}

export function buildCandlePose(
  progress: number,
  phase: FacePhase,
  killCount: number,
): CandlePose {
  if (typeof phase !== "string") {
    throw new Error("phase must be a FacePhase string");
  }
  const melt = meltAmount(progress);
  const remain = 1 - melt;
  const waxTop = waxTopY(progress);
  const waxHeight = waxColumnHeight(progress);
  const kills = resolveKillCount(killCount);
  return {
    progress: melt,
    melt,
    remain,
    waxTop,
    waxHeight,
    baseHalfW: CANDLE_GEOM.baseHalfW,
    midHalfW: CANDLE_GEOM.midHalfW,
    topHalfW: CANDLE_GEOM.topHalfW,
    collar: CANDLE_GEOM.collarExtra + melt * 6,
    meniscusDepth: 20 + melt * 16,
    poolRx: poolRadius(progress),
    poolRy: poolHeight(progress),
    drips: poseDrips(progress),
    flame: {
      scale: flameScale(phase, kills),
      bright: flameBrightness(phase, kills),
      sputter: flameSputter(kills),
      wickH: CANDLE_GEOM.wickH,
    },
  };
}

export function fitCandleView(
  width: number,
  height: number,
): { scale: number; ox: number; oy: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("width and height must be positive finite numbers");
  }
  const pad = Math.min(width, height) * 0.028;
  const scale = Math.min(
    (width - pad * 2) / CANDLE_DESIGN.width,
    (height - pad * 2) / CANDLE_DESIGN.height,
  );
  return {
    scale,
    ox: (width - CANDLE_DESIGN.width * scale) / 2,
    oy: (height - CANDLE_DESIGN.height * scale) / 2,
  };
}

export function resolveClockMs(clockMs: number, freeze: boolean): number {
  if (freeze) {
    return STILL_CLOCK_MS;
  }
  if (!Number.isFinite(clockMs)) {
    return STILL_CLOCK_MS;
  }
  return Math.max(0, clockMs);
}

export function flameSway(clockMs: number, sputter: number): { x: number; lean: number } {
  const t = resolveClockMs(clockMs, false);
  const jitter = 1 + clamp01(sputter) * 1.8;
  return {
    x: Math.sin(t / 150) * 2.4 * jitter + Math.sin(t / 83) * 1.1 * jitter,
    lean: Math.sin(t / 210) * 0.07 * jitter,
  };
}
