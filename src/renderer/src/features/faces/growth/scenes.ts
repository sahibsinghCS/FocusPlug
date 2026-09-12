import type { GrowthFaceProps } from "./types";

/** Shared seed so healthy vs wilted is the same tree, different stakes. */
export const GAUNTLET_SESSION_ID = "gauntlet-growth-01";

export type GrowthSceneName =
  | "healthy"
  | "wilted"
  | "complete"
  | "sprout"
  | "stall"
  | "diptych";

export interface GrowthScene {
  readonly name: GrowthSceneName;
  readonly sessionId: string;
  readonly progress: number;
  readonly killCount: number;
  readonly label: string;
}

export const GROWTH_SCENES: Record<Exclude<GrowthSceneName, "diptych">, GrowthScene> = {
  healthy: {
    name: "healthy",
    sessionId: GAUNTLET_SESSION_ID,
    progress: 0.74,
    killCount: 0,
    label: "Healthy mid-growth",
  },
  wilted: {
    name: "wilted",
    sessionId: GAUNTLET_SESSION_ID,
    progress: 0.74,
    killCount: 3,
    label: "Wilted after 3 kills",
  },
  complete: {
    name: "complete",
    sessionId: GAUNTLET_SESSION_ID,
    progress: 1,
    killCount: 0,
    label: "Complete — blossom open",
  },
  sprout: {
    name: "sprout",
    sessionId: GAUNTLET_SESSION_ID,
    progress: 0.2,
    killCount: 0,
    label: "Early reveal",
  },
  stall: {
    name: "stall",
    sessionId: GAUNTLET_SESSION_ID,
    progress: 0.5,
    killCount: 0,
    label: "Stall redraw",
  },
};

export function parseGrowthScene(search: string): GrowthSceneName {
  const raw = new URLSearchParams(search.startsWith("?") ? search : `?${search}`).get("scene");
  if (
    raw === "healthy" ||
    raw === "wilted" ||
    raw === "complete" ||
    raw === "sprout" ||
    raw === "stall" ||
    raw === "diptych"
  ) {
    return raw;
  }
  return "healthy";
}

export function sceneToProps(scene: GrowthScene): Pick<GrowthFaceProps, "sessionId" | "progress" | "killCount"> {
  return {
    sessionId: scene.sessionId,
    progress: scene.progress,
    killCount: scene.killCount,
  };
}
