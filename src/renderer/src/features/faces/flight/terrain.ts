import type { FlightMapView } from "./mapView";

export interface TerrainVertex {
  x: number;
  y: number;
  h: number;
}

export interface TerrainTriangle {
  a: TerrainVertex;
  b: TerrainVertex;
  c: TerrainVertex;
  color: string;
}

export interface TerrainMesh {
  triangles: TerrainTriangle[];
  river: Array<{ x: number; y: number }>;
  cols: number;
  rows: number;
}

export interface Bezier4 {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

/** Close-in river: right-hand valley like the reference plate. */
export const CLOSE_RIVER: Bezier4 = {
  x0: 0.74,
  y0: -0.08,
  x1: 0.86,
  y1: 0.2,
  x2: 0.58,
  y2: 0.4,
  x3: 0.7,
  y3: 0.56,
};

export const CLOSE_RIVER_TAIL: Bezier4 = {
  x0: 0.7,
  y0: 0.56,
  x1: 0.84,
  y1: 0.7,
  x2: 0.62,
  y2: 0.9,
  x3: 0.72,
  y3: 1.12,
};

/** Whole-route corridor stays below the remaining clock. */
export const ROUTE_PATH: Bezier4 = {
  x0: 0.1,
  y0: 0.7,
  x1: 0.34,
  y1: 0.62,
  x2: 0.64,
  y2: 0.62,
  x3: 0.9,
  y3: 0.68,
};

const CLOSE_COLS = 11;
const CLOSE_ROWS = 8;
const ROUTE_COLS = 13;
const ROUTE_ROWS = 9;
const STICKER_COLS = 7;
const STICKER_ROWS = 5;

export const FLIGHT_DRAW_TRIANGLES_MAX = 360;

function hash32(x: number, y: number, seed: number): number {
  let n = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

function valueNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = fade(x - x0);
  const fy = fade(y - y0);
  const a = hash32(x0, y0, seed);
  const b = hash32(x0 + 1, y0, seed);
  const c = hash32(x0, y0 + 1, seed);
  const d = hash32(x0 + 1, y0 + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

function fbm(x: number, y: number, seed: number): number {
  let sum = 0;
  let amp = 0.52;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < 4; i += 1) {
    sum += valueNoise(x * freq, y * freq, seed + i * 19) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.05;
  }
  return sum / norm;
}

export function bezierPoint(curve: Bezier4, t: number): { x: number; y: number } {
  const u = Math.min(1, Math.max(0, t));
  const mt = 1 - u;
  const mt2 = mt * mt;
  const u2 = u * u;
  return {
    x: mt2 * mt * curve.x0 + 3 * mt2 * u * curve.x1 + 3 * mt * u2 * curve.x2 + u2 * u * curve.x3,
    y: mt2 * mt * curve.y0 + 3 * mt2 * u * curve.y1 + 3 * mt * u2 * curve.y2 + u2 * u * curve.y3,
  };
}

export function bezierTangent(curve: Bezier4, t: number): { x: number; y: number } {
  const u = Math.min(1, Math.max(0, t));
  const mt = 1 - u;
  const x =
    3 * mt * mt * (curve.x1 - curve.x0) +
    6 * mt * u * (curve.x2 - curve.x1) +
    3 * u * u * (curve.x3 - curve.x2);
  const y =
    3 * mt * mt * (curve.y1 - curve.y0) +
    6 * mt * u * (curve.y2 - curve.y1) +
    3 * u * u * (curve.y3 - curve.y2);
  const len = Math.hypot(x, y) || 1;
  return { x: x / len, y: y / len };
}

export function sampleBezier(curve: Bezier4, steps: number): Array<{ x: number; y: number }> {
  if (!Number.isFinite(steps) || steps < 2) {
    throw new Error("sampleBezier requires at least 2 steps");
  }
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i <= steps; i += 1) {
    out.push(bezierPoint(curve, i / steps));
  }
  return out;
}

function shade(h: number, ny: number, seedNudge: number): string {
  const lit = h * 0.82 + (1 - ny) * 0.22 + seedNudge * 0.14;
  const t = Math.min(1, Math.max(0, lit));
  const r = Math.round(16 + t * 68 + (1 - ny) * 10);
  const g = Math.round(28 + t * 86 + (1 - ny) * 12);
  const b = Math.round(16 + t * 38);
  return `rgb(${r},${g},${b})`;
}

export function riverCurves(view: FlightMapView): Bezier4[] {
  return view === "route" ? [ROUTE_PATH] : [CLOSE_RIVER, CLOSE_RIVER_TAIL];
}

export function buildTerrainMesh(
  width: number,
  height: number,
  seed: number,
  view: FlightMapView,
  sticker = false,
): TerrainMesh {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("buildTerrainMesh requires a positive size");
  }
  if (!Number.isFinite(seed)) {
    throw new Error("buildTerrainMesh requires a finite seed");
  }
  const cols = sticker ? STICKER_COLS : view === "route" ? ROUTE_COLS : CLOSE_COLS;
  const rows = sticker ? STICKER_ROWS : view === "route" ? ROUTE_ROWS : CLOSE_ROWS;
  const verts: TerrainVertex[] = [];
  const scale = view === "route" ? 2.4 : 3.4;
  for (let row = 0; row <= rows; row += 1) {
    for (let col = 0; col <= cols; col += 1) {
      const nx = col / cols;
      const ny = row / rows;
      const jx = (hash32(col, row, seed) - 0.5) * (0.72 / cols);
      const jy = (hash32(col, row, seed + 7) - 0.5) * (0.72 / rows);
      const h = fbm((nx + jx) * scale, (ny + jy) * scale, seed);
      verts.push({
        x: (nx + jx) * width,
        y: (ny + jy) * height,
        h,
      });
    }
  }

