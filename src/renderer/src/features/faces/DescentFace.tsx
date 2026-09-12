import type { JSX } from "react";
import { DescentFace as DescentVisual } from "./descent/DescentFace";
import type { FaceProps } from "./types";
import { toVisualFaceProps } from "./visual";

/** Deep-sea timer. Foundation host calls this; paint lives in `./descent`. */
export function DescentFace(props: FaceProps): JSX.Element {
  return <DescentVisual {...toVisualFaceProps(props)} />;
}
