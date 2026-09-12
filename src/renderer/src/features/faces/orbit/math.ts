import { clampProgress } from "../clamp";

/** Fibonacci turn counts — integer revolutions over a full session. */
export const ORBIT_TURNS = [1, 2, 3, 5, 8] as const;

/** 12 o'clock in SVG math space (y down): x = cos θ, y = sin θ. */
export const ALIGN_ANGLE = -Math.PI / 2;

export interface OrbitBody {
  index: number;
  turns: number;
  startAngle: number;
  hue: string;
  glow: string;
}

/**
 * With integer turns, angle(1) ≡ start (mod 2π). The unique solution
 * that stacks every body at ALIGN_ANGLE when progress = 1 is
 * start_i = ALIGN_ANGLE for all i. They leave conjunction, race at
 * different speeds, and lock again at the end.
 */
export function solveStartAngles(turns: readonly number[], align = ALIGN_ANGLE): number[] {
  if (turns.length === 0) {
    throw new Error("Orbit needs at least one body");
  }
  return turns.map(() => align);
}

export const ORBIT_HUES = ["#7ae7ff", "#d4ff3a", "#ffb020", "#ff6b9a", "#b388ff"] as const;
export const ORBIT_GLOWS = [
  "rgba(122, 231, 255, 0.55)",
  "rgba(212, 255, 58, 0.5)",
  "rgba(255, 176, 32, 0.5)",
  "rgba(255, 107, 154, 0.5)",
  "rgba(179, 136, 255, 0.5)",
] as const;

export function orbitBodies(): OrbitBody[] {
  const starts = solveStartAngles(ORBIT_TURNS, ALIGN_ANGLE);
  return ORBIT_TURNS.map((turns, index) => {
    const hue = ORBIT_HUES[index];
    const glow = ORBIT_GLOWS[index];
    const start = starts[index];
    if (hue === undefined || glow === undefined || start === undefined) {
      throw new Error(`Orbit body ${index} is missing palette or start`);
    }
    return { index, turns, startAngle: start, hue, glow };
  });
}

export function bodyAngle(startAngle: number, turns: number, progress: number): number {
  const p = clampProgress(progress);
  return startAngle + p * turns * Math.PI * 2;
}

export function wrapAngle(angle: number): number {
  const tau = Math.PI * 2;
  return ((angle % tau) + tau) % tau;
}

export function anglesAlign(angles: readonly number[], epsilon = 1e-9): boolean {
  if (angles.length === 0) return true;
  const first = angles[0];
  if (first === undefined) return true;
  return angles.every((angle) => {
    const delta = wrapAngle(angle - first);
    return delta < epsilon || Math.abs(delta - Math.PI * 2) < epsilon;
  });
}

export function polar(cx: number, cy: number, radius: number, angle: number): { x: number; y: number } {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
  };
}

export function trailPath(
  cx: number,
  cy: number,
  radius: number,
  angle: number,
  sweep: number,
): string {
  const start = polar(cx, cy, radius, angle - sweep);
  const end = polar(cx, cy, radius, angle);
  const large = sweep > Math.PI ? 1 : 0;
  return `M ${start.x.toFixed(3)} ${start.y.toFixed(3)} A ${radius} ${radius} 0 ${large} 1 ${end.x.toFixed(3)} ${end.y.toFixed(3)}`;
}

export function ringRadii(count: number, inner: number, outer: number): number[] {
  if (count <= 1) return [outer];
  return Array.from({ length: count }, (_, i) => inner + ((outer - inner) * i) / (count - 1));
}
