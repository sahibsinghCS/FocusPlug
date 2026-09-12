import type { FaceEvent, FaceEventKind, FaceEventSeverity } from "../types";
import { hashString, lerp, mulberry32 } from "../canvas";
import { isBurstKind, severityWeight } from "../events";

export interface TraceSample {
  theta: number;
  radius: number;
  x: number;
  y: number;
}

export interface Harmonic {
  amp: number;
  freq: number;
  phase: number;
}

export function sessionHarmonics(sessionId: string): Harmonic[] {
  const rng = mulberry32(hashString(`rec:${sessionId}`));
  const harms: Harmonic[] = [];
  for (let i = 0; i < 5; i += 1) {
    harms.push({
      amp: 0.28 + rng() * 0.5,
      freq: 1.7 + rng() * 9.5,
      phase: rng() * Math.PI * 2,
    });
  }
  return harms;
}

/** Low procedural baseline. Same sessionId → same waveform. */
export function baselineNoise(theta: number, harmonics: readonly Harmonic[]): number {
  let sum = 0;
  for (const harm of harmonics) {
    sum += harm.amp * Math.sin(harm.freq * theta + harm.phase);
  }
  return sum * 0.012;
}

function burstFreq(kind: FaceEventKind): number {
  if (kind === "kill") {
    return 26;
  }
  if (kind === "countdown") {
    return 17;
  }
  return 12;
}

function burstWidth(kind: FaceEventKind): number {
  if (kind === "kill") {
    return 0.16;
  }
  if (kind === "countdown") {
    return 0.22;
  }
  return 0.28;
}

export function dampedBurst(
  delta: number,
  kind: FaceEventKind,
  severity: FaceEventSeverity,
): number {
  const width = burstWidth(kind);
  const envelope = Math.exp(-((delta / width) ** 2));
  const sine = Math.sin(burstFreq(kind) * delta);
  return severityWeight(severity) * 0.09 * envelope * sine;
}

export function eventDisplacement(theta: number, events: readonly FaceEvent[], revs: number): number {
  let sum = 0;
  for (const event of events) {
    if (!isBurstKind(event.kind)) {
      continue;
    }
    const center = event.at * Math.PI * 2 * revs;
    sum += dampedBurst(theta - center, event.kind, event.severity);
  }
  return sum;
}

/**
 * Polar radius. Angle = progress around the drum (1 rev ≈ session).
 * Radius walks out so later revolutions do not overwrite.
 */
export function radiusAt(input: {
  theta: number;
  r0: number;
  r1: number;
  harmonics: readonly Harmonic[];
  events: readonly FaceEvent[];
  revs: number;
}): number {
  const { theta, r0, r1, harmonics, events, revs } = input;
  const span = r1 - r0;
  const spiral = r0 + span * (theta / (Math.PI * 2 * Math.max(revs, 1)));
  const noise = baselineNoise(theta, harmonics) * span;
  const burst = eventDisplacement(theta, events, revs) * span;
  return spiral + noise + burst;
}

export function polarPoint(
  cx: number,
  cy: number,
  radius: number,
  theta: number,
): { x: number; y: number } {
  return {
    x: cx + radius * Math.sin(theta),
    y: cy - radius * Math.cos(theta),
  };
}

export function sampleTrace(input: {
  fromTheta: number;
  toTheta: number;
  cx: number;
  cy: number;
  r0: number;
  r1: number;
  harmonics: readonly Harmonic[];
  events: readonly FaceEvent[];
  revs: number;
  step?: number;
}): TraceSample[] {
  const step = input.step ?? 0.012;
  const samples: TraceSample[] = [];
  if (input.toTheta <= input.fromTheta) {
    return samples;
  }
  const start = input.fromTheta;
  const end = input.toTheta;
  for (let theta = start; theta <= end + 1e-9; theta += step) {
    const t = Math.min(theta, end);
    const radius = radiusAt({
      theta: t,
      r0: input.r0,
      r1: input.r1,
      harmonics: input.harmonics,
      events: input.events,
      revs: input.revs,
    });
    const pt = polarPoint(input.cx, input.cy, radius, t);
    samples.push({ theta: t, radius, x: pt.x, y: pt.y });
  }
  return samples;
}

export function revolutionCount(progress: number): number {
  return Math.max(1, Math.ceil(Math.max(progress, 0.0001)));
}

export function progressTheta(progress: number): number {
  return Math.max(0, progress) * Math.PI * 2;
}

export function lerpRadius(a: number, b: number, t: number): number {
  return lerp(a, b, t);
}
