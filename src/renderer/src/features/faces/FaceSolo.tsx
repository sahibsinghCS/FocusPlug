import type { JSX } from "react";
import { defaultSceneFor, faceFixture } from "./fixtures";
import { LineFace } from "./line";
import { MovementFace } from "./movement";
import { ProgressBarFace } from "./ProgressBarFace";
import { RecordFace } from "./record";
import type { FaceId, FaceProps } from "./instrument";
import { readFaceUrl, type SoloFaceId } from "./urlFace";

export function FaceSolo(): JSX.Element {
  const url = readFaceUrl();
  const id: SoloFaceId = url.face ?? "record";
  const resolved = id === "bar" ? "artifact" : url.scene === "bar" ? defaultSceneFor("record") : url.scene;
  const base = faceFixture(id === "bar" ? "record" : id, resolved);
  const props: FaceProps = { ...base, freeze: url.freeze || base.freeze };
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
  if (id === "bar") {
    return <ProgressBarFace {...props} />;
  }
  return <RecordFace {...props} />;
}

export function renderMidFace(id: FaceId, props: FaceProps): JSX.Element {
  return renderFace(id, props);
}
