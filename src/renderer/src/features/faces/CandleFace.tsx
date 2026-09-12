import type { JSX } from "react";
import { CandleVessel } from "./candle/CandleFace";
import { parseCandlePreview } from "./candle/preview";
import { parseKillsParam } from "./urlFace";
import type { FaceProps } from "./types";

function stillsFreeze(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return parseCandlePreview(window.location.search, window.location.hash).freeze;
}

function stillsKills(fallback: number): number {
  if (typeof fallback !== "number" || !Number.isFinite(fallback)) {
    throw new Error("killCount must be a finite number");
  }
  if (typeof window === "undefined") {
    return Math.max(0, fallback);
  }
  return parseKillsParam(window.location.search, window.location.hash) ?? Math.max(0, fallback);
}

/** Candle slot — melting beeswax timer. Elapsed burns the pillar down. */
export function CandleFace(props: FaceProps): JSX.Element {
  if (typeof props.sessionId !== "string" || props.sessionId.length === 0) {
    throw new Error("sessionId must be a non-empty string");
  }
  const width = Math.max(1, Math.round(props.width));
  const height = Math.max(1, Math.round(props.height));
  return (
    <div
      className="fp-candle-face"
      data-face="candle"
      data-face-status="ready"
      data-phase={props.phase}
    >
      <CandleVessel
        progress={props.progress}
        phase={props.phase}
        remainingMs={props.remainingMs}
        elapsedMs={props.elapsedMs}
        sessionId={props.sessionId}
        killCount={stillsKills(props.killCount)}
        width={width}
        height={height}
        freeze={stillsFreeze()}
      />
    </div>
  );
}
