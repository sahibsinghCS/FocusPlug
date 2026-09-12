import type { JSX } from "react";
import { OrbitFace as OrbitVisual } from "./orbit/OrbitFace";
import type { FaceProps } from "./types";
import { toVisualFaceProps } from "./visual";

/** Alignment lock. Foundation host calls this; paint lives in `./orbit`. */
export function OrbitFace(props: FaceProps): JSX.Element {
  return <OrbitVisual {...toVisualFaceProps(props)} />;
}
