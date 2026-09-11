import { classifyDesk, faceAreaRatio, isUsableFace } from "./classify";
import { DESK_MODEL_ID } from "./detector";
import { frameStats } from "./frame";
import type { BlazeFaceDetector } from "./detector";
import type { DeskAnalysis, DeskDebug, RgbFrame } from "./types";

function debugStub(
  reason: string,
  backend: string,
  extras?: Partial<DeskDebug>,
): DeskDebug {
  return {
    reason,
    faceCount: 0,
    usableFaceCount: 0,
    maxProbability: 0,
    meanLuma: 0,
    lumaStd: 0,
    largestFaceAreaRatio: 0,
    backend,
    model: DESK_MODEL_ID,
    ...extras,
  };
}

export async function analyzeDeskFrame(options: {
  frame: RgbFrame | null;
  detector: BlazeFaceDetector;
  ts: number;
  webcamEnabled: boolean;
}): Promise<DeskAnalysis> {
  const backend = options.detector.backend();

  if (!options.webcamEnabled) {
    return {
      snapshot: classifyDesk({
        ts: options.ts,
        webcamEnabled: false,
        frame: null,
        faces: [],
      }),
      debug: debugStub("webcam-disabled", backend),
    };
  }

  if (!options.frame) {
    return {
      snapshot: classifyDesk({
        ts: options.ts,
        webcamEnabled: true,
        frame: null,
        faces: [],
      }),
      debug: debugStub("no-frame", backend),
    };
  }

  try {
    const stats = frameStats(options.frame);
    const faces = await options.detector.detect(options.frame);
    const usable = faces.filter((face) => isUsableFace(face, stats));
    const maxProbability = faces.reduce(
      (max, face) => Math.max(max, face.probability),
      0,
    );
    const largest = faces[0]
      ? faces.reduce((best, face) =>
          faceAreaRatio(face, stats) > faceAreaRatio(best, stats) ? face : best,
        )
      : undefined;
    return {
      snapshot: classifyDesk({
        ts: options.ts,
        webcamEnabled: true,
        frame: stats,
        faces,
      }),
      debug: {
        reason: "inference",
        faceCount: faces.length,
        usableFaceCount: usable.length,
        maxProbability,
        meanLuma: stats.meanLuma,
        lumaStd: stats.lumaStd,
        largestFaceAreaRatio: largest ? faceAreaRatio(largest, stats) : 0,
        backend,
        model: DESK_MODEL_ID,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "detect-failed";
    return {
      snapshot: classifyDesk({
        ts: options.ts,
        webcamEnabled: true,
        frame: null,
        faces: [],
      }),
      debug: debugStub("detect-error", backend, { reason: `detect-error:${message}` }),
    };
  }
}
