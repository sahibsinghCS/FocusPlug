import type { JSX } from "react";
import { FlaskVessel } from "./flask/FlaskFace";
import { parseFlaskPreview } from "./flask/preview";
import type { FaceProps } from "./types";

function stillsFreeze(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return parseFlaskPreview(window.location.search, window.location.hash).freeze;
}

/** Flask slot — glass water vessel. Remaining time is the water; the leak is visible. */
export function FlaskFace(props: FaceProps): JSX.Element {
  if (typeof props.sessionId !== "string" || props.sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  const width = Math.max(1, Math.round(props.width));
  const height = Math.max(1, Math.round(props.height));
  return (
    <div
      className="fp-flask-face"
      data-face="flask"
      data-face-status="ready"
      data-phase={props.phase}
    >
      <FlaskVessel
        progress={props.progress}
        phase={props.phase}
        remainingMs={props.remainingMs}
        elapsedMs={props.elapsedMs}
        sessionId={props.sessionId}
        width={width}
        height={height}
        freeze={stillsFreeze()}
        paused={props.paused}
      />
    </div>
  );
}
