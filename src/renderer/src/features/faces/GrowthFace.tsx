import type { JSX } from "react";
import { GrowthFace as GrowthBonsai } from "./growth/GrowthFace";
import { isFaceThumb } from "./thumb";
import { parseKillsParam, parseSessionParam } from "./urlFace";
import type { FaceProps } from "./types";

function stillsSessionId(fallback: string): string {
  if (typeof fallback !== "string" || fallback.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  if (typeof window === "undefined") {
    return fallback;
  }
  return parseSessionParam(window.location.search, window.location.hash) ?? fallback;
}

function stillsKillCount(fallback: number): number {
  if (typeof fallback !== "number" || !Number.isFinite(fallback)) {
    throw new Error("killCount must be a finite number");
  }
  if (typeof window === "undefined") {
    return Math.max(0, fallback);
  }
  return parseKillsParam(window.location.search, window.location.hash) ?? Math.max(0, fallback);
}

/** Growth slot — session-seeded bonsai. Wilt is kill-count stakes. */
export function GrowthFace(props: FaceProps): JSX.Element {
  const sessionId = stillsSessionId(props.sessionId);
  const killCount = stillsKillCount(props.killCount);
  const width = Math.max(1, Math.round(props.width));
  const height = Math.max(1, Math.round(props.height));
  const thumb = isFaceThumb(height);
  return (
    <div
      className="fp-growth-face"
      data-face="growth"
      data-face-status="ready"
      data-phase={props.phase}
      data-thumb={thumb ? "1" : "0"}
    >
      <GrowthBonsai
        sessionId={sessionId}
        progress={props.progress}
        killCount={killCount}
        killEvents={props.events}
        width={width}
        height={height}
        className="fp-growth--host"
      />
    </div>
  );
}
