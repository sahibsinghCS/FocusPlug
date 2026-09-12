import type { ComponentType } from "react";
import { CircuitFace } from "./circuit";
import { DescentFace } from "./descent";
import { OrbitFace } from "./orbit";
import { VISUAL_FACE_IDS, type VisualFaceId, type VisualFaceProps } from "./visual";

export interface VisualFaceModule {
  id: VisualFaceId;
  title: string;
  tagline: string;
  Component: ComponentType<VisualFaceProps>;
}

/** Cheap-wow paint catalog. Foundation registry still owns FaceId → host component. */
export const FACE_CATALOG: Record<VisualFaceId, VisualFaceModule> = {
  descent: {
    id: "descent",
    title: "Descent",
    tagline: "Deep-sea timer",
    Component: DescentFace,
  },
  orbit: {
    id: "orbit",
    title: "Orbit",
    tagline: "Alignment lock",
    Component: OrbitFace,
  },
  circuit: {
    id: "circuit",
    title: "Circuit",
    tagline: "Fuse rail",
    Component: CircuitFace,
  },
};

export const FACE_REGISTRY = FACE_CATALOG;

export function listFaces(): VisualFaceModule[] {
  return VISUAL_FACE_IDS.map((id) => FACE_CATALOG[id]);
}

export function getFace(id: VisualFaceId): VisualFaceModule {
  const face = FACE_CATALOG[id];
  if (!face) {
    throw new Error(`Unknown face: ${id}`);
  }
  return face;
}