  const triangles: TerrainTriangle[] = [];
  const stride = cols + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const i00 = row * stride + col;
      const i10 = i00 + 1;
      const i01 = i00 + stride;
      const i11 = i01 + 1;
      const a = verts[i00];
      const b = verts[i10];
      const c = verts[i01];
      const d = verts[i11];
      if (!a || !b || !c || !d) {
        throw new Error("terrain grid is missing a vertex");
      }
      const flip = hash32(col, row, seed + 3) > 0.5;
      const ny = (a.y / height + c.y / height) * 0.5;
      if (flip) {
        triangles.push({
          a,
          b,
          c,
          color: shade((a.h + b.h + c.h) / 3, ny, hash32(col, row, seed + 11)),
        });
        triangles.push({
          a: b,
          b: d,
          c,
          color: shade((b.h + d.h + c.h) / 3, ny, hash32(col, row, seed + 13)),
        });
      } else {
        triangles.push({
          a,
          b,
          c: d,
          color: shade((a.h + b.h + d.h) / 3, ny, hash32(col, row, seed + 11)),
        });
        triangles.push({
          a,
          b: d,
          c,
          color: shade((a.h + d.h + c.h) / 3, ny, hash32(col, row, seed + 13)),
        });
      }
    }
  }
  if (triangles.length > FLIGHT_DRAW_TRIANGLES_MAX) {
    throw new Error(`terrain mesh exceeded cheap-draw budget (${triangles.length})`);
  }

  const river: Array<{ x: number; y: number }> = [];
  for (const curve of riverCurves(view)) {
    for (const p of sampleBezier(curve, 18)) {
      river.push({ x: p.x * width, y: p.y * height });
    }
  }

  return { triangles, river, cols, rows };
}

export function routePoint(progress: number, width: number, height: number): {
  x: number;
  y: number;
  heading: number;
} {
  const t = Math.min(1, Math.max(0, progress));
  const p = bezierPoint(ROUTE_PATH, t);
  const tan = bezierTangent(ROUTE_PATH, t);
  return {
    x: p.x * width,
    y: p.y * height,
    heading: Math.atan2(tan.x, -tan.y),
  };
}

export function hashRouteSeed(dep: string, arr: string): number {
  const raw = `${dep.trim().toUpperCase()}-${arr.trim().toUpperCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < raw.length; i += 1) {
    hash ^= raw.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
