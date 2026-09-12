import type { FacePhase } from "@shared/faces";
import { clamp, lerp } from "../canvas";
import { clamp01 } from "../clock";

/** Absolute |y| from the neck → inner glass radius. Bulbous, not triangular. */
const RADIUS_KEYS: readonly { readonly y: number; readonly r: number }[] = [
  { y: 0, r: 0.042 },
  { y: 0.04, r: 0.05 },
  { y: 0.08, r: 0.068 },
  { y: 0.12, r: 0.096 },
  { y: 0.18, r: 0.148 },
  { y: 0.26, r: 0.228 },
  { y: 0.36, r: 0.318 },
  { y: 0.48, r: 0.392 },
  { y: 0.6, r: 0.418 },
  { y: 0.72, r: 0.406 },
  { y: 0.86, r: 0.372 },
  { y: 1, r: 0.348 },
];

export const GLASS_CAP = 1;
export const NECK_HALF = 0.018;
const REPOSE = 0.66;
const VOLUME_SAMPLES = 96;

export interface HourglassLayout {
  cx: number;
  cy: number;
  scale: number;
  width: number;
  height: number;
}

export interface BottomSand {
  kind: "empty" | "cone" | "bowl";
  peakY: number;
  shoulderY: number;
  baseR: number;
}

export interface HourglassTransfer {
  progress: number;
  topFill: number;
  bottomFill: number;
  flowing: boolean;
  topSurfaceY: number;
  funnel: number;
  bottom: BottomSand;
  streamHalfWidth: number;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function cosineInterp(a: number, b: number, t: number): number {
  const s = (1 - Math.cos(clamp(t, 0, 1) * Math.PI)) * 0.5;
  return lerp(a, b, s);
}

/** Inner wall radius at unit y (neck at 0, caps at ±1). Symmetric. */
export function innerRadius(y: number): number {
  const ay = Math.min(1, Math.abs(y));
  const last = RADIUS_KEYS[RADIUS_KEYS.length - 1];
  if (!last) {
    return 0.042;
  }
  if (ay <= 0) {
    return RADIUS_KEYS[0]?.r ?? 0.042;
  }
  for (let i = 1; i < RADIUS_KEYS.length; i += 1) {
    const prev = RADIUS_KEYS[i - 1];
    const next = RADIUS_KEYS[i];
    if (!prev || !next) {
      continue;
    }
    if (ay <= next.y) {
      const span = next.y - prev.y;
      const t = span <= 1e-9 ? 1 : (ay - prev.y) / span;
      return cosineInterp(prev.r, next.r, t);
    }
  }
  return last.r;
}

/** Outer glass wall — slightly thicker at the throat. */
export function outerRadius(y: number): number {
  const inner = innerRadius(y);
  const throat = Math.exp(-Math.pow(Math.abs(y) / 0.14, 2));
  return inner + 0.016 + 0.01 * throat;
}

export function integrateVolume(y0: number, y1: number, samples = VOLUME_SAMPLES): number {
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  if (hi - lo < 1e-8) {
    return 0;
  }
  const n = Math.max(8, samples);
  const dy = (hi - lo) / n;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const y = lo + (i + 0.5) * dy;
    const r = innerRadius(y);
    sum += Math.PI * r * r * dy;
  }
  return sum;
}

export function topChamberVolume(): number {
  return integrateVolume(-GLASS_CAP, -NECK_HALF);
}

export function bottomChamberVolume(): number {
  return integrateVolume(NECK_HALF, GLASS_CAP);
}

/** Surface y in the top bulb such that remaining volume matches `want`. */
export function topSurfaceForVolume(want: number): number {
  const yCap = -GLASS_CAP;
  const yNeck = -NECK_HALF;
  const total = topChamberVolume();
  const target = clamp(want, 0, total);
  if (target <= 1e-8) {
    return yNeck;
  }
  if (target >= total - 1e-8) {
    return yCap;
  }
  let lo = yCap;
  let hi = yNeck;
  for (let i = 0; i < 26; i += 1) {
    const mid = (lo + hi) / 2;
    const vol = integrateVolume(mid, yNeck);
    if (vol > target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

export function bottomSandForVolume(want: number): BottomSand {
  const yFloor = GLASS_CAP;
  const yNeck = NECK_HALF;
  const total = bottomChamberVolume();
  const target = clamp(want, 0, total);
  if (target <= 1e-8) {
    return { kind: "empty", peakY: yFloor, shoulderY: yFloor, baseR: 0 };
  }

  const maxFreeR = innerRadius(yFloor) * 0.96;
  const maxFreeH = maxFreeR * REPOSE;
  const maxFreeV = (Math.PI * maxFreeR * maxFreeR * maxFreeH) / 3;

  if (target <= maxFreeV) {
    const h = Math.cbrt((target * 3 * REPOSE * REPOSE) / Math.PI);
    return {
      kind: "cone",
      peakY: yFloor - h,
      shoulderY: yFloor,
      baseR: h / REPOSE,
    };
  }

  let lo = yNeck + 0.02;
  let hi = yFloor;
  let peakY = yNeck + 0.05;
  let shoulderY = 0.35;
  let baseR = innerRadius(shoulderY);
  for (let i = 0; i < 26; i += 1) {
    const shoulder = (lo + hi) / 2;
    const r = innerRadius(shoulder);
    const capH = Math.min(r * REPOSE, Math.max(0.012, shoulder - yNeck - 0.01));
    const wallVol = integrateVolume(shoulder, yFloor);
    const capVol = (Math.PI * r * r * capH) / 3;
    peakY = shoulder - capH;
    shoulderY = shoulder;
    baseR = r;
    if (wallVol + capVol < target) {
      hi = shoulder;
    } else {
      lo = shoulder;
    }
  }
  return { kind: "bowl", peakY, shoulderY, baseR };
}

/**
 * Stall-proof transfer. Fill levels come only from `progress`.
 * Clock / frame count must not be passed in.
 */
export function transferFromProgress(progress: number, phase: FacePhase): HourglassTransfer {
  const p = clamp01(progress);
  const topFill = 1 - p;
  const bottomFill = p;
  const flowing = phase !== "idle" && p < 0.992;
  const topVol = topFill * topChamberVolume();
  const funnel =
    topFill <= 0.01 ? 0 : 0.018 + 0.1 * 4 * topFill * (1 - topFill);
  return {
    progress: p,
    topFill,
    bottomFill,
    flowing,
    topSurfaceY: topSurfaceForVolume(topVol),
    funnel,
    bottom: bottomSandForVolume(bottomFill * bottomChamberVolume()),
    streamHalfWidth: flowing ? lerp(0.012, 0.02, 4 * p * (1 - p)) : 0,
  };
}

export function layoutHourglass(width: number, height: number): HourglassLayout {
  const padY = Math.max(14, height * 0.07);
  const padX = Math.max(18, width * 0.06);
  const unitH = 2.42;
  const unitW = 1.22;
  const scale = Math.min((width - padX * 2) / unitW, (height - padY * 2) / unitH);
  return {
    cx: width * 0.5,
    cy: height * 0.52,
    scale: Math.max(40, scale),
    width,
    height,
  };
}

export function toPixel(
  layout: HourglassLayout,
  x: number,
  y: number,
): { x: number; y: number } {
  return {
    x: layout.cx + x * layout.scale,
    y: layout.cy + y * layout.scale,
  };
}

export function streamEndY(transfer: HourglassTransfer): number {
  if (transfer.bottom.kind === "empty") {
    return GLASS_CAP - 0.04;
  }
  return Math.min(GLASS_CAP - 0.03, transfer.bottom.peakY + 0.012);
}
