import * as blazeface from "@tensorflow-models/blazeface";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import { modelJson, weightsBase64 } from "virtual:focusplug/blazeface-weights";
import type { DeskSnapshot } from "@shared/ipc";
import { classifyDesk } from "@main/desk/classify";
import type { FaceSignal, FrameStats, RgbFrame } from "@main/desk/types";

/**
 * Mode 2's Desk AI: the same MediaPipe BlazeFace graph and the same
 * `classifyDesk` rules the Electron app runs, in the judge's browser.
 *
 * What is shared with the app, not re-implemented: the graph + weights
 * (`src/main/desk/models/blazeface`, inlined at build time), the usable-face
 * and covered-lens rules and the at_desk/away/uncertain thresholds
 * (`@main/desk/classify`). What is demo-local: grabbing a frame from a
 * `<video>` instead of a Win32 capture, and the luma statistics — the app's
 * `frameStats` lives in a module that also decodes JPEG/PNG through Node-only
 * libraries, so the six lines of arithmetic are restated here rather than
 * dragging `pngjs` into a browser bundle. The formula is identical.
 *
 * Nothing here touches the network: `tf.setBackend("cpu")`, no WebGL/WASM
 * fetch, and the weights arrive as a base64 literal.
 */

const INFER_MAX_SIDE = 256;

export interface DeskReading {
  snapshot: DeskSnapshot;
  faceCount: number;
  maxProbability: number;
  meanLuma: number;
  backend: string;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** tfjs IOHandler over the build-time-inlined graph — zero requests. */
function bundledHandler(): tf.io.IOHandler {
  return {
    load: async () => {
      const weightSpecs: tf.io.WeightsManifestEntry[] = [];
      for (const group of modelJson.weightsManifest) {
        weightSpecs.push(...(group.weights as tf.io.WeightsManifestEntry[]));
      }
      const bytes = base64ToBytes(weightsBase64);
      const weightData = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(weightData).set(bytes);
      return {
        modelTopology: modelJson.modelTopology,
        format: modelJson.format,
        generatedBy: modelJson.generatedBy,
        convertedBy: modelJson.convertedBy,
        weightSpecs,
        weightData,
      };
    },
  };
}

/** Mean/σ of luma over an RGB frame — mirrors `src/main/desk/frame.ts`. */
export function frameStats(frame: RgbFrame): FrameStats {
  const pixels = frame.width * frame.height;
  if (pixels <= 0) {
    return { width: frame.width, height: frame.height, meanLuma: 0, lumaStd: 0 };
  }
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 3;
    const luma =
      0.299 * (frame.data[o] ?? 0) +
      0.587 * (frame.data[o + 1] ?? 0) +
      0.114 * (frame.data[o + 2] ?? 0);
    sum += luma;
    sumSq += luma * luma;
  }
  const meanLuma = sum / pixels;
  return {
    width: frame.width,
    height: frame.height,
    meanLuma,
    lumaStd: Math.sqrt(Math.max(0, sumSq / pixels - meanLuma * meanLuma)),
  };
}

/** Downscaled RGB copy of the current video frame, or null before metadata. */
export function grabFrame(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): RgbFrame | null {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (vw <= 0 || vh <= 0) {
    return null;
  }
  const scale = Math.min(1, INFER_MAX_SIDE / Math.max(vw, vh));
  const width = Math.max(1, Math.round(vw * scale));
  const height = Math.max(1, Math.round(vh * scale));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    return null;
  }
  ctx.drawImage(video, 0, 0, width, height);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = rgba[i * 4] ?? 0;
    rgb[i * 3 + 1] = rgba[i * 4 + 1] ?? 0;
    rgb[i * 3 + 2] = rgba[i * 4 + 2] ?? 0;
  }
  return { width, height, data: rgb };
}

interface RawFace {
  topLeft: number[];
  bottomRight: number[];
  probability?: number | number[];
  landmarks?: number[][];
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

function toFaceSignal(raw: RawFace): FaceSignal {
  return {
    probability: asProbability(raw.probability),
    box: {
      x0: raw.topLeft[0] ?? 0,
      y0: raw.topLeft[1] ?? 0,
      x1: raw.bottomRight[0] ?? 0,
      y1: raw.bottomRight[1] ?? 0,
    },
    landmarks: (raw.landmarks ?? []).map((pair) => ({ x: pair[0] ?? 0, y: pair[1] ?? 0 })),
  };
}

export class DemoDeskDetector {
  private model: blazeface.BlazeFaceModel | null = null;

  async init(): Promise<void> {
    if (this.model) {
      return;
    }
    await tf.setBackend("cpu");
    await tf.ready();
    this.model = await blazeface.load({
      maxFaces: 5,
      scoreThreshold: 0.5,
      iouThreshold: 0.3,
      modelUrl: bundledHandler(),
    });
  }

  backend(): string {
    return tf.getBackend() || "uninitialized";
  }

  /** One inference over the current video frame, classified the app's way. */
  async read(
    video: HTMLVideoElement,
    canvas: HTMLCanvasElement,
    ts: number,
  ): Promise<DeskReading | null> {
    const model = this.model;
    if (!model) {
      return null;
    }
    const frame = grabFrame(video, canvas);
    if (!frame) {
      return null;
    }
    const stats = frameStats(frame);
    const tensor = tf.tensor3d(Float32Array.from(frame.data), [
      frame.height,
      frame.width,
      3,
    ]);
    let faces: FaceSignal[] = [];
    try {
      const predictions = (await model.estimateFaces(
        tensor,
        false,
        false,
        true,
      )) as unknown as RawFace[];
      faces = predictions.map(toFaceSignal);
    } finally {
      tensor.dispose();
    }
    // The shipped classifier decides — including the covered-lens rule that
    // turns a blacked-out frame into a high-confidence `away`.
    const snapshot = classifyDesk({ ts, webcamEnabled: true, frame: stats, faces });
    return {
      snapshot,
      faceCount: faces.length,
      maxProbability: faces.reduce((max, face) => Math.max(max, face.probability), 0),
      meanLuma: stats.meanLuma,
      backend: this.backend(),
    };
  }

  dispose(): void {
    this.model = null;
  }
}
