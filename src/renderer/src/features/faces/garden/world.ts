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
    { y: 0.455, amplitude: 0.07, seed: rng() * 8, color: { r: 36, g: 52, b: 58 } },
    { y: 0.54, amplitude: 0.08, seed: rng() * 8, color: { r: 42, g: 78, b: 44 } },
    { y: 0.64, amplitude: 0.055, seed: rng() * 8, color: { r: 58, g: 108, b: 46 } },
  ];

  const trees: GardenTree[] = [
    { x: 0.13, y: 0.68, scale: 1.18, lean: -0.06, apples: 11, seed: rng() },
    { x: 0.28, y: 0.62, scale: 0.78, lean: 0.05, apples: 8, seed: rng() },
    { x: 0.41, y: 0.58, scale: 0.52, lean: -0.04, apples: 6, seed: rng() },
    { x: 0.68, y: 0.6, scale: 0.7, lean: 0.06, apples: 8, seed: rng() },
    { x: 0.84, y: 0.66, scale: 1.08, lean: -0.05, apples: 10, seed: rng() },
    { x: 0.94, y: 0.61, scale: 0.56, lean: 0.04, apples: 5, seed: rng() },
  ].map((tree) => ({
    ...tree,
    x: tree.x + (rng() - 0.5) * 0.012,
    lean: tree.lean + (rng() - 0.5) * 0.03,
    seed: rng() * Math.PI * 2,
  }));

  const flowers: GardenFlower[] = [];
  clusterFlowers(rng, flowers, 0.34, 0.8, 18, 0.2, 0.07);
  clusterFlowers(rng, flowers, 0.54, 0.76, 16, 0.18, 0.06);
  clusterFlowers(rng, flowers, 0.72, 0.82, 14, 0.16, 0.06);
  clusterFlowers(rng, flowers, 0.18, 0.84, 12, 0.14, 0.05);
  clusterFlowers(rng, flowers, 0.46, 0.9, 14, 0.26, 0.04);
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
