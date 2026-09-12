import type { JSX } from "react";
import { PendingFace } from "./PendingFace";
import type { FaceProps } from "./types";

/** Owned by agent/faces-line. Foundation ships the empty slot only. */
export function LineFace(props: FaceProps): JSX.Element {
  return (
    <PendingFace
      {...props}
      id="line"
      silhouette={
        <svg viewBox="0 0 120 32" className="h-8 w-28" fill="none">
          <path d="M6 16 H114" stroke="currentColor" strokeWidth="1.4" />
          <path d="M6 10 V22 M30 12 V20 M60 8 V24 M90 12 V20 M114 10 V22" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      }
    />
  );
}
