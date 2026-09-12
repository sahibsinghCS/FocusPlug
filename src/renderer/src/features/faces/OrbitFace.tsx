import type { JSX } from "react";
import { PendingFace } from "./PendingFace";
import type { FaceProps } from "./types";

/** Owned by agent/faces-orbit. Foundation ships the empty slot only. */
export function OrbitFace(props: FaceProps): JSX.Element {
  return (
    <PendingFace
      {...props}
      id="orbit"
      silhouette={
        <svg viewBox="0 0 80 48" className="h-10 w-16" fill="none">
          <ellipse cx="40" cy="24" rx="28" ry="12" stroke="currentColor" strokeWidth="1.3" />
          <circle cx="40" cy="24" r="4" fill="currentColor" />
          <circle cx="66" cy="20" r="2.4" fill="currentColor" />
        </svg>
      }
    />
  );
}
