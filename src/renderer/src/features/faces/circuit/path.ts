export interface CircuitPoint {
  x: number;
  y: number;
}

/** Hand-authored fuse-plate vertices — only 90° and 45° segments. */
export const CIRCUIT_POINTS: readonly CircuitPoint[] = [
  { x: 170, y: 330 },
  { x: 270, y: 330 },
  { x: 310, y: 290 },
  { x: 390, y: 290 },
  { x: 570, y: 290 },
  { x: 610, y: 330 },
  { x: 780, y: 330 },
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

export const CIRCUIT_START = CIRCUIT_POINTS[0] ?? { x: 170, y: 330 };
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
