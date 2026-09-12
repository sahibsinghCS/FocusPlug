import type { JSX } from "react";
import type { FacePhase } from "@shared/faces";

export interface FaceEvent {
  ts: number;
  kind: string;
  detail?: string;
  severity?: number;
}

export interface FaceProps {
  progress: number;
  phase: FacePhase;
  elapsedMs: number;
  remainingMs: number;
  estimateMinutes?: number;
  sessionId: string;
  events: FaceEvent[];
  killCount: number;
  now: Date;
  width: number;
  height: number;
  /** Stop RAF / instrument motion. Previews pass this so thirteen faces do not animate at once. */
  paused?: boolean;
}

export type FaceComponent = (props: FaceProps) => JSX.Element;
