import { clamp01 } from "../clock";

export type GardenSkyPhase = "night" | "twilight" | "dawn" | "day";

export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface SunDisk {
  x: number;
  y: number;
  r: number;
  elevation: number;
  aboveHorizon: boolean;
  glow: number;
}

export interface MoonDisk {
  x: number;
  y: number;
  r: number;
  alpha: number;
}

export interface TimeLight {
  ambient: RGB;
  warm: RGB;
  shadow: RGB;
  saturate: number;
  silhouette: number;
  bloom: number;
}

const PHASE_NIGHT = 0.18;
const PHASE_TWILIGHT = 0.42;
const PHASE_DAWN = 0.7;
const SUN_RISE = 0.1;

export function resolveGardenProgress(progress: unknown): number {
  if (typeof progress !== "number" || !Number.isFinite(progress)) {
    return 0;
  }
  return clamp01(progress);
}

/** Session progress is sun elevation: 0 = below the horizon, 1 = high day. */
export function sunElevation(progress: unknown): number {
  return resolveGardenProgress(progress);
}

export function horizonY(height: unknown): number {
  if (typeof height !== "number" || !Number.isFinite(height) || height <= 0) {
    return 160;
  }
  return height * 0.5;
}

export function gardenPhase(progress: unknown): GardenSkyPhase {
  const elevation = sunElevation(progress);
  if (elevation < PHASE_NIGHT) {
    return "night";
  }
  if (elevation < PHASE_TWILIGHT) {
    return "twilight";
  }
  if (elevation < PHASE_DAWN) {
    return "dawn";
  }
  return "day";
}

export function gardenPhaseLabel(phase: GardenSkyPhase): string {
  if (phase === "night") {
    return "NIGHT";
  }
  if (phase === "twilight") {
    return "TWILIGHT";
  }
  if (phase === "dawn") {
    return "DAWN";
  }
  return "DAY";
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const u = clamp01(t);
  return {
    r: lerp(a.r, b.r, u),
    g: lerp(a.g, b.g, u),
    b: lerp(a.b, b.b, u),
  };
}

export function cssRgb(color: RGB, alpha = 1): string {
  const r = Math.round(Math.min(255, Math.max(0, color.r)));
  const g = Math.round(Math.min(255, Math.max(0, color.g)));
  const b = Math.round(Math.min(255, Math.max(0, color.b)));
  const a = clamp01(alpha);
  if (a >= 0.999) {
    return `rgb(${r}, ${g}, ${b})`;
  }
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function sunDisk(progress: unknown, width: unknown, height: unknown): SunDisk {
  const elevation = sunElevation(progress);
  const w = typeof width === "number" && width > 0 ? width : 960;
  const h = typeof height === "number" && height > 0 ? height : 320;
  const horizon = horizonY(h);
  const travel = horizon * 0.64;
  const lift = (elevation - SUN_RISE) / (1 - SUN_RISE);
  const y = horizon - lift * travel;
  const x = lerp(w * 0.16, w * 0.56, elevation);
  const r = lerp(17, 28, elevation);
  return {
    x,
    y,
    r,
    elevation,
    aboveHorizon: y + r * 0.15 < horizon,
    glow: clamp01((elevation - 0.04) / 0.32),
  };
}

export function moonDisk(progress: unknown, width: unknown, height: unknown): MoonDisk {
  const elevation = sunElevation(progress);
  const w = typeof width === "number" && width > 0 ? width : 960;
  const h = typeof height === "number" && height > 0 ? height : 320;
  return {
    x: w * 0.78,
    y: h * 0.26,
    r: Math.max(10, Math.min(w, h) * 0.042),
    alpha: clamp01(1 - elevation / 0.52),
  };
}

export function starAlpha(progress: unknown): number {
  return clamp01(1 - sunElevation(progress) / 0.36);
}

export function fireflyAlpha(progress: unknown): number {
  const elevation = sunElevation(progress);
  if (elevation > 0.48) {
    return 0;
  }
  return clamp01(1 - elevation / 0.42) * 0.9;
}

export function birdAlpha(progress: unknown): number {
  return clamp01((sunElevation(progress) - 0.62) / 0.22);
}

export function bloomAmount(progress: unknown): number {
  return clamp01((sunElevation(progress) - 0.16) / 0.5);
}

export function timeLight(progress: unknown): TimeLight {
  const elevation = sunElevation(progress);
  const phase = gardenPhase(elevation);
  if (phase === "night") {
    return {
      ambient: { r: 28, g: 22, b: 58 },
      warm: { r: 70, g: 64, b: 110 },
      shadow: { r: 8, g: 8, b: 22 },
      saturate: 0.08,
      silhouette: 0.88,
      bloom: 0.12,
    };
  }
  if (phase === "twilight") {
    const t = (elevation - PHASE_NIGHT) / (PHASE_TWILIGHT - PHASE_NIGHT);
    return {
      ambient: mixRgb({ r: 48, g: 28, b: 62 }, { r: 92, g: 48, b: 58 }, t),
      warm: mixRgb({ r: 160, g: 70, b: 50 }, { r: 230, g: 120, b: 70 }, t),
      shadow: { r: 28, g: 16, b: 32 },
      saturate: lerp(0.22, 0.48, t),
      silhouette: lerp(0.7, 0.42, t),
      bloom: lerp(0.28, 0.7, t),
    };
  }
  if (phase === "dawn") {
    const t = (elevation - PHASE_TWILIGHT) / (PHASE_DAWN - PHASE_TWILIGHT);
    return {
      ambient: mixRgb({ r: 110, g: 72, b: 68 }, { r: 170, g: 150, b: 110 }, t),
      warm: mixRgb({ r: 240, g: 150, b: 80 }, { r: 255, g: 210, b: 130 }, t),
      shadow: { r: 40, g: 28, b: 30 },
      saturate: lerp(0.55, 0.82, t),
      silhouette: lerp(0.36, 0.12, t),
      bloom: lerp(0.75, 1, t),
    };
  }
  return {
    ambient: { r: 210, g: 230, b: 180 },
    warm: { r: 255, g: 236, b: 170 },
    shadow: { r: 36, g: 56, b: 28 },
    saturate: 1,
    silhouette: 0,
    bloom: 1,
  };
}

export function litColor(base: RGB, light: TimeLight): RGB {
  const muted = mixRgb(base, light.shadow, light.silhouette * 0.72);
  const warmed = mixRgb(muted, light.warm, light.saturate * 0.18);
  return mixRgb(warmed, light.ambient, 0.1 + light.silhouette * 0.12);
}

export function swayOffset(clockMs: number, seed: number, layer: number): number {
  const safeClock = Number.isFinite(clockMs) ? clockMs : 0;
  const safeSeed = Number.isFinite(seed) ? seed : 0;
  const safeLayer = Number.isFinite(layer) ? layer : 0;
  // Phase-offset sine so freeze-at-0 still reads as wind, not a comb.
  return Math.sin(safeClock * 0.0017 + safeSeed + safeLayer * 1.7 + 1.15);
}

export function grassSway(clockMs: number, xNorm: number, layer: number): number {
  const x = Number.isFinite(xNorm) ? xNorm : 0;
  return swayOffset(clockMs, x * 6.4, layer);
}
