import type { JSX } from "react";
import { GardenVisual } from "./garden/GardenFace";
import type { FaceProps } from "./types";
import { parseFaceUrl, parseSessionParam } from "./urlFace";

function stillsFreeze(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const url = parseFaceUrl(window.location.search, window.location.hash);
  if (url.freeze) {
    return true;
  }
  const raw = `${window.location.search}${window.location.hash}`;
  return /(?:\?|&|#)(?:still|freeze)=/.test(raw);
}

function stillsSessionId(fallback: string): string {
  if (typeof fallback !== "string" || fallback.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  if (typeof window === "undefined") {
    return fallback;
  }
  return parseSessionParam(window.location.search, window.location.hash) ?? fallback;
}

/** Garden slot — colorful orchard. Progress is sun elevation. */
export function GardenFace(props: FaceProps): JSX.Element {
  const width = Math.max(1, Math.round(props.width));
  const height = Math.max(1, Math.round(props.height));
  return (
    <GardenVisual
      sessionId={stillsSessionId(props.sessionId)}
      progress={props.progress}
      phase={props.phase}
      width={width}
      height={height}
      freeze={stillsFreeze()}
      paused={props.paused}
    />
  );
}
