import { resolveRoute, type Airport } from "./airports";
import type { FlightClock } from "./clock";
import {
  bankDeg,
  CONTRAIL_WINDOW_SEC,
  etaMs,
  flightPhase,
  flightProgress,
  greatCirclePoint,
  groundSpeedKmh,
  haversineKm,
  initialBearingDeg,
  latLonToUnit,
  normalize,
  orbitAngleRad,
  orthonormalBasis,
  remainingKm,
  rotateAround,
  routeCameraZoom,
  scale,
  add,
  subsolar,
  sunDir,
  type FlightPhase,
  type Vec3,
} from "./math";

export interface ContrailSample {
  lat: number;
  lon: number;
  ageSec: number;
}

export interface FlightModel {
  now: number;
  remaining: number;
  estimateMinutes: number;
  progress: number;
  complete: boolean;
  paused: boolean;
  reducedMotion: boolean;
  phase: FlightPhase;
  dep: Airport;
  arr: Airport;
  planeLat: number;
  planeLon: number;
  heading: number;
  bank: number;
  totalKm: number;
  remainKm: number;
  gsKmh: number;
  eta: number;
  sunLat: number;
  sunLon: number;
  sun: Vec3;
  contrail: ContrailSample[];
  cameraForward: Vec3;
  cameraRight: Vec3;
  cameraUp: Vec3;
  cameraZoom: number;
  orbit: number;
}

export function resolveNow(clock: FlightClock): number {
  if (!Number.isFinite(clock.now)) {
    throw new Error("FlightClock.now must be a finite timestamp");
  }
  return clock.now;
}

export function buildFlightModel(clock: FlightClock, idleOverride?: number): FlightModel {
  if (!Number.isFinite(clock.remaining)) {
    throw new Error("FlightClock.remaining must be a finite number of seconds");
  }
  if (!Number.isFinite(clock.estimateMinutes)) {
    throw new Error("FlightClock.estimateMinutes must be a finite number");
  }

  const now = resolveNow(clock);
  const remaining = Math.max(0, clock.remaining);
  const estimateMinutes = Math.max(0, clock.estimateMinutes);
  const progress = flightProgress(remaining, estimateMinutes);
  const complete = Boolean(clock.complete) || remaining <= 0 || progress >= 1;
  const { dep, arr } = resolveRoute(clock.settings);
  const plane = greatCirclePoint(dep.lat, dep.lon, arr.lat, arr.lon, progress);
  const ahead = greatCirclePoint(
    dep.lat,
    dep.lon,
    arr.lat,
    arr.lon,
    Math.min(1, progress + 0.012),
  );
  const heading = initialBearingDeg(plane.lat, plane.lon, ahead.lat, ahead.lon);
  const bank = complete ? 0 : bankDeg(dep.lat, dep.lon, arr.lat, arr.lon, progress);
  const totalKm = haversineKm(dep.lat, dep.lon, arr.lat, arr.lon);
  const remainKm = remainingKm(totalKm, progress);
  const sun = subsolar(now);
  const sunVec = sunDir(now);
  const planeUnit = latLonToUnit(plane.lat, plane.lon);
  const destUnit = latLonToUnit(arr.lat, arr.lon);
  const lookRoot = complete ? destUnit : planeUnit;
  const frozen = Boolean(clock.reducedMotion || clock.paused);
  const orbit = orbitAngleRad(now, idleOverride, frozen || complete);
  const zoom = routeCameraZoom(totalKm, complete);
  const base = orthonormalBasis(lookRoot);
  const spunRight = rotateAround(base.right, lookRoot, orbit);
  const spunUp = rotateAround(base.up, lookRoot, orbit);
  const lean = (complete ? 0.025 : 0.04) / zoom;
  const lift = (complete ? 0.02 : 0.035) / zoom;
  const cameraForward = normalize(add(add(lookRoot, scale(spunRight, lean)), scale(spunUp, lift)));
  const cam = orthonormalBasis(cameraForward);

  return {
    now,
    remaining,
    estimateMinutes,
    progress,
    complete,
    paused: Boolean(clock.paused),
    reducedMotion: Boolean(clock.reducedMotion),
    phase: flightPhase(progress, complete),
    dep,
    arr,
    planeLat: plane.lat,
    planeLon: plane.lon,
    heading,
    bank,
    totalKm,
    remainKm,
    gsKmh: groundSpeedKmh(remainKm, remaining),
    eta: etaMs(now, remaining),
    sunLat: sun.lat,
    sunLon: sun.lon,
    sun: sunVec,
    contrail: seedContrail(dep, arr, progress, remaining, estimateMinutes),
    cameraForward: cam.forward,
    cameraRight: cam.right,
    cameraUp: cam.up,
    cameraZoom: zoom,
    orbit,
  };
}

export function seedContrail(
  dep: Airport,
  arr: Airport,
  progress: number,
  remaining: number,
  estimateMinutes: number,
): ContrailSample[] {
  const totalSec = Math.max(1, estimateMinutes * 60);
  const rate = 1 / totalSec;
  const samples: ContrailSample[] = [];
  const step = 1.25;
  const window = Math.min(CONTRAIL_WINDOW_SEC, progress * totalSec);
  for (let age = 0; age <= window; age += step) {
    const t = progress - rate * age;
    if (t < 0) break;
    const p = greatCirclePoint(dep.lat, dep.lon, arr.lat, arr.lon, t);
    samples.push({ lat: p.lat, lon: p.lon, ageSec: age });
  }
  if (remaining <= 0 && samples.length === 0) {
    const p = greatCirclePoint(dep.lat, dep.lon, arr.lat, arr.lon, 1);
    samples.push({ lat: p.lat, lon: p.lon, ageSec: 0 });
  }
  return samples;
}

export function projectWorld(
  world: Vec3,
  model: FlightModel,
  cx: number,
  cy: number,
  radius: number,
): { x: number; y: number; z: number; visible: boolean } {
  const lx = world[0] * model.cameraRight[0] + world[1] * model.cameraRight[1] + world[2] * model.cameraRight[2];
  const ly = world[0] * model.cameraUp[0] + world[1] * model.cameraUp[1] + world[2] * model.cameraUp[2];
  const lz =
    world[0] * model.cameraForward[0] +
    world[1] * model.cameraForward[1] +
    world[2] * model.cameraForward[2];
  const zoom = model.cameraZoom;
  return {
    x: cx + lx * radius * zoom,
    y: cy - ly * radius * zoom,
    z: lz,
    visible: lz > 0.02 && lx * lx + ly * ly < (1 / zoom) * (1 / zoom) * 1.15,
  };
}
