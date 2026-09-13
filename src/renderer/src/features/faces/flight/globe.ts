import { landCoverage } from "./continents";
import {
  chartLandFade,
  chartRangeKm,
  clamp,
  dayAmount,
  dot,
  smoothstep,
  twilightBand,
  unitToLatLon,
  type Vec3,
} from "./math";
import type { FlightModel } from "./model";

function lightingWrap(intensity: number): number {
  return smoothstep(-0.28, 0.38, intensity);
}

function duskAmount(intensity: number): number {
  const rise = smoothstep(-0.2, -0.02, intensity);
  const fall = 1 - smoothstep(0.02, 0.22, intensity);
  return clamp(rise * fall, 0, 1);
}

interface DiskSample {
  x: number;
  y: number;
  vx: number;
  vy: number;
  vz: number;
}

const sampleCache = new Map<number, DiskSample[]>();

function diskSamples(size: number): DiskSample[] {
  const hit = sampleCache.get(size);
  if (hit) return hit;
  const samples: DiskSample[] = [];
  const r = (size - 1) / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const vx = (x - r) / r;
      const vy = (r - y) / r;
      const rr = vx * vx + vy * vy;
      if (rr > 1) continue;
      const vz = Math.sqrt(Math.max(0, 1 - rr));
      samples.push({ x, y, vx, vy, vz });
    }
  }
  sampleCache.set(size, samples);
  return samples;
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function terrainGrain(lat: number, lon: number): number {
  return 0.5 + 0.5 * Math.sin(lat * 7.13 + lon * 5.17) * Math.cos(lat * 3.71 - lon * 4.03);
}

function shadePixel(
  world: Vec3,
  viewZ: number,
  sun: Vec3,
  look: Vec3,
  rangeKm: number,
  landMode: "grid" | "coast",
): [number, number, number, number] {
  const geo = unitToLatLon(world);
  const land = landCoverage(geo.lat, geo.lon, landMode) * chartLandFade(world, look, rangeKm);
  const intensity = dot(world, sun);
  const day = dayAmount(intensity);
  const wrap = lightingWrap(intensity);
  const twilight = twilightBand(intensity);
  const dusk = duskAmount(intensity);

  const grain = terrainGrain(geo.lat, geo.lon);
  const oceanDay = [196, 178, 132] as const;
  const landDay = [64 + grain * 28, 88 + grain * 24, 42 + grain * 10] as const;
  const oceanNight = [4, 7, 16] as const;
  const landNight = [18 + grain * 10, 30 + grain * 12, 52 + grain * 8] as const;
  const twilightCyan = [92, 226, 236] as const;
  const atm = [110, 196, 220] as const;

  const coast = land > 0.08 && land < 0.92 ? 1 : 0;
  const hill = land > 0.2 ? 0.84 + grain * 0.28 : 1;
  const dayR = (mix(oceanDay[0], landDay[0], land) - coast * 32) * hill;
  const dayG = (mix(oceanDay[1], landDay[1], land) - coast * 20) * hill;
  const dayB = (mix(oceanDay[2], landDay[2], land) - coast * 12) * hill;
  const nightR = mix(oceanNight[0], landNight[0], land);
  const nightG = mix(oceanNight[1], landNight[1], land);
  const nightB = mix(oceanNight[2], landNight[2], land);

  let r = mix(nightR, dayR, wrap);
  let g = mix(nightG, dayG, wrap);
  let b = mix(nightB, dayB, wrap);

  const duskR = 196;
  const duskG = 118;
  const duskB = 72;
  r = mix(r, duskR, dusk * 0.5);
  g = mix(g, duskG, dusk * 0.5);
  b = mix(b, duskB, dusk * 0.5);

  const tw = twilight * 0.58;
  r = mix(r, twilightCyan[0], tw);
  g = mix(g, twilightCyan[1], tw);
  b = mix(b, twilightCyan[2], tw);

  const warm = Math.max(0, intensity) * (1 - land * 0.85) * 0.2;
  r += 42 * warm;
  g += 20 * warm;
  b += 2 * warm;

  const halfX = sun[0] + world[0];
  const halfY = sun[1] + world[1];
  const halfZ = sun[2] + world[2];
  const halfLen = Math.hypot(halfX, halfY, halfZ) || 1;
  const spec = Math.max(0, (world[0] * halfX + world[1] * halfY + world[2] * halfZ) / halfLen);
  const glint = (1 - land) * day * spec ** 64 * 90;
  r += glint;
  g += glint * 0.9;
  b += glint * 0.65;

  const limb = (1 - viewZ) ** 2.8;
  const haze = limb * (0.18 + 0.82 * Math.max(day, twilight)) * 0.58;
  r = mix(r, atm[0], haze);
  g = mix(g, atm[1], haze);
  b = mix(b, atm[2], haze);

  const darken = 0.62 + 0.38 * viewZ;
  r *= darken;
  g *= darken;
  b *= darken;

  return [
    Math.max(0, Math.min(255, r)),
    Math.max(0, Math.min(255, g)),
    Math.max(0, Math.min(255, b)),
    255,
  ];
}

export function rasterGlobe(model: FlightModel, size: number): ImageData {
  if (size < 32 || size > 768) {
    throw new Error("rasterGlobe size must be between 32 and 768");
  }
  const samples = diskSamples(size);
  const data = new Uint8ClampedArray(size * size * 4);
  const right = model.cameraRight;
  const up = model.cameraUp;
  const fwd = model.cameraForward;
  const sun = model.sun;
  const zoom = Math.max(1, model.cameraZoom);
  const landMode: "grid" | "coast" = "coast";
  const rangeKm = chartRangeKm(model.totalKm);

  for (const s of samples) {
    const vx = s.vx / zoom;
    const vy = s.vy / zoom;
    const rr = vx * vx + vy * vy;
    const i = (s.y * size + s.x) * 4;
    if (rr > 1) {
      data[i] = 6;
      data[i + 1] = 8;
      data[i + 2] = 14;
      data[i + 3] = 255;
      continue;
    }
    const vz = Math.sqrt(Math.max(0, 1 - rr));
    const wx = vx * right[0] + vy * up[0] + vz * fwd[0];
    const wy = vx * right[1] + vy * up[1] + vz * fwd[1];
    const wz = vx * right[2] + vy * up[2] + vz * fwd[2];
    const [r, g, b, a] = shadePixel([wx, wy, wz], vz, sun, fwd, rangeKm, landMode);
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
    data[i + 3] = a;
  }
  return new ImageData(data, size, size);
}

/** Pulled-back Earth so a picker tile reads as a globe, not a zoomed land patch. */
export function stickerLookModel(model: FlightModel): FlightModel {
  return {
    ...model,
    cameraZoom: 1,
    totalKm: Math.max(model.totalKm, 20_000),
  };
}

export function rasterStickerGlobe(size: number, model: FlightModel): ImageData {
  return rasterGlobe(stickerLookModel(model), size);
}
