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
  /**
   * Whole-sit 0..1. Flight km / ETA / GS read this (and the session* clock
   * below) so each lock round is not its own hop. Other faces ignore these.
   */
  sessionProgress?: number;
  sessionElapsedMs?: number;
  sessionRemainingMs?: number;
  sessionEstimateMinutes?: number;
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
