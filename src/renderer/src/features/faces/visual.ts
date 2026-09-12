import type { FacePhase } from "@shared/faces";
import type { FaceEvent, FaceProps } from "./types";

export const VISUAL_FACE_IDS = ["descent", "orbit", "circuit"] as const;
export type VisualFaceId = (typeof VISUAL_FACE_IDS)[number];

export type VisualPhase = "idle" | "focus" | "fuse" | "kill" | "complete";

/** Internal paint props for Descent / Orbit / Circuit. Host still sends FaceProps. */
export interface VisualFaceProps {
  progress: number;
  phase: VisualPhase;
  events: FaceEvent[];
  killCount: number;
  now: number;
  size: number | { width: number; height: number };
}

export function isVisualFaceId(value: unknown): value is VisualFaceId {
  return typeof value === "string" && (VISUAL_FACE_IDS as readonly string[]).includes(value);
}

export function isVisualPhase(value: unknown): value is VisualPhase {
  return (
    value === "idle" ||
    value === "focus" ||
    value === "fuse" ||
    value === "kill" ||
    value === "complete"
  );
}

export function visualPhaseFromFace(phase: FacePhase, progress: number): VisualPhase {
  if (phase === "idle") {
    return "idle";
  }
  if (Number.isFinite(progress) && progress >= 0.995) {
    return "complete";
  }
  if (phase === "break") {
    return "fuse";
  }
  return "focus";
}

export function toVisualFaceProps(props: FaceProps): VisualFaceProps {
  return {
    progress: props.progress,
    phase: visualPhaseFromFace(props.phase, props.progress),
    events: props.events,
    killCount: props.killCount,
    now: props.now.getTime(),
    size: { width: props.width, height: props.height },
  };
}
