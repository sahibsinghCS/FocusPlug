import type { ComponentType } from "react";
import { CircuitFace } from "./circuit";
import { DescentFace } from "./descent";
import { OrbitFace } from "./orbit";
import type { FaceId, FaceMeta, FaceProps } from "./types";
import { FACE_IDS } from "./types";

export interface FaceModule extends FaceMeta {
  Component: ComponentType<FaceProps>;
}

export const FACE_CATALOG: Record<FaceId, FaceModule> = {
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

/** Foundation can iterate this map without importing each face. */
export const FACE_REGISTRY = FACE_CATALOG;

export function listFaces(): FaceModule[] {
  return FACE_IDS.map((id) => FACE_CATALOG[id]);
}

export function getFace(id: FaceId): FaceModule {
  const face = FACE_CATALOG[id];
  if (!face) {
    throw new Error(`Unknown face: ${id}`);
  }
  return face;
}
