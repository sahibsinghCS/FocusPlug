import type { DeskSnapshot } from "@shared/types";
import type { ClassifyInput, FaceSignal, FrameStats } from "./types";

/** Matches default `deskThreshold` in shared settings. */
export const AT_DESK_MIN_PROB = 0.6;
export const UNCERTAIN_MIN_PROB = 0.5;
export const MIN_FACE_AREA_RATIO = 0.008;

export function clamp01(value: number): number {
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

export function faceAreaRatio(face: FaceSignal, frame: FrameStats): number {
  const width = Math.max(0, face.box.x1 - face.box.x0);
  const height = Math.max(0, face.box.y1 - face.box.y0);
  const frameArea = Math.max(1, frame.width * frame.height);
  return (width * height) / frameArea;
}

export function landmarksPlausible(face: FaceSignal): boolean {
  if (face.landmarks.length < 4) {
    return true;
  }
  const rightEye = face.landmarks[0];
  const leftEye = face.landmarks[1];
  const mouth = face.landmarks[3];
  if (!rightEye || !leftEye || !mouth) {
    return true;
  }
  const eyeY = (rightEye.y + leftEye.y) / 2;
  if (mouth.y <= eyeY) {
    return false;
  }
  const eyeDist = Math.hypot(leftEye.x - rightEye.x, leftEye.y - rightEye.y);
  if (eyeDist < 8) {
    return false;
  }
  return true;
}

export function isUsableFace(face: FaceSignal, frame: FrameStats): boolean {
  if (!Number.isFinite(face.probability) || face.probability < UNCERTAIN_MIN_PROB) {
    return false;
  }
  if (face.box.x1 <= face.box.x0 || face.box.y1 <= face.box.y0) {
    return false;
  }
  const boxW = face.box.x1 - face.box.x0;
  const boxH = face.box.y1 - face.box.y0;
  const aspect = boxW / boxH;
  if (aspect < 0.35 || aspect > 2.2) {
    return false;
  }
  if (faceAreaRatio(face, frame) < MIN_FACE_AREA_RATIO) {
    return false;
  }
  return landmarksPlausible(face);
}

export function awayConfidence(maxRejectedProb: number): number {
  return clamp01(0.92 - 0.25 * maxRejectedProb);
}

export function classifyDesk(input: ClassifyInput): DeskSnapshot {
  if (!input.webcamEnabled) {
    return {
      ts: input.ts,
      label: "uncertain",
      confidence: 0,
      webcamEnabled: false,
    };
  }

  if (!input.frame) {
    return {
      ts: input.ts,
      label: "uncertain",
      confidence: 0.15,
      webcamEnabled: true,
    };
  }

  const ranked = [...input.faces]
    .filter((face) => Number.isFinite(face.probability))
    .sort((a, b) => b.probability - a.probability);
  const usable = ranked.filter((face) => isUsableFace(face, input.frame!));
  const best = usable[0];

  if (best && best.probability >= AT_DESK_MIN_PROB) {
    return {
      ts: input.ts,
      label: "at_desk",
      confidence: clamp01(best.probability),
      webcamEnabled: true,
    };
  }

  if (best && best.probability >= UNCERTAIN_MIN_PROB) {
    return {
      ts: input.ts,
      label: "uncertain",
      confidence: clamp01(best.probability),
      webcamEnabled: true,
    };
  }

  return {
    ts: input.ts,
    label: "away",
    confidence: awayConfidence(ranked[0]?.probability ?? 0),
    webcamEnabled: true,
  };
}
