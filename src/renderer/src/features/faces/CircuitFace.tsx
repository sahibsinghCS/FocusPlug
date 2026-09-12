import type { JSX } from "react";
import { PendingFace } from "./PendingFace";
import type { FaceProps } from "./types";

/** Owned by agent/faces-circuit. Foundation ships the empty slot only. */
export function CircuitFace(props: FaceProps): JSX.Element {
  return (
    <PendingFace
      {...props}
      id="circuit"
      silhouette={
        <svg viewBox="0 0 120 48" className="h-10 w-28" fill="none">
          <rect x="8" y="10" width="104" height="28" rx="14" stroke="currentColor" strokeWidth="1.5" />
          <circle cx="30" cy="24" r="3" fill="currentColor" />
        </svg>
      }
    />
  );
}
