import type { JSX } from "react";
import { PendingFace } from "./PendingFace";
import type { FaceProps } from "./types";

/** Owned by agent/faces-descent. Foundation ships the empty slot only. */
export function DescentFace(props: FaceProps): JSX.Element {
  return (
    <PendingFace
      {...props}
      id="descent"
      silhouette={
        <svg viewBox="0 0 80 56" className="h-12 w-16" fill="none">
          <path d="M12 8 H40 L28 20 H40 L28 32 H40 L20 48" stroke="currentColor" strokeWidth="1.6" />
          <path d="M48 12 L68 12 L58 24 L68 24 L52 44" stroke="currentColor" strokeWidth="1.2" opacity="0.45" />
        </svg>
      }
    />
  );
}
