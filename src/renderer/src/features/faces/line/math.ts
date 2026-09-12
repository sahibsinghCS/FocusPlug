import type { FaceProps, FaceRound } from "../types";
import { clamp, lerp } from "../canvas";

export interface PolyPoint {
  x: number;
  y: number;
}

export interface Station {
  id: string;
  label: string;
  at: number;
  kind: "focus" | "break" | "terminus";
}

export interface PathSample {
  x: number;
  y: number;
  angle: number;
  traveled: number;
}

/** Fixed 45° / 90° subway polyline in normalized 0..1 space. */
export function transitPolyline(): PolyPoint[] {
  return [
    { x: 0.08, y: 0.7 },
    { x: 0.26, y: 0.7 },
    { x: 0.4, y: 0.56 },
    { x: 0.5, y: 0.56 },
    { x: 0.5, y: 0.34 },
    { x: 0.62, y: 0.22 },
    { x: 0.76, y: 0.22 },
    { x: 0.88, y: 0.34 },
    { x: 0.93, y: 0.34 },
  ];
}

export function assertOrthogonal(points: readonly PolyPoint[]): boolean {
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) {
      return false;
    }
    const dx = Math.abs(b.x - a.x);
    const dy = Math.abs(b.y - a.y);
    const axis = dx < 1e-6 || dy < 1e-6;
    const diag = Math.abs(dx - dy) < 1e-6;
    if (!axis && !diag) {
      return false;
    }
  }
  return true;
}

export function segmentMetrics(points: readonly PolyPoint[]): {
  lengths: number[];
  total: number;
} {
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (!a || !b) {
      lengths.push(0);
      continue;
    }
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    lengths.push(d);
    total += d;
  }
  return { lengths, total };
}

export function pointAtProgress(
  points: readonly PolyPoint[],
  progress: number,
): PathSample {
  const { lengths, total } = segmentMetrics(points);
  if (points.length === 0 || total <= 0) {
    return { x: 0, y: 0, angle: 0, traveled: 0 };
  }
  const first = points[0];
  if (!first) {
    return { x: 0, y: 0, angle: 0, traveled: 0 };
  }
  const target = clamp(progress, 0, 1) * total;
  let traveled = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = lengths[i - 1] ?? 0;
    if (!a || !b) {
      continue;
    }
    if (traveled + len >= target || i === points.length - 1) {
      const t = len > 0 ? clamp((target - traveled) / len, 0, 1) : 1;
      return {
        x: lerp(a.x, b.x, t),
        y: lerp(a.y, b.y, t),
        angle: Math.atan2(b.y - a.y, b.x - a.x),
        traveled: target,
      };
    }
    traveled += len;
  }
  const last = points[points.length - 1] ?? first;
  return { x: last.x, y: last.y, angle: 0, traveled: total };
}

function uniqueMarks(values: number[]): number[] {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    const clamped = clamp(value, 0, 1);
    const prev = out[out.length - 1];
    if (prev === undefined || Math.abs(prev - clamped) > 1e-4) {
      out.push(clamped);
    }
  }
  if (out[0] !== 0) {
    out.unshift(0);
  }
  if ((out[out.length - 1] ?? 0) !== 1) {
    out.push(1);
  }
  return out;
}

export function stationsFromRounds(rounds: readonly FaceRound[]): Station[] {
  const marks = uniqueMarks(rounds.flatMap((round) => [round.start, round.end]));
  return marks.map((at, index) => {
    if (index === 0) {
      return { id: `st-${index}`, label: "Start", at, kind: "terminus" };
    }
    if (index === marks.length - 1) {
      return { id: `st-${index}`, label: "End", at, kind: "terminus" };
    }
    const starting = rounds.find((round) => Math.abs(round.start - at) < 1e-4);
    if (starting) {
      return {
        id: `st-${index}`,
        label: starting.kind === "break" ? "Break" : starting.label,
        at,
        kind: starting.kind,
      };
    }
    const ending = rounds.find((round) => Math.abs(round.end - at) < 1e-4);
    return {
      id: `st-${index}`,
      label: ending?.kind === "break" ? "Break" : (ending?.label ?? `S${index}`),
      at,
      kind: ending?.kind === "break" ? "break" : "focus",
    };
  });
}

export function thirdStations(): Station[] {
  return [
    { id: "t0", label: "Start", at: 0, kind: "terminus" },
    { id: "t1", label: "⅓", at: 1 / 3, kind: "focus" },
    { id: "t2", label: "⅔", at: 2 / 3, kind: "focus" },
    { id: "t3", label: "End", at: 1, kind: "terminus" },
  ];
}

export function twoStopStations(): Station[] {
  return [
    { id: "a", label: "Start", at: 0, kind: "terminus" },
    { id: "b", label: "End", at: 1, kind: "terminus" },
  ];
}

export function resolveStations(props: FaceProps): Station[] {
  if (props.rounds && props.rounds.length > 0) {
    return stationsFromRounds(props.rounds);
  }
  if (props.lineMode === "plain") {
    return twoStopStations();
  }
  if (props.lineMode === "thirds") {
    return thirdStations();
  }
  if (props.phase === "idle" || props.elapsedMs <= 0) {
    return twoStopStations();
  }
  return thirdStations();
}

export function segmentKindAt(
  rounds: readonly FaceRound[] | undefined,
  at: number,
  phase: FaceProps["phase"],
): "focus" | "break" {
  if (rounds && rounds.length > 0) {
    const hit = rounds.find((round) => at >= round.start && at < round.end);
    return hit?.kind === "break" ? "break" : "focus";
  }
  return phase === "break" ? "break" : "focus";
}

export function nextStation(stations: readonly Station[], progress: number): Station | null {
  for (const station of stations) {
    if (station.at > progress + 1e-4) {
      return station;
    }
  }
  return stations[stations.length - 1] ?? null;
}

export function passedStations(stations: readonly Station[], progress: number): Set<string> {
  return new Set(stations.filter((station) => station.at <= progress + 1e-4).map((s) => s.id));
}
