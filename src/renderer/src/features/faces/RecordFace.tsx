import type { JSX } from "react";
import { PendingFace } from "./PendingFace";
import type { FaceProps } from "./types";

/** Owned by agent/faces-record. Foundation ships the empty slot only. */
export function RecordFace(props: FaceProps): JSX.Element {
  return (
    <PendingFace
      {...props}
      id="record"
      silhouette={
        <svg viewBox="0 0 64 64" className="h-12 w-12" fill="none">
          <circle cx="32" cy="32" r="22" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="32" cy="32" r="14" stroke="currentColor" strokeWidth="1" opacity="0.45" />
          <circle cx="32" cy="32" r="3" fill="currentColor" />
        </svg>
      }
    />
  );
}
