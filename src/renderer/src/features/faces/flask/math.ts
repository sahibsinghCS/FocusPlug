import { clamp01 } from "../clock";
import type { FacePhase } from "@shared/faces";

export const FLASK_DESIGN = {
  width: 400,
  height: 640,
} as const;

export const STILL_CLOCK_MS = 680;

/** Upright glass bottle. Neck is much narrower than the belly — never a capsule. */
export const FLASK_GEOM = {
  cx: 200,
  lipY: 86,
  lipRx: 20,
  neckY: 156,
  neckRx: 13,
  shoulderY: 218,
  shoulderRx: 50,
  bellyY: 352,
  bellyRx: 66,
  hipY: 498,
  hipRx: 54,
  baseY: 556,
  baseRx: 58,
  innerInset: 7,
  corkTop: 48,
  corkBot: 90,
  corkRx: 15,
  spigotY: 476,
  spigotLength: 34,
  shelfY: 598,
} as const;

export type FlaskGeom = typeof FLASK_GEOM;

export interface Point {
  x: number;
  y: number;
}

export interface FlaskProfileKey {
  y: number;
  rx: number;
}

export function remainingFill(progress: number): number {
  return 1 - clamp01(progress);
}

export function leakActive(phase: FacePhase, fill: number): boolean {
  if (typeof phase !== "string") {
    throw new Error("phase must be a FacePhase string");
  }
  if (phase === "idle") {
    return false;
  }
  return fill > 0.035;
}

export function profileKeys(geom: FlaskGeom = FLASK_GEOM): FlaskProfileKey[] {
  return [
    { y: geom.lipY, rx: geom.lipRx },
    { y: geom.neckY, rx: geom.neckRx },
    { y: geom.shoulderY, rx: geom.shoulderRx },
    { y: geom.bellyY, rx: geom.bellyRx },
    { y: geom.hipY, rx: geom.hipRx },
    { y: geom.baseY, rx: geom.baseRx },
  ];
}

export function radiusAtY(y: number, geom: FlaskGeom = FLASK_GEOM, inset = 0): number {
  if (!Number.isFinite(y)) {
    throw new Error("y must be a finite number");
  }
  const keys = profileKeys(geom);
  const first = keys[0];
  const last = keys[keys.length - 1];
  if (!first || !last) {
    throw new Error("flask profile is empty");
  }
  if (y <= first.y) {
    return Math.max(3, first.rx - inset);
  }
  if (y >= last.y) {
    return Math.max(3, last.rx - inset);
  }
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i];
    const b = keys[i + 1];
    if (!a || !b) {
      continue;
    }
    if (y >= a.y && y <= b.y) {
      const t = (y - a.y) / Math.max(1e-6, b.y - a.y);
      const rx = a.rx + (b.rx - a.rx) * t;
      return Math.max(3, rx - inset);
    }
  }
  return Math.max(3, last.rx - inset);
}

export function waterLineY(fill: number, geom: FlaskGeom = FLASK_GEOM): number {
  const amount = clamp01(fill);
  const inset = geom.innerInset;
  const top = geom.neckY + 10;
  const bot = geom.baseY - inset - 6;
  const usable = 0.055 + amount * 0.9;
  return bot - usable * (bot - top);
}

export function waterCoversSpigot(fill: number, geom: FlaskGeom = FLASK_GEOM): boolean {
  return waterLineY(fill, geom) <= geom.spigotY - 4;
}

export function corkSeated(phase: FacePhase, leaking: boolean): boolean {
  return phase === "idle" || !leaking;
}

export function dripPhases(clockMs: number, count: number, periodMs: number): number[] {
  if (!Number.isFinite(clockMs) || !Number.isFinite(count) || !Number.isFinite(periodMs)) {
    throw new Error("dripPhases requires finite clock, count, and period");
  }
  const n = Math.max(1, Math.floor(count));
  const period = Math.max(1, periodMs);
  const t = ((clockMs % period) + period) % period / period;
  const phases: number[] = [];
  for (let i = 0; i < n; i += 1) {
    phases.push((t + i / n) % 1);
  }
  return phases;
}

export function bezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const u = 1 - clamp01(t);
  const tt = clamp01(t);
  const u2 = u * u;
  const t2 = tt * tt;
  return {
    x: u2 * u * p0.x + 3 * u2 * tt * p1.x + 3 * u * t2 * p2.x + t2 * tt * p3.x,
    y: u2 * u * p0.y + 3 * u2 * tt * p1.y + 3 * u * t2 * p2.y + t2 * tt * p3.y,
  };
}

export function streamControls(geom: FlaskGeom = FLASK_GEOM): {
  start: Point;
  c1: Point;
  c2: Point;
  end: Point;
} {
  const attachR = radiusAtY(geom.spigotY, geom, 0);
  const start = {
    x: geom.cx + attachR + geom.spigotLength - 2,
    y: geom.spigotY + 7,
  };
  return {
    start,
    c1: { x: start.x + 10, y: start.y + 28 },
    c2: { x: start.x + 16, y: start.y + 70 },
    end: { x: start.x + 8, y: geom.shelfY - 6 },
  };
}

export function mouthDripStart(geom: FlaskGeom = FLASK_GEOM): Point {
  return { x: geom.cx + geom.lipRx + 2, y: geom.lipY + 4 };
}

export function fitFlaskView(
  width: number,
  height: number,
): { scale: number; ox: number; oy: number } {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("width and height must be positive finite numbers");
  }
  const pad = Math.min(width, height) * 0.03;
  const scale = Math.min(
    (width - pad * 2) / FLASK_DESIGN.width,
    (height - pad * 2) / FLASK_DESIGN.height,
  );
  return {
    scale,
    ox: (width - FLASK_DESIGN.width * scale) / 2,
    oy: (height - FLASK_DESIGN.height * scale) / 2,
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
