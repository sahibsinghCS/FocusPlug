import type { JSX } from "react";
import { PendingFace } from "./PendingFace";
import type { FaceProps } from "./types";

/** Owned by agent/faces-growth. Foundation ships the empty slot only. */
export function GrowthFace(props: FaceProps): JSX.Element {
  return (
    <PendingFace
      {...props}
      id="growth"
      silhouette={
        <svg viewBox="0 0 72 48" className="h-10 w-14" fill="none">
          <path d="M12 40 V28 H22 V40 M28 40 V18 H38 V40 M44 40 V10 H54 V40" stroke="currentColor" strokeWidth="1.6" />
          <path d="M50 10 C58 6 62 14 54 16" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      }
    />
  );
}
