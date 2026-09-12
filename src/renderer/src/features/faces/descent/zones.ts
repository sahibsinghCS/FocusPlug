import { clampProgress } from "../clamp";

export interface DescentZone {
  id: "sunlight" | "twilight" | "midnight" | "abyssal";
  name: string;
  layer: string;
  /** Inclusive start of the designed visual band (0..1). */
  start: number;
  /** Exclusive end, 1 for the last zone. */
  end: number;
  depthStartM: number;
  depthEndM: number;
  /** Top-of-zone water color. */
  top: string;
  /** Bottom-of-zone water color. */
  bottom: string;
}

/**
 * Visual bands are readable milestones, not a literal bathymetric scale
 * (real sunlight is only 200 m of 6 km). Labels and meter ranges are real.
 */
export const DESCENT_ZONES: readonly DescentZone[] = [
  {
    id: "sunlight",
    name: "Sunlight",
    layer: "Epipelagic",
    start: 0,
    end: 0.22,
    depthStartM: 0,
    depthEndM: 200,
    top: "#c8f4ea",
    bottom: "#3ecfc4",
  },
  {
    id: "twilight",
    name: "Twilight",
    layer: "Mesopelagic",
    start: 0.22,
    end: 0.48,
    depthStartM: 200,
    depthEndM: 1000,
    top: "#1aa8c4",
    bottom: "#164a8c",
  },
  {
    id: "midnight",
    name: "Midnight",
    layer: "Bathypelagic",
    start: 0.48,
    end: 0.76,
    depthStartM: 1000,
    depthEndM: 4000,
    top: "#1a2f78",
    bottom: "#0b1030",
  },
  {
    id: "abyssal",
    name: "Abyssal",
    layer: "Abyssopelagic",
    start: 0.76,
    end: 1,
    depthStartM: 4000,
    depthEndM: 6000,
    top: "#08091a",
    bottom: "#030308",
  },
];

export function zoneAt(progress: number): DescentZone {
  const p = clampProgress(progress);
  const found = DESCENT_ZONES.find((zone) => p < zone.end) ?? DESCENT_ZONES[DESCENT_ZONES.length - 1];
  if (!found) {
    throw new Error("Descent zones are empty");
  }
  return found;
}

export function depthMeters(progress: number): number {
  const p = clampProgress(progress);
  const zone = zoneAt(p);
  const span = zone.end - zone.start;
  const t = span <= 0 ? 1 : (p - zone.start) / span;
  return zone.depthStartM + t * (zone.depthEndM - zone.depthStartM);
}

export function formatDepth(meters: number): string {
  const rounded = Math.round(Math.max(0, meters));
  return `${rounded.toLocaleString("en-US")} m`;
}

export function bioAmount(progress: number): number {
  const p = clampProgress(progress);
  if (p < 0.42) return 0;
  if (p >= 0.55) return 1;
  return (p - 0.42) / 0.13;
}
