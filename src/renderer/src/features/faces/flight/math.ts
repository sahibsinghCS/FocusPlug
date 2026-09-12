export const EARTH_RADIUS_KM = 6371;
export const MAX_BANK_DEG = 25;
export const CLIMB_END = 0.08;
export const DESCENT_START = 0.88;
export const CONTRAIL_WINDOW_SEC = 90;
export const TWILIGHT_LO = -0.045;
export const TWILIGHT_HI = 0.07;

export type Vec3 = readonly [number, number, number];

export function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("clamp requires a finite value");
  }
  return Math.min(hi, Math.max(lo, value));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge1 === edge0) {
    throw new Error("smoothstep edges must differ");
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

export function wrapLon(lon: number): number {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

export function latLonToUnit(lat: number, lon: number): Vec3 {
  const phi = degToRad(lat);
  const lam = degToRad(lon);
  const c = Math.cos(phi);
  return [c * Math.cos(lam), Math.sin(phi), c * Math.sin(lam)];
}

export function unitToLatLon(v: Vec3): { lat: number; lon: number } {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) {
    throw new Error("unitToLatLon received a zero vector");
  }
  const x = v[0] / len;
  const y = v[1] / len;
  const z = v[2] / len;
  return {
    lat: radToDeg(Math.asin(clamp(y, -1, 1))),
    lon: wrapLon(radToDeg(Math.atan2(z, x))),
  };
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function scale(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (len < 1e-9) {
    throw new Error("normalize received a zero vector");
  }
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function dayOfYearUtc(ms: number): number {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new Error("dayOfYearUtc requires a valid timestamp");
  }
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  return (date.getTime() - start) / 86_400_000;
}

export function utcHours(ms: number): number {
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) {
    throw new Error("utcHours requires a valid timestamp");
  }
  return (
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3_600_000
  );
}

/** Approximate solar declination in degrees. */
export function solarDeclinationDeg(ms: number): number {
  const day = dayOfYearUtc(ms);
  return 23.44 * Math.sin((2 * Math.PI * (day - 81)) / 365);
}

/**
 * Subsolar point from real UTC.
 * lat ≈ declination, lon ≈ (12 - utcHours) * 15
 */
export function subsolar(ms: number): { lat: number; lon: number } {
  if (!Number.isFinite(ms)) {
    throw new Error("subsolar requires a finite timestamp");
  }
  return {
    lat: solarDeclinationDeg(ms),
    lon: wrapLon((12 - utcHours(ms)) * 15),
  };
}

export function sunDir(ms: number): Vec3 {
  const s = subsolar(ms);
  return latLonToUnit(s.lat, s.lon);
}

/** Day weight 0..1 with a thin cyan twilight band around the terminator. */
export function dayAmount(intensity: number): number {
  return smoothstep(TWILIGHT_LO, TWILIGHT_HI, intensity);
}

export function twilightBand(intensity: number): number {
  const day = dayAmount(intensity);
  return 4 * day * (1 - day);
}

export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const p1 = degToRad(aLat);
  const p2 = degToRad(bLat);
  const dp = degToRad(bLat - aLat);
  const dl = degToRad(bLon - aLon);
  const h =
    Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(clamp(Math.sqrt(h), 0, 1));
}

export function slerpUnit(a: Vec3, b: Vec3, t: number): Vec3 {
  const d = clamp(dot(a, b), -1, 1);
  const omega = Math.acos(d);
  if (omega < 1e-6) {
    return normalize(add(a, scale(add(b, scale(a, -1)), t)));
  }
  const s = Math.sin(omega);
  return add(scale(a, Math.sin((1 - t) * omega) / s), scale(b, Math.sin(t * omega) / s));
}

export function greatCirclePoint(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  t: number,
): { lat: number; lon: number } {
  const a = latLonToUnit(aLat, aLon);
  const b = latLonToUnit(bLat, bLon);
  return unitToLatLon(slerpUnit(a, b, clamp(t, 0, 1)));
}

