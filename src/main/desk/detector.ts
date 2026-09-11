import { existsSync } from "node:fs";
import { join } from "node:path";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import * as blazeface from "@tensorflow-models/blazeface";
import { deskRoot } from "./assets";
import { resizeMaxSide } from "./frame";
import { filesystemGraphModelHandler } from "./model-io";
import type { FaceSignal, RgbFrame } from "./types";

export const DESK_MODEL_ID = "mediapipe-blazeface";
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

let shared: BlazeFaceDetector | null = null;

export async function getSharedDetector(): Promise<BlazeFaceDetector> {
  if (!shared) {
    shared = new BlazeFaceDetector();
    await shared.init();
  }
  return shared;
}
