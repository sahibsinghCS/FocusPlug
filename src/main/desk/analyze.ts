import type { DeskFrame, DeskModel, DeskModelOutput } from "@shared/types";
import type { DeskModelResult, RunnableDeskModel } from "./model/types";
import type { DeskAnalysis, DeskDebug, RgbFrame } from "./types";

function isDeskModelResult(value: DeskModelOutput): value is DeskModelResult {
  return "debug" in value && typeof value.debug === "object" && value.debug !== null;
}

function modelBackend(model: DeskModel): string {
  const candidate = model as RunnableDeskModel;
  if (typeof candidate.backend === "function") {
    return candidate.backend();
  }
  return "n/a";
}

function baseDebug(model: DeskModel, reason: string): DeskDebug {
  return {
    reason,
    faceCount: 0,
    usableFaceCount: 0,
    maxProbability: 0,
    meanLuma: 0,
    lumaStd: 0,
    largestFaceAreaRatio: 0,
    backend: modelBackend(model),
    model: model.id,
  };
}

function asDeskFrame(frame: RgbFrame | DeskFrame): DeskFrame {
  return frame;
}

/**
 * Single analyze path: call `DeskModel.infer(frame)` only.
 * Webcam-off / missing frame never reach infer — the frozen contract
 * requires a `DeskFrame`, and uncertain is safe (no desk-only kill).
 */
export async function analyzeDeskFrame(options: {
  frame: RgbFrame | DeskFrame | null;
  model: DeskModel;
  ts: number;
  webcamEnabled: boolean;
}): Promise<DeskAnalysis> {
  if (!options.webcamEnabled) {
    return {
      snapshot: {
        ts: options.ts,
        label: "uncertain",
        confidence: 0,
        webcamEnabled: false,
      },
      debug: baseDebug(options.model, "webcam-disabled"),
    };
  }

  if (!options.frame) {
    return {
      snapshot: {
        ts: options.ts,
        label: "uncertain",
        confidence: 0,
        webcamEnabled: true,
      },
      debug: baseDebug(options.model, "no-frame"),
    };
  }

  try {
    const inference = await options.model.infer(asDeskFrame(options.frame));
    const faces = inference.faces ?? [];
    const maxProbability = faces.reduce(
      (max, face) => Math.max(max, face.probability),
      0,
    );
    const debug = {
      ...baseDebug(options.model, "inference"),
      faceCount: faces.length,
      maxProbability,
      ...(isDeskModelResult(inference) ? inference.debug : {}),
    };
    return {
      snapshot: {
        ts: options.ts,
        label: inference.label,
        confidence: inference.confidence,
        webcamEnabled: true,
        // Contract: attention is only reported alongside at_desk.
        ...(inference.label === "at_desk" && inference.attention
          ? { attention: { ...inference.attention } }
          : {}),
      },
      debug,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "infer-failed";
    return {
      snapshot: {
        ts: options.ts,
        label: "uncertain",
        confidence: 0,
        webcamEnabled: true,
      },
      debug: baseDebug(options.model, `infer-error:${message}`),
    };
  }
}
