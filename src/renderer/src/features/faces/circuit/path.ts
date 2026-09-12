export interface CircuitPoint {
  x: number;
  y: number;
}

/** Hand-authored vertices — only 90° and 45° segments. Not autorouted. */
export const CIRCUIT_POINTS: readonly CircuitPoint[] = [
  { x: 100, y: 360 },
  { x: 180, y: 360 },
  { x: 180, y: 240 },
  { x: 260, y: 240 },
  { x: 310, y: 190 },
  { x: 420, y: 190 },
  { x: 420, y: 280 },
  { x: 520, y: 280 },
  { x: 570, y: 330 },
  { x: 680, y: 330 },
  { x: 680, y: 200 },
  { x: 780, y: 200 },
  { x: 820, y: 160 },
  { x: 880, y: 160 },
];

export const CIRCUIT_VIEW = { width: 960, height: 540 } as const;

export function polylineLength(points: readonly CircuitPoint[]): number {
  if (points.length < 2) {
    return 0;
  }
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    if (!prev || !next) continue;
    length += Math.hypot(next.x - prev.x, next.y - prev.y);
  }
  return length;
}

export function pathFromPoints(points: readonly CircuitPoint[]): string {
  const first = points[0];
  if (!first) {
    throw new Error("Circuit path needs at least one point");
  }
  const cmds = [`M ${first.x} ${first.y}`];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    if (!prev || !next) continue;
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    if (dy === 0) {
      cmds.push(`H ${next.x}`);
    } else if (dx === 0) {
      cmds.push(`V ${next.y}`);
    } else {
      cmds.push(`L ${next.x} ${next.y}`);
    }
  }
  return cmds.join(" ");
}

export const CIRCUIT_D = pathFromPoints(CIRCUIT_POINTS);
export const CIRCUIT_LENGTH = polylineLength(CIRCUIT_POINTS);

/** Static unpowered copper — density only, not driven by progress. */
export const DEAD_TRACES: readonly string[] = [
  "M 80 430 H 200 V 470 H 320 L 350 500 H 460",
  "M 720 430 H 800 V 390 H 860 V 460",
  "M 240 90 H 300 V 130 H 360",
  "M 540 90 H 620 V 70 H 700",
  "M 140 200 V 160 H 80 V 120",
];

export const CIRCUIT_START = CIRCUIT_POINTS[0] ?? { x: 100, y: 360 };
export const CIRCUIT_END = CIRCUIT_POINTS[CIRCUIT_POINTS.length - 1] ?? { x: 880, y: 160 };

export function assertRightOr45(points: readonly CircuitPoint[]): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    if (!prev || !next) continue;
    const dx = Math.abs(next.x - prev.x);
    const dy = Math.abs(next.y - prev.y);
    const ortho = dx === 0 || dy === 0;
    const fortyFive = dx > 0 && dy > 0 && Math.abs(dx - dy) < 1e-6;
    if (!ortho && !fortyFive) return false;
  }
  return true;
}

export function dashOffset(length: number, progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return length * (1 - p);
}

/** Pads sit on vertices; vias sit on 45° joints. */
export function vertexPads(points: readonly CircuitPoint[]): CircuitPoint[] {
  return points.slice();
}

export function viaPoints(points: readonly CircuitPoint[]): CircuitPoint[] {
  const vias: CircuitPoint[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    if (!prev || !next) continue;
    const dx = Math.abs(next.x - prev.x);
    const dy = Math.abs(next.y - prev.y);
    if (dx > 0 && dy > 0 && Math.abs(dx - dy) < 1e-6) {
      vias.push(next);
    }
  }
  return vias;
}
