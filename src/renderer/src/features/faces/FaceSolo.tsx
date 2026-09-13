import type { JSX } from "react";
import { defaultSceneFor, faceFixture } from "./fixtures";
import { LineFace } from "./line";
import { MovementFace } from "./movement";
import { ProgressBarFace } from "./ProgressBarFace";
import type { FaceId, FaceProps } from "./instrument";
import { parseProgressParam, readFaceUrl, type SoloFaceId } from "./urlFace";

export function FaceSolo(): JSX.Element {
  const url = readFaceUrl();
  const id: SoloFaceId = url.face ?? "movement";
  const resolved = id === "bar" ? "artifact" : url.scene === "bar" ? defaultSceneFor(id) : url.scene;
  const base = faceFixture(id, resolved);
  const progress = parseProgressParam(window.location.search, window.location.hash);
  const props: FaceProps = {
    ...base,
    freeze: url.freeze || base.freeze,
    progress: progress ?? base.progress,
  };
  return (
    <div className="fp-face-solo" data-face={id} data-scene={resolved}>
      {renderFace(id, props)}
    </div>
  );
}

export function renderFace(id: SoloFaceId, props: FaceProps): JSX.Element {
  if (id === "movement") {
    return <MovementFace {...props} />;
  }
  if (id === "line") {
    return <LineFace {...props} />;
  }
  return <ProgressBarFace {...props} />;
}

export function renderMidFace(id: FaceId, props: FaceProps): JSX.Element {
  return renderFace(id, props);
}
