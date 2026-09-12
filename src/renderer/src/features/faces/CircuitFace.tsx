import type { JSX } from "react";
import { CircuitFace as CircuitVisual } from "./circuit/CircuitFace";
import type { FaceProps } from "./types";
import { toVisualFaceProps } from "./visual";

/** Session fuse plate. Foundation host calls this; paint lives in `./circuit`. */
export function CircuitFace(props: FaceProps): JSX.Element {
  return <CircuitVisual {...toVisualFaceProps(props)} />;
}
