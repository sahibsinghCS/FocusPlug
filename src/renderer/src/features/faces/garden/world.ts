import { hashString, mulberry32 } from "../canvas";
import type { RGB } from "./math";

export type FlowerKind = "daisy" | "poppy" | "tulip" | "lavender" | "cosmos";

export interface GardenHill {
  y: number;
  amplitude: number;
  seed: number;
  color: RGB;
}

export interface GardenTree {
  x: number;
  y: number;
  scale: number;
  lean: number;
  apples: number;
  seed: number;
}

export interface GardenFlower {
  x: number;
  y: number;
  kind: FlowerKind;
  scale: number;
  rot: number;
  seed: number;
}

export interface GardenBlade {
  x: number;
  y: number;
  len: number;
  seed: number;
  layer: number;
}

export interface GardenStar {
  x: number;
  y: number;
  r: number;
  twinkle: number;
}

export interface GardenFirefly {
  x: number;
  y: number;
  seed: number;
}

export interface GardenBird {
  x: number;
  y: number;
  scale: number;
  seed: number;
}

export interface GardenWorld {
  sessionId: string;
  hills: GardenHill[];
  trees: GardenTree[];
  flowers: GardenFlower[];
  blades: GardenBlade[];
  stars: GardenStar[];
  fireflies: GardenFirefly[];
  birds: GardenBird[];
}

const KINDS: readonly FlowerKind[] = ["daisy", "poppy", "tulip", "lavender", "cosmos"];

function pickKind(rng: () => number): FlowerKind {
  const index = Math.min(KINDS.length - 1, Math.floor(rng() * KINDS.length));
  return KINDS[index] ?? "daisy";
}

function clusterFlowers(
  rng: () => number,
  flowers: GardenFlower[],
  cx: number,
  cy: number,
  count: number,
  spreadX: number,
  spreadY: number,
): void {
  for (let i = 0; i < count; i += 1) {
    flowers.push({
      x: cx + (rng() - 0.5) * spreadX,
      y: cy + (rng() - 0.5) * spreadY,
      kind: pickKind(rng),
      scale: 0.55 + rng() * 0.7,
      rot: (rng() - 0.5) * 0.5,
      seed: rng() * Math.PI * 2,
    });
  }
}

export function buildGardenWorld(sessionId: unknown): GardenWorld {
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  const rng = mulberry32(hashString(`garden:${sessionId}`));

  const hills: GardenHill[] = [
    { y: 0.5, amplitude: 0.045, seed: rng() * 8, color: { r: 46, g: 62, b: 48 } },
    { y: 0.56, amplitude: 0.055, seed: rng() * 8, color: { r: 52, g: 92, b: 46 } },
    { y: 0.64, amplitude: 0.04, seed: rng() * 8, color: { r: 62, g: 112, b: 48 } },
  ];

  const trees: GardenTree[] = [
    { x: 0.1, y: 0.58, scale: 0.72, lean: -0.08, apples: 7, seed: rng() },
    { x: 0.22, y: 0.56, scale: 0.9, lean: 0.05, apples: 9, seed: rng() },
    { x: 0.38, y: 0.54, scale: 0.62, lean: -0.03, apples: 6, seed: rng() },
    { x: 0.7, y: 0.55, scale: 0.84, lean: 0.07, apples: 8, seed: rng() },
    { x: 0.84, y: 0.58, scale: 0.7, lean: -0.05, apples: 7, seed: rng() },
    { x: 0.93, y: 0.6, scale: 0.5, lean: 0.04, apples: 5, seed: rng() },
  ].map((tree) => ({
    ...tree,
    x: tree.x + (rng() - 0.5) * 0.02,
    lean: tree.lean + (rng() - 0.5) * 0.04,
    seed: rng() * Math.PI * 2,
  }));

  const flowers: GardenFlower[] = [];
  clusterFlowers(rng, flowers, 0.32, 0.78, 16, 0.22, 0.08);
  clusterFlowers(rng, flowers, 0.55, 0.74, 14, 0.2, 0.07);
  clusterFlowers(rng, flowers, 0.74, 0.8, 12, 0.16, 0.06);
  clusterFlowers(rng, flowers, 0.16, 0.82, 10, 0.14, 0.06);
  clusterFlowers(rng, flowers, 0.48, 0.86, 11, 0.28, 0.05);
  for (let i = 0; i < 18; i += 1) {
    flowers.push({
      x: 0.06 + rng() * 0.88,
      y: 0.7 + rng() * 0.22,
      kind: pickKind(rng),
      scale: 0.45 + rng() * 0.45,
      rot: (rng() - 0.5) * 0.4,
      seed: rng() * Math.PI * 2,
    });
  }

  const blades: GardenBlade[] = [];
  for (let i = 0; i < 90; i += 1) {
    blades.push({
      x: rng(),
      y: 0.78 + rng() * 0.2,
      len: 0.08 + rng() * 0.14,
      seed: rng() * Math.PI * 2,
      layer: 0,
    });
  }
  for (let i = 0; i < 46; i += 1) {
    blades.push({
      x: rng(),
      y: 0.7 + rng() * 0.1,
      len: 0.06 + rng() * 0.09,
      seed: rng() * Math.PI * 2,
      layer: 1,
    });
  }

  const stars: GardenStar[] = [];
  for (let i = 0; i < 52; i += 1) {
    stars.push({
      x: rng(),
      y: rng() * 0.42,
      r: 0.4 + rng() * 1.15,
      twinkle: rng() * Math.PI * 2,
    });
  }

  const fireflies: GardenFirefly[] = [];
  for (let i = 0; i < 14; i += 1) {
    fireflies.push({
      x: 0.08 + rng() * 0.84,
      y: 0.52 + rng() * 0.32,
      seed: rng() * Math.PI * 2,
    });
  }

  const birds: GardenBird[] = [
    { x: 0.42, y: 0.2, scale: 1, seed: rng() },
    { x: 0.5, y: 0.16, scale: 0.75, seed: rng() },
    { x: 0.58, y: 0.22, scale: 0.85, seed: rng() },
  ];

  return { sessionId, hills, trees, flowers, blades, stars, fireflies, birds };
}
