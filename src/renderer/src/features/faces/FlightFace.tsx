import type { JSX } from "react";
import { PendingFace } from "./PendingFace";
import type { FaceProps } from "./types";

/** Owned by agent/faces-flight. Foundation ships the empty slot only. */
export function FlightFace(props: FaceProps): JSX.Element {
  return (
    <PendingFace
      {...props}
      id="flight"
      silhouette={
        <svg viewBox="0 0 120 48" className="h-10 w-28" fill="none">
          <path
            d="M8 30 L52 24 L112 10 L100 24 L112 38 L52 28 Z"
            stroke="currentColor"
            strokeWidth="1.4"
            fill="currentColor"
            fillOpacity="0.08"
          />
          <circle cx="24" cy="28" r="2" fill="currentColor" opacity="0.45" />
        </svg>
      }
    />
  );
}
