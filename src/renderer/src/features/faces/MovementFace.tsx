import type { JSX } from "react";
import { PendingFace } from "./PendingFace";
import type { FaceProps } from "./types";

/** Owned by agent/faces-movement. Foundation ships the empty slot only. */
export function MovementFace(props: FaceProps): JSX.Element {
  return (
    <PendingFace
      {...props}
      id="movement"
      silhouette={
        <svg viewBox="0 0 120 40" className="h-9 w-28" fill="none">
          <path
            d="M4 22 L18 22 L26 8 L38 32 L50 18 L62 28 L74 6 L86 24 L98 16 L116 16"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      }
    />
  );
}
