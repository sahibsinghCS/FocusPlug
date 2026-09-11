import { existsSync } from "node:fs";
import { join } from "node:path";
import * as blazeface from "@tensorflow-models/blazeface";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import type { DeskFrame } from "@shared/types";
import { deskRoot } from "../assets";
import {
  classifyDesk,
  faceAreaRatio,
  isUsableFace,
  sceneIsOccluded,
} from "../classify";
import { frameStats, resizeMaxSide } from "../frame";
import { filesystemGraphModelHandler } from "../model-io";
import type { DeskDebug, FaceSignal, RgbFrame } from "../types";
import type { DeskModelResult, RunnableDeskModel } from "./types";

/** Weights / graph id — factory id stays `"blazeface"`. */
export const BLAZEFACE_GRAPH_ID = "mediapipe-blazeface";
const INFER_MAX_SIDE = 256;

interface RawBlazeFace {
  topLeft: [number, number] | number[];
  bottomRight: [number, number] | number[];
  probability?: number | number[];
  landmarks?: number[][];
}

function asPair(value: [number, number] | number[]): { x: number; y: number } {
  const x = value[0];
  const y = value[1];
  return { x: typeof x === "number" ? x : 0, y: typeof y === "number" ? y : 0 };
}

function asProbability(value: number | number[] | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  if (Array.isArray(value) && typeof value[0] === "number") {
    return value[0];
  }
  return 0;
}

function toFaceSignal(raw: RawBlazeFace): FaceSignal {
  const topLeft = asPair(raw.topLeft);
  const bottomRight = asPair(raw.bottomRight);
  const landmarks = (raw.landmarks ?? []).map((pair) => ({
    x: pair[0] ?? 0,
    y: pair[1] ?? 0,
  }));
  return {
    probability: asProbability(raw.probability),
    box: { x0: topLeft.x, y0: topLeft.y, x1: bottomRight.x, y1: bottomRight.y },
    landmarks,
  };
}

function asRgbFrame(frame: DeskFrame): RgbFrame {
  if (frame.data instanceof Float32Array) {
    const data = new Uint8Array(frame.data.length);
    for (let i = 0; i < frame.data.length; i += 1) {
      const value = frame.data[i] ?? 0;
      data[i] = value <= 1 ? Math.round(value * 255) : Math.max(0, Math.min(255, Math.round(value)));
    }
    return { width: frame.width, height: frame.height, data };
  }
  return { width: frame.width, height: frame.height, data: frame.data };
}

function debugStub(reason: string, backend: string, extras?: Partial<DeskDebug>): DeskDebug {
  return {
    reason,
    faceCount: 0,
    usableFaceCount: 0,
    maxProbability: 0,
    meanLuma: 0,
    lumaStd: 0,
    largestFaceAreaRatio: 0,
    backend,
    model: BLAZEFACE_GRAPH_ID,
    ...extras,
  };
}

/**
 * Low-level MediaPipe BlazeFace engine. Only the DeskModel adapter should
 * construct this — analyze / monitor talk to `BlazeFaceDeskModel.infer`.
 */
export class BlazeFaceDetector {
  private model: blazeface.BlazeFaceModel | null = null;
  private initPromise: Promise<void> | null = null;

  backend(): string {
    return tf.getBackend() || "uninitialized";
  }

  async init(): Promise<void> {
    if (this.model) {
      return;
    }
    if (!this.initPromise) {
      this.initPromise = this.loadModel();
    }
    await this.initPromise;
  }

  private async loadModel(): Promise<void> {
    await tf.setBackend("cpu");
    await tf.ready();
    const localDir = join(deskRoot(), "models", "blazeface");
    const localJson = join(localDir, "model.json");
    const options = {
      maxFaces: 5,
      scoreThreshold: 0.5,
      iouThreshold: 0.3,
    };
    if (existsSync(localJson)) {
      this.model = await blazeface.load({
        ...options,
        modelUrl: filesystemGraphModelHandler(localDir),
      });
      return;
    }
    this.model = await blazeface.load(options);
  }

  async detect(frame: RgbFrame): Promise<FaceSignal[]> {
    await this.init();
    if (!this.model) {
      throw new Error("BlazeFace model failed to load");
    }
    const prepared = resizeMaxSide(frame, INFER_MAX_SIDE);
    const scaleX = frame.width / prepared.width;
    const scaleY = frame.height / prepared.height;
    const rgb = Float32Array.from(prepared.data);
    const tensor = tf.tensor3d(rgb, [prepared.height, prepared.width, 3]);
    try {
      const predictions = (await this.model.estimateFaces(
        tensor,
        false,
        false,
        true,
      )) as unknown as RawBlazeFace[];
      return predictions.map((raw) => {
        const face = toFaceSignal(raw);
        return {
          probability: face.probability,
          box: {
            x0: face.box.x0 * scaleX,
            y0: face.box.y0 * scaleY,
            x1: face.box.x1 * scaleX,
            y1: face.box.y1 * scaleY,
          },
          landmarks: face.landmarks.map((pt) => ({
            x: pt.x * scaleX,
            y: pt.y * scaleY,
          })),
        };
      });
    } finally {
      tensor.dispose();
    }
  }
}

let sharedDetector: BlazeFaceDetector | null = null;

export async function getSharedDetector(): Promise<BlazeFaceDetector> {
  if (!sharedDetector) {
    sharedDetector = new BlazeFaceDetector();
    await sharedDetector.init();
  }
  return sharedDetector;
}

/**
 * DeskModel wrapper around the existing BlazeFace detector + classifier.
 * Do not import `@tensorflow-models/blazeface` outside this file.
 */
export class BlazeFaceDeskModel implements RunnableDeskModel {
  readonly id = "blazeface";
  private detector: BlazeFaceDetector | null;

  constructor(detector?: BlazeFaceDetector) {
    this.detector = detector ?? null;
  }

  backend(): string {
    return this.detector?.backend() ?? "uninitialized";
  }

  async init(): Promise<void> {
    if (!this.detector) {
      this.detector = await getSharedDetector();
      return;
    }
    await this.detector.init();
  }

  async infer(frame: DeskFrame): Promise<DeskModelResult> {
    await this.init();
    const detector = this.detector;
    if (!detector) {
      throw new Error("BlazeFace detector is not ready");
    }
    const backend = detector.backend();
    const rgb = asRgbFrame(frame);

    try {
      const stats = frameStats(rgb);
      const faces = await detector.detect(rgb);
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
      const occluded = sceneIsOccluded(stats);
      const snapshot = classifyDesk({
        ts: 0,
        webcamEnabled: true,
        frame: stats,
        faces,
      });
      return {
        label: snapshot.label,
        confidence: snapshot.confidence,
        faces: faces.map((face) => ({ probability: face.probability, box: face.box })),
        debug: {
          reason: occluded ? "occluded-frame" : "inference",
          faceCount: faces.length,
          usableFaceCount: usable.length,
          maxProbability,
          meanLuma: stats.meanLuma,
          lumaStd: stats.lumaStd,
          largestFaceAreaRatio: largest ? faceAreaRatio(largest, stats) : 0,
          backend,
          model: BLAZEFACE_GRAPH_ID,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "detect-failed";
      const snapshot = classifyDesk({
        ts: 0,
        webcamEnabled: true,
        frame: null,
        faces: [],
      });
      return {
        label: snapshot.label,
        confidence: snapshot.confidence,
        debug: debugStub("detect-error", backend, { reason: `detect-error:${message}` }),
      };
    }
  }
}
