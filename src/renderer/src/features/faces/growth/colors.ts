import { clamp01, desaturateHex, mixHex } from "./rng";
import type { GrowthPalette } from "./types";

/** Healthy Growth palette: dark soil, green-grey bark, two greens, pale blossom. */
export const HEALTHY_PALETTE = {
  soil: "#1a1410",
  soilRim: "#2b2218",
  pot: "#3d322c",
  potRim: "#53443c",
  potShadow: "#0c0a08",
  bark: "#5c6358",
  barkEdge: "#3d4338",
  greenA: "#2f6d38",
  greenB: "#7eae3f",
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
  const bark = mixHex(desaturateHex(HEALTHY_PALETTE.bark, t * 0.6), "#4a453c", t * 0.62);
  const barkEdge = mixHex(desaturateHex(HEALTHY_PALETTE.barkEdge, t * 0.5), "#2f2b26", t * 0.55);
  const greenA = mixHex(desaturateHex(HEALTHY_PALETTE.greenA, t * 0.82), "#7a6840", t * 0.7);
  const greenB = mixHex(desaturateHex(HEALTHY_PALETTE.greenB, t * 0.82), "#8a7848", t * 0.7);
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
