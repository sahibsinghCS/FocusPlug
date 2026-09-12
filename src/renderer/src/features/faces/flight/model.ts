import type { FaceProps } from "../types";
import { resolveRoute, type Airport } from "./airports";
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
  orthonormalBasis,
  remainingKm,
  rotateAround,
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
}

export function resolveNow(props: FaceProps): number {
  if (typeof props.now === "number" && Number.isFinite(props.now)) {
    return props.now;
  }
  return Date.now();
}

export function buildFlightModel(props: FaceProps, idleOverride?: number): FlightModel {
  if (!Number.isFinite(props.remaining)) {
    throw new Error("FaceProps.remaining must be a finite number of seconds");
  }
  if (!Number.isFinite(props.estimateMinutes)) {
    throw new Error("FaceProps.estimateMinutes must be a finite number");
  }

  const now = resolveNow(props);
  const remaining = Math.max(0, props.remaining);
  const estimateMinutes = Math.max(0, props.estimateMinutes);
  const progress = flightProgress(remaining, estimateMinutes);
  const complete = Boolean(props.complete) || remaining <= 0 || progress >= 1;
  const { dep, arr } = resolveRoute(props.settings);
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
  const basis = orthonormalBasis(lookRoot);
  const idle =
    idleOverride ??
    (props.reducedMotion || props.paused || complete ? 0 : (now / 1000) * 0.0036);
  const wander = rotateAround(basis.right, lookRoot, idle);
  const lift = complete ? 0.04 : 0.08;
  const nightBias = scale(sunVec, complete ? -0.08 : -0.32);
  const cameraForward = normalize(
    add(
      lookRoot,
      add(add(scale(wander, complete ? 0.05 : 0.14), scale(basis.up, lift)), nightBias),
    ),
  );
  const cam = orthonormalBasis(cameraForward);

  return {
    now,
    remaining,
    estimateMinutes,
    progress,
    complete,
    paused: Boolean(props.paused),
    reducedMotion: Boolean(props.reducedMotion),
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
  return {
    x: cx + lx * radius,
    y: cy - ly * radius,
    z: lz,
    visible: lz > -0.015,
  };
}
