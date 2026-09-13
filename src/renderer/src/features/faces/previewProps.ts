import type { FaceProps } from "./types";

export const PREVIEW_PROGRESS = 0.35;
export const PREVIEW_FALLBACK = { width: 168, height: 84 };

export function previewFaceProps(input: {
  estimateMinutes: number;
  width: number;
  height: number;
  now: Date;
}): FaceProps {
  const estimateMinutes =
    Number.isFinite(input.estimateMinutes) && input.estimateMinutes > 0
      ? input.estimateMinutes
      : 50;
  const estimateMs = estimateMinutes * 60_000;
  return {
    progress: PREVIEW_PROGRESS,
    phase: "focus",
    elapsedMs: PREVIEW_PROGRESS * estimateMs,
    remainingMs: (1 - PREVIEW_PROGRESS) * estimateMs,
    estimateMinutes,
    sessionId: "preview",
    events: [],
    killCount: 0,
    now: input.now,
    width: Math.max(1, Math.round(input.width)),
    height: Math.max(1, Math.round(input.height)),
    paused: true,
  };
}
