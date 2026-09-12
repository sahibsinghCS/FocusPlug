import { clamp01, desaturateHex, mixHex } from "./rng";
import type { GrowthPalette } from "./types";

/** Healthy Growth palette: dark soil, green-grey bark, two greens, pale blossom. */
export const HEALTHY_PALETTE = {
  soil: "#1a1410",
  soilRim: "#2b2218",
  pot: "#3d322c",
  potRim: "#53443c",
  potShadow: "#0c0a08",
  bark: "#6a7066",
  barkEdge: "#4a4f48",
  greenA: "#3f6b45",
  greenB: "#7d9a58",
  blossom: "#f3ddd6",
  blossomEdge: "#e4c7bc",
  blossomHeart: "#e8c4b8",
} as const satisfies GrowthPalette;

/**
 * Wilt drives desaturation toward khaki/olive — sad stakes, not a broken shader.
 * Soil and pot stay dark so only the tree reads as punished.
 */
export function growthPalette(wilt: number): GrowthPalette {
  const t = clamp01(wilt);
  const bark = mixHex(desaturateHex(HEALTHY_PALETTE.bark, t * 0.55), "#5c564c", t * 0.5);
  const barkEdge = mixHex(desaturateHex(HEALTHY_PALETTE.barkEdge, t * 0.45), "#3f3a34", t * 0.45);
  const greenA = mixHex(desaturateHex(HEALTHY_PALETTE.greenA, t * 0.78), "#6a5a40", t * 0.55);
  const greenB = mixHex(desaturateHex(HEALTHY_PALETTE.greenB, t * 0.78), "#7a6b48", t * 0.55);
  const blossom = mixHex(HEALTHY_PALETTE.blossom, "#c4b4aa", t * 0.62);
  const blossomEdge = mixHex(HEALTHY_PALETTE.blossomEdge, "#a89888", t * 0.58);
  const blossomHeart = mixHex(HEALTHY_PALETTE.blossomHeart, "#9a8a7c", t * 0.6);
  return {
    soil: HEALTHY_PALETTE.soil,
    soilRim: HEALTHY_PALETTE.soilRim,
    pot: HEALTHY_PALETTE.pot,
    potRim: HEALTHY_PALETTE.potRim,
    potShadow: HEALTHY_PALETTE.potShadow,
    bark,
    barkEdge,
    greenA,
    greenB,
    blossom,
    blossomEdge,
    blossomHeart,
  };
}

export function wiltFromKills(killCount: number): number {
  if (typeof killCount !== "number" || !Number.isFinite(killCount)) {
    throw new Error("killCount must be a finite number");
  }
  return clamp01(Math.max(0, killCount) / 3);
}