export function initialBearingDeg(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const φ1 = degToRad(aLat);
  const φ2 = degToRad(bLat);
  const Δλ = degToRad(bLon - aLon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (radToDeg(Math.atan2(y, x)) + 360) % 360;
}

export function unwrapDeg(prev: number, next: number): number {
  let d = next - prev;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

/**
 * Bank into the turn: roll ∝ bearing rate along the great circle, clamp ±25°.
 */
export function bankDeg(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
  progress: number,
): number {
  const t = clamp(progress, 0, 1);
  const dt = 0.012;
  const t0 = clamp(t - dt * 0.5, 0, 1);
  const t1 = clamp(t + dt * 0.5, 0, 1);
  const p0 = greatCirclePoint(aLat, aLon, bLat, bLon, t0);
  const p1 = greatCirclePoint(aLat, aLon, bLat, bLon, t1);
  const p2 = greatCirclePoint(aLat, aLon, bLat, bLon, clamp(t1 + dt, 0, 1));
  const b0 = initialBearingDeg(p0.lat, p0.lon, p1.lat, p1.lon);
  const b1 = initialBearingDeg(p1.lat, p1.lon, p2.lat, p2.lon);
  const rate = unwrapDeg(b0, b1) / Math.max(1e-4, t1 - t0 + dt);
  return clamp(rate * 0.5, -MAX_BANK_DEG, MAX_BANK_DEG);
}

export type FlightPhase = "climb" | "cruise" | "descent" | "complete";

export function flightProgress(remaining: number, estimateMinutes: number): number {
  if (!Number.isFinite(remaining) || !Number.isFinite(estimateMinutes)) {
    throw new Error("flightProgress requires finite remaining and estimateMinutes");
  }
  if (estimateMinutes <= 0) {
    return remaining <= 0 ? 1 : 0;
  }
  const total = estimateMinutes * 60;
  const elapsed = total - remaining;
  return clamp(elapsed / total, 0, 1);
}

export function flightPhase(progress: number, complete: boolean): FlightPhase {
  if (complete || progress >= 1) return "complete";
  if (progress < CLIMB_END) return "climb";
  if (progress >= DESCENT_START) return "descent";
  return "cruise";
}

export function phaseScale(phase: FlightPhase): number {
  if (phase === "climb") return 1.08;
  if (phase === "descent") return 0.93;
  if (phase === "complete") return 0.66;
  return 1;
}

export function contrailWidthScale(phase: FlightPhase): number {
  if (phase === "cruise") return 0.52;
  if (phase === "complete") return 0.28;
  if (phase === "descent") return 0.78;
  return 1;
}

export function remainingKm(totalKm: number, progress: number): number {
  return Math.max(0, totalKm * (1 - clamp(progress, 0, 1)));
}

export function groundSpeedKmh(remainKm: number, remainingSec: number): number {
  if (!Number.isFinite(remainKm) || !Number.isFinite(remainingSec)) {
    throw new Error("groundSpeedKmh requires finite inputs");
  }
  if (remainingSec <= 0.5) return 0;
  return remainKm / (remainingSec / 3600);
}

export function etaMs(now: number, remainingSec: number): number {
  if (!Number.isFinite(now) || !Number.isFinite(remainingSec)) {
    throw new Error("etaMs requires finite inputs");
  }
  return now + Math.max(0, remainingSec) * 1000;
}

export function formatClockHm(ms: number, timeZone = "UTC"): string {
  if (!Number.isFinite(ms)) {
    throw new Error("formatClockHm requires a finite timestamp");
  }
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(ms));
}

export function formatZulu(ms: number): string {
  return `${formatClockHm(ms, "UTC")}Z`;
}

export function formatKm(km: number): string {
  if (!Number.isFinite(km)) {
    throw new Error("formatKm requires a finite value");
  }
  const rounded = Math.round(Math.max(0, km));
  return `${rounded.toLocaleString("en-US")} km`;
}

export function formatGs(kmh: number): string {
  if (!Number.isFinite(kmh)) {
    throw new Error("formatGs requires a finite value");
  }
  return `${Math.round(Math.max(0, kmh)).toLocaleString("en-US")} km/h`;
}

export function orthonormalBasis(forward: Vec3): { right: Vec3; up: Vec3; forward: Vec3 } {
  const f = normalize(forward);
  const worldUp: Vec3 = Math.abs(f[1]) > 0.94 ? [1, 0, 0] : [0, 1, 0];
  const right = normalize(cross(worldUp, f));
  const up = normalize(cross(f, right));
  return { right, up, forward: f };
}

export function rotateAround(v: Vec3, axis: Vec3, rad: number): Vec3 {
  const k = normalize(axis);
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const d = dot(k, v);
  return add(add(scale(v, c), scale(cross(k, v), s)), scale(k, d * (1 - c)));
}
