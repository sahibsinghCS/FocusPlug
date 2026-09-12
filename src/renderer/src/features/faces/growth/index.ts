import { GrowthFace } from "./GrowthFace";

export { GrowthFace } from "./GrowthFace";
export { growthPalette, HEALTHY_PALETTE, wiltFromKills } from "./colors";
export {
  killCountFromEvents,
  makeView,
  poseGrowth,
  resolveKillCount,
  resolveProgress,
} from "./pose";
export { createSessionRng, hashSessionId } from "./rng";
export {
  GAUNTLET_SESSION_ID,
  GROWTH_SCENES,
  parseGrowthScene,
  sceneToProps,
} from "./scenes";
export { buildDrawModel, leafPath } from "./svg";
export { generateGrowthTree, peekGrowthTree, serializeGrowthTree } from "./tree";
export {
  GROWTH_FACE_ID,
  GROWTH_FACE_TITLE,
  type GrowthFaceProps,
  type GrowthTree,
  type PosedGrowth,
} from "./types";

/** Registry descriptor for FACES foundation. Geometry is session-seeded; wilt is stakes. */
export const growthFace = {
  id: "growth" as const,
  title: "Growth",
  Face: GrowthFace,
};
