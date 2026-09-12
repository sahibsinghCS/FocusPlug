import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as tf from "@tensorflow/tfjs-core";
import "@tensorflow/tfjs-backend-cpu";
import { loadGraphModel, type GraphModel } from "@tensorflow/tfjs-converter";
import type { DeskFrame, DeskModel, DeskModelOutput } from "@shared/types";
import { deskRoot } from "../assets";
import { frameStats, resizeNearest } from "../frame";
import { filesystemGraphModelHandler } from "../model-io";
import type { RgbFrame } from "../types";
import { BlazeFaceDeskModel } from "./blazeface-adapter";
import type { DeskModelResult } from "./types";

/**
 * Custom desk-presence model (`deskModelId: "custom"`).
 *
 * A stacked model: the frozen on-device BlazeFace detector (reused through
 * the exported adapter — no second copy of the weights, no direct blazeface
 * import) is run over the full frame plus three sub-crops so small and
 * off-center faces still fire; this file adds global scene features (luma
 * grid, color grid, gradient-orientation histograms, blur/noise/skin cues);
 * and a small MLP head trained on the FocusPlug desk-data pack (releases
 * `desk-data-v2-*`) maps everything to at_desk / away / uncertain.
 *
 * The head is trained by `scripts/desk-model/train.ts` and shipped as JSON in
 * `model/weights/desk-head.json`. Inference is plain arithmetic — on-device,
 * deterministic, no cloud calls. If the weights file is missing the model
 * degrades to `uncertain` with confidence 0, which the policy treats as safe
 * (no desk-only kill on a maybe).
 */

/** Committed head weights, relative to `deskRoot()`. */
export const DESK_HEAD_RELATIVE_PATH = join("model", "weights", "desk-head.json");

/** Bump when the feature layout changes — invalidates cached training features. */
export const DESK_FEATURE_VERSION = 4;

/**
 * MobileNetV2 (alpha 0.50, 160px) ImageNet feature-vector backbone —
 * committed under `model/weights/mobilenet/` (Apache-2.0, TF Hub graph
 * model), loaded from disk. General scene/person semantics that the
 * face-tuned BlazeFace backbone cannot provide.
 */
const MOBILENET_DIR = join("model", "weights", "mobilenet");
const MOBILENET_INPUT_SIDE = 160;

/**
 * Backbone taps inside the local BlazeFace graph — the pretrained conv
 * features double as a general scene/person embedding (transfer learning
 * from the weights already shipped with the app).
 */
const EMBED_INPUT_SIDE = 128;
const EMBED_MID_NODE = "StatefulPartitionedCall/model/activation_11/Relu";
const EMBED_LATE_NODE = "StatefulPartitionedCall/model/activation_16/Relu";

/** Output order of the head's softmax. Index = class id used in training. */
export const DESK_HEAD_LABELS = ["at_desk", "away", "uncertain"] as const;

const THUMB_SIDE = 64;
const GRID_SIDE = 8;
const COLOR_GRID_SIDE = 4;
const HIST_BINS = 8;
const HOG_BINS = 8;
const QUADRANT_HOG_BINS = 4;
const MAX_FACES = 5;

/** Sub-crops (fractions of the frame) where stock/webcam subjects sit. */
const FACE_CROPS: ReadonlyArray<{ x: number; y: number; w: number; h: number }> = [
  { x: 0.2, y: 0.15, w: 0.6, h: 0.6 },
  { x: 0.0, y: 0.15, w: 0.55, h: 0.7 },
  { x: 0.45, y: 0.15, w: 0.55, h: 0.7 },
];

export interface DeskHeadLayer {
  /** Row-major [out][in]. */
  w: number[][];
  b: number[];
}

export interface DeskHeadWeights {
  version: number;
  featureDim: number;
  labels: string[];
  /**
   * Optional sub-ranges of the raw feature vector the head was trained on
   * (concatenated in order). Absent = the full vector. `featureDim` is the
   * length AFTER slicing.
   */
  inputSlices?: Array<[number, number]>;
  /** Feature standardization baked in at train time. */
  mean: number[];
  std: number[];
  /**
   * Optional per-class k-means codebook (learned from the training set,
   * in standardized feature space). Min-distance + soft-assignment per
   * class are appended to the MLP input as retrieval features.
   */
  codebook?: number[][][];
  /** ReLU between layers, softmax after the last. */
  layers: DeskHeadLayer[];
}

/** Retrieval features from a codebook: per-class min RMS distance + softmin. */
export function codebookFeatures(codebook: number[][][], x: number[]): number[] {
  const dists: number[] = [];
  for (const centroids of codebook) {
    let best = Number.POSITIVE_INFINITY;
    for (const centroid of centroids) {
      let sum = 0;
      for (let i = 0; i < x.length; i += 1) {
        const diff = (x[i] ?? 0) - (centroid[i] ?? 0);
        sum += diff * diff;
      }
      best = Math.min(best, sum);
    }
    dists.push(Math.sqrt(best / Math.max(1, x.length)));
  }
  const soft = dists.map((d) => Math.exp(-4 * d));
  const total = soft.reduce((sum, value) => sum + value, 0) || 1;
  return [...dists, ...soft.map((value) => value / total)];
}

export interface DeskFeatureExtraction {
  vector: number[];
  base: DeskModelResult;
}

function toRgbFrame(frame: DeskFrame): RgbFrame {
  if (frame.data instanceof Float32Array) {
    const data = new Uint8Array(frame.data.length);
    for (let i = 0; i < frame.data.length; i += 1) {
      const value = frame.data[i] ?? 0;
      data[i] =
        value <= 1
          ? Math.round(Math.max(0, value) * 255)
          : Math.max(0, Math.min(255, Math.round(value)));
    }
    return { width: frame.width, height: frame.height, data };
  }
  return { width: frame.width, height: frame.height, data: frame.data };
}

function cropFrame(
  frame: RgbFrame,
  fx: number,
  fy: number,
  fw: number,
  fh: number,
): RgbFrame {
  const x0 = Math.max(0, Math.floor(frame.width * fx));
  const y0 = Math.max(0, Math.floor(frame.height * fy));
  const width = Math.max(1, Math.min(frame.width - x0, Math.round(frame.width * fw)));
  const height = Math.max(1, Math.min(frame.height - y0, Math.round(frame.height * fh)));
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const src = ((y0 + y) * frame.width + x0) * 3;
    data.set(frame.data.subarray(src, src + width * 3), y * width * 3);
  }
  return { width, height, data };
}

/**
 * Global scene descriptor, independent of face detection. All values are
 * roughly in [0, 1] before standardization:
 * 8x8 luma grid · luma mean/std · 8-bin histogram · edge energy ·
 * saturation mean/std · 4x4 RGB color grid · gradient-orientation
 * histograms (global + quadrants) · blur (Laplacian) · highlight/shadow ·
 * skin-tone fraction.
 */
export function sceneFeatures(frame: RgbFrame): number[] {
  const features: number[] = [];
  const thumb = resizeNearest(frame, THUMB_SIDE, THUMB_SIDE);
  const pixels = THUMB_SIDE * THUMB_SIDE;
  const luma = new Float64Array(pixels);
  let satSum = 0;
  let satSq = 0;
  let skin = 0;
  let highlight = 0;
  let shadow = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 3;
    const r = thumb.data[o] ?? 0;
    const g = thumb.data[o + 1] ?? 0;
    const b = thumb.data[o + 2] ?? 0;
    const value = 0.299 * r + 0.587 * g + 0.114 * b;
    luma[i] = value;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    const sat = mx - mn;
    satSum += sat;
    satSq += sat * sat;
    if (value > 230) {
      highlight += 1;
    }
    if (value < 25) {
      shadow += 1;
    }
    if (r > 95 && g > 40 && b > 20 && r > g && r > b && mx - mn > 15) {
      skin += 1;
    }
  }

  // Luma grid: GRID_SIDE^2 block means.
  const block = THUMB_SIDE / GRID_SIDE;
  for (let gy = 0; gy < GRID_SIDE; gy += 1) {
    for (let gx = 0; gx < GRID_SIDE; gx += 1) {
      let sum = 0;
      for (let y = 0; y < block; y += 1) {
        for (let x = 0; x < block; x += 1) {
          sum += luma[(gy * block + y) * THUMB_SIDE + (gx * block + x)] ?? 0;
        }
      }
      features.push(sum / (block * block) / 255);
    }
  }

  const stats = frameStats(frame);
  features.push(stats.meanLuma / 255);
  features.push(Math.min(1, stats.lumaStd / 128));

  const hist = new Array<number>(HIST_BINS).fill(0);
  for (let i = 0; i < pixels; i += 1) {
    const bin = Math.min(HIST_BINS - 1, Math.floor(((luma[i] ?? 0) / 256) * HIST_BINS));
    hist[bin] = (hist[bin] ?? 0) + 1;
  }
  for (const count of hist) {
    features.push(count / pixels);
  }

  // Gradients on the luma thumbnail: edge energy, global + quadrant
  // orientation histograms (HOG-lite), Laplacian blur measure.
  let edgeSum = 0;
  let lapSum = 0;
  let lapSq = 0;
  const hog = new Array<number>(HOG_BINS).fill(0);
  const quadHog = new Array<number>(4 * QUADRANT_HOG_BINS).fill(0);
  let magTotal = 0;
  const quadMag = new Array<number>(4).fill(0);
  for (let y = 1; y < THUMB_SIDE - 1; y += 1) {
    for (let x = 1; x < THUMB_SIDE - 1; x += 1) {
      const center = luma[y * THUMB_SIDE + x] ?? 0;
      const dx = (luma[y * THUMB_SIDE + x + 1] ?? 0) - (luma[y * THUMB_SIDE + x - 1] ?? 0);
      const dy = (luma[(y + 1) * THUMB_SIDE + x] ?? 0) - (luma[(y - 1) * THUMB_SIDE + x] ?? 0);
      const mag = Math.hypot(dx, dy);
      edgeSum += mag;
      const lap =
        (luma[y * THUMB_SIDE + x + 1] ?? 0) +
        (luma[y * THUMB_SIDE + x - 1] ?? 0) +
        (luma[(y + 1) * THUMB_SIDE + x] ?? 0) +
        (luma[(y - 1) * THUMB_SIDE + x] ?? 0) -
        4 * center;
      lapSum += lap;
      lapSq += lap * lap;
      if (mag > 1e-6) {
        // Fold orientation to [0, PI).
        let angle = Math.atan2(dy, dx);
        if (angle < 0) {
          angle += Math.PI;
        }
        if (angle >= Math.PI) {
          angle -= Math.PI;
        }
        const bin = Math.min(HOG_BINS - 1, Math.floor((angle / Math.PI) * HOG_BINS));
        hog[bin] = (hog[bin] ?? 0) + mag;
        magTotal += mag;
        const quadrant = (y < THUMB_SIDE / 2 ? 0 : 2) + (x < THUMB_SIDE / 2 ? 0 : 1);
        const qBin = Math.min(
          QUADRANT_HOG_BINS - 1,
          Math.floor((angle / Math.PI) * QUADRANT_HOG_BINS),
        );
        quadHog[quadrant * QUADRANT_HOG_BINS + qBin] =
          (quadHog[quadrant * QUADRANT_HOG_BINS + qBin] ?? 0) + mag;
        quadMag[quadrant] = (quadMag[quadrant] ?? 0) + mag;
      }
    }
  }
  const inner = (THUMB_SIDE - 2) * (THUMB_SIDE - 2);
  features.push(edgeSum / inner / 255);
  for (const value of hog) {
    features.push(magTotal > 0 ? value / magTotal : 0);
  }
  for (let q = 0; q < 4; q += 1) {
    for (let b = 0; b < QUADRANT_HOG_BINS; b += 1) {
      const mag = quadMag[q] ?? 0;
      features.push(mag > 0 ? (quadHog[q * QUADRANT_HOG_BINS + b] ?? 0) / mag : 0);
    }
  }
  const lapMean = lapSum / inner;
  features.push(Math.min(1, Math.sqrt(Math.max(0, lapSq / inner - lapMean * lapMean)) / 64));

  features.push(satSum / pixels / 255);
  const satMean = satSum / pixels;
  features.push(Math.min(1, Math.sqrt(Math.max(0, satSq / pixels - satMean * satMean)) / 128));
  features.push(highlight / pixels);
  features.push(shadow / pixels);
  features.push(skin / pixels);

  // Color grid: COLOR_GRID_SIDE^2 mean-RGB cells.
  const colorBlock = THUMB_SIDE / COLOR_GRID_SIDE;
  for (let gy = 0; gy < COLOR_GRID_SIDE; gy += 1) {
    for (let gx = 0; gx < COLOR_GRID_SIDE; gx += 1) {
      let rSum = 0;
      let gSum = 0;
      let bSum = 0;
      for (let y = 0; y < colorBlock; y += 1) {
        for (let x = 0; x < colorBlock; x += 1) {
          const o = ((gy * colorBlock + y) * THUMB_SIDE + (gx * colorBlock + x)) * 3;
          rSum += thumb.data[o] ?? 0;
          gSum += thumb.data[o + 1] ?? 0;
          bSum += thumb.data[o + 2] ?? 0;
        }
      }
      const cell = colorBlock * colorBlock;
      features.push(rSum / cell / 255);
      features.push(gSum / cell / 255);
      features.push(bSum / cell / 255);
    }
  }

  return features;
}

function faceFeatures(base: DeskModelResult, frame: RgbFrame): number[] {
  const faces = [...(base.faces ?? [])].sort((a, b) => b.probability - a.probability);
  const frameArea = Math.max(1, frame.width * frame.height);
  const features: number[] = [];
  features.push(Math.min(MAX_FACES, faces.length) / MAX_FACES);
  features.push(faces[0]?.probability ?? 0);
  features.push(faces[1]?.probability ?? 0);
  const probSum = faces.reduce((sum, face) => sum + face.probability, 0);
  features.push(Math.min(1, probSum / MAX_FACES));

  let largest = faces[0] ?? null;
  let largestArea = -1;
  for (const face of faces) {
    const area =
      Math.max(0, face.box.x1 - face.box.x0) * Math.max(0, face.box.y1 - face.box.y0);
    if (area > largestArea) {
      largest = face;
      largestArea = area;
    }
  }
  if (largest) {
    const w = Math.max(0, largest.box.x1 - largest.box.x0);
    const h = Math.max(0, largest.box.y1 - largest.box.y0);
    features.push(Math.min(1, (w * h) / frameArea));
    features.push(
      Math.min(1, Math.max(0, (largest.box.x0 + largest.box.x1) / 2 / Math.max(1, frame.width))),
    );
    features.push(
      Math.min(1, Math.max(0, (largest.box.y0 + largest.box.y1) / 2 / Math.max(1, frame.height))),
    );
    features.push(Math.min(1, w / Math.max(1, frame.width)));
    features.push(Math.min(1, h / Math.max(1, frame.height)));
    features.push(h > 0 ? Math.min(3, w / h) / 3 : 0);
  } else {
    features.push(0, 0, 0, 0, 0, 0);
  }

  // The heuristic base model's own opinion — classic stacking inputs.
  features.push(base.label === "at_desk" ? 1 : 0);
  features.push(base.label === "away" ? 1 : 0);
  features.push(base.label === "uncertain" ? 1 : 0);
  features.push(Math.min(1, Math.max(0, base.confidence)));
  features.push(Math.min(MAX_FACES, base.debug?.usableFaceCount ?? 0) / MAX_FACES);

  return features;
}

function cropFaceSummary(result: DeskModelResult, crop: RgbFrame): number[] {
  const faces = result.faces ?? [];
  let maxProb = 0;
  let largestRatio = 0;
  const cropArea = Math.max(1, crop.width * crop.height);
  for (const face of faces) {
    maxProb = Math.max(maxProb, face.probability);
    const area =
      Math.max(0, face.box.x1 - face.box.x0) * Math.max(0, face.box.y1 - face.box.y0);
    largestRatio = Math.max(largestRatio, Math.min(1, area / cropArea));
  }
  return [maxProb, largestRatio, Math.min(MAX_FACES, faces.length) / MAX_FACES];
}

let sharedBase: BlazeFaceDeskModel | null = null;

async function baseInfer(frame: DeskFrame): Promise<DeskModelResult> {
  if (!sharedBase) {
    sharedBase = new BlazeFaceDeskModel();
    await sharedBase.init();
  }
  return sharedBase.infer(frame);
}

let embedModel: GraphModel | null = null;
let embedModelPromise: Promise<GraphModel> | null = null;

async function getEmbedModel(): Promise<GraphModel> {
  if (embedModel) {
    return embedModel;
  }
  if (!embedModelPromise) {
    embedModelPromise = (async () => {
      await tf.setBackend("cpu");
      await tf.ready();
      const dir = join(deskRoot(), "models", "blazeface");
      embedModel = await loadGraphModel(filesystemGraphModelHandler(dir));
      return embedModel;
    })().catch((error: unknown) => {
      // Don't cache a rejected load — let the next attempt retry.
      embedModelPromise = null;
      throw error;
    });
  }
  return embedModelPromise;
}

let sceneModel: GraphModel | null = null;
let sceneModelPromise: Promise<GraphModel> | null = null;

async function getSceneModel(): Promise<GraphModel> {
  if (sceneModel) {
    return sceneModel;
  }
  if (!sceneModelPromise) {
    sceneModelPromise = (async () => {
      await tf.setBackend("cpu");
      await tf.ready();
      const dir = join(deskRoot(), MOBILENET_DIR);
      sceneModel = await loadGraphModel(filesystemGraphModelHandler(dir));
      return sceneModel;
    })().catch((error: unknown) => {
      // Don't cache a rejected load — let the next attempt retry.
      sceneModelPromise = null;
      throw error;
    });
  }
  return sceneModelPromise;
}

/** 1280-d ImageNet feature vector (MobileNetV2 expects [0, 1] input). */
async function sceneEmbedding(rgb: RgbFrame): Promise<number[]> {
  const model = await getSceneModel();
  const data = tf.tidy(() => {
    const flat = Float32Array.from(rgb.data);
    const image = tf.tensor3d(flat, [rgb.height, rgb.width, 3]);
    const resized = tf.image.resizeBilinear(image, [
      MOBILENET_INPUT_SIDE,
      MOBILENET_INPUT_SIDE,
    ]);
    const normalized = tf.div(resized, 255);
    const batched = tf.expandDims(normalized, 0);
    const features = model.execute({ images: batched }) as tf.Tensor;
    return features.dataSync();
  });
  return Array.from(data);
}

/**
 * Deep scene embedding from the local BlazeFace backbone: mid (16x16x88) and
 * late (8x8x96) activation maps, pooled globally plus late 2x2 regions so
 * the head sees where person-like activations sit in the frame.
 */
async function deepEmbedding(rgb: RgbFrame): Promise<number[]> {
  const model = await getEmbedModel();
  const outputs = tf.tidy(() => {
    const flat = Float32Array.from(rgb.data);
    const image = tf.tensor3d(flat, [rgb.height, rgb.width, 3]);
    const resized = tf.image.resizeBilinear(image, [EMBED_INPUT_SIDE, EMBED_INPUT_SIDE]);
    const normalized = tf.sub(tf.div(resized, 127.5), 1);
    const batched = tf.expandDims(normalized, 0);
    const [mid, late] = model.execute({ input: batched }, [
      EMBED_MID_NODE,
      EMBED_LATE_NODE,
    ]) as [tf.Tensor4D, tf.Tensor4D];
    const midGlobal = tf.mean(mid, [1, 2]);
    const lateGlobal = tf.mean(late, [1, 2]);
    const lateRegions = tf.avgPool(late, [4, 4], [4, 4], "valid");
    return [
      midGlobal.dataSync(),
      lateGlobal.dataSync(),
      lateRegions.dataSync(),
    ];
  });
  const vector: number[] = [];
  for (const chunk of outputs) {
    for (const value of chunk) {
      vector.push(value);
    }
  }
  return vector;
}

/**
 * The exact feature pipeline used at runtime, exported so the training and
 * eval scripts (`scripts/desk-model/`) consume the same code path — the
 * shipped model cannot drift from what was trained.
 */
export async function extractDeskFeatures(frame: DeskFrame): Promise<DeskFeatureExtraction> {
  const rgb = toRgbFrame(frame);
  const base = await baseInfer(frame);
  const vector = [...sceneFeatures(rgb), ...faceFeatures(base, rgb)];
  // Detector test-time augmentation: small/off-center faces that the full
  // frame misses often fire inside a crop.
  for (const region of FACE_CROPS) {
    const crop = cropFrame(rgb, region.x, region.y, region.w, region.h);
    const result = await baseInfer(crop);
    vector.push(...cropFaceSummary(result, crop));
  }
  vector.push(...(await deepEmbedding(rgb)));
  vector.push(...(await sceneEmbedding(rgb)));
  return { vector, base };
}

function isLayer(value: unknown): value is DeskHeadLayer {
  const layer = value as DeskHeadLayer;
  return (
    typeof layer === "object" &&
    layer !== null &&
    Array.isArray(layer.w) &&
    Array.isArray(layer.b)
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseDeskHeadWeights(jsonText: string): DeskHeadWeights | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }
  const weights = parsed as DeskHeadWeights;
  if (
    typeof weights !== "object" ||
    weights === null ||
    !Array.isArray(weights.mean) ||
    !Array.isArray(weights.std) ||
    !Array.isArray(weights.layers) ||
    weights.layers.length === 0 ||
    !weights.layers.every(isLayer) ||
    !Array.isArray(weights.labels) ||
    weights.labels.length !== DESK_HEAD_LABELS.length ||
    typeof weights.featureDim !== "number"
  ) {
    return null;
  }
  // Content checks: a corrupt-but-parseable file must degrade to the safe
  // uncertain fallback, never to a fabricated label.
  if (weights.version !== DESK_FEATURE_VERSION) {
    // A head trained against an older/different feature layout would map the
    // wrong inputs to confident logits — reject it rather than fabricate.
    return null;
  }
  if (weights.mean.length !== weights.featureDim || weights.std.length !== weights.featureDim) {
    return null;
  }
  if (!weights.mean.every(isFiniteNumber) || !weights.std.every(isFiniteNumber)) {
    return null;
  }
  if (weights.inputSlices !== undefined) {
    if (!Array.isArray(weights.inputSlices)) {
      return null;
    }
    for (const slice of weights.inputSlices) {
      if (!Array.isArray(slice) || slice.length !== 2) {
        return null;
      }
      const [start, end] = slice;
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start) {
        return null;
      }
    }
  }
  // The head's first layer consumes the standardized features plus, when a
  // codebook is present, its retrieval features (min-dist + softmin per class).
  let inputDim = weights.featureDim;
  if (weights.codebook !== undefined) {
    if (!Array.isArray(weights.codebook) || weights.codebook.length === 0) {
      return null;
    }
    for (const centroids of weights.codebook) {
      if (!Array.isArray(centroids) || centroids.length === 0) {
        return null;
      }
      for (const centroid of centroids) {
        if (
          !Array.isArray(centroid) ||
          centroid.length !== weights.featureDim ||
          !centroid.every(isFiniteNumber)
        ) {
          return null;
        }
      }
    }
    inputDim += 2 * weights.codebook.length;
  }
  const lastLayer = weights.layers[weights.layers.length - 1];
  if (!lastLayer || lastLayer.b.length !== DESK_HEAD_LABELS.length) {
    return null;
  }
  for (const layer of weights.layers) {
    if (layer.w.length !== layer.b.length || layer.b.length === 0) {
      return null;
    }
    if (!layer.b.every(isFiniteNumber)) {
      return null;
    }
    // Row widths must chain: layer input = previous layer's output. A short
    // row would otherwise be zero-padded by deskHeadPredict into well-formed
    // but meaningless logits.
    for (const row of layer.w) {
      if (!Array.isArray(row) || row.length !== inputDim || !row.every(isFiniteNumber)) {
        return null;
      }
    }
    inputDim = layer.b.length;
  }
  return weights;
}

export function loadDeskHeadWeights(
  file: string = join(deskRoot(), DESK_HEAD_RELATIVE_PATH),
): DeskHeadWeights | null {
  try {
    return parseDeskHeadWeights(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export interface DeskHeadPrediction {
  label: DeskModelOutput["label"];
  confidence: number;
  probs: number[];
}

/** Slice raw features per the trained spec (identity when unspecified). */
export function applyInputSlices(
  slices: Array<[number, number]> | undefined,
  vector: number[],
): number[] {
  if (!slices || slices.length === 0) {
    return vector;
  }
  const out: number[] = [];
  for (const [start, end] of slices) {
    for (let i = start; i < end; i += 1) {
      out.push(vector[i] ?? 0);
    }
  }
  return out;
}

/** Slice → standardize → codebook retrieval → dense/ReLU stack → softmax. */
export function deskHeadPredict(weights: DeskHeadWeights, vector: number[]): DeskHeadPrediction {
  const sliced = applyInputSlices(weights.inputSlices, vector);
  const standardized = new Array<number>(weights.featureDim);
  for (let i = 0; i < weights.featureDim; i += 1) {
    const std = weights.std[i] ?? 1;
    standardized[i] = ((sliced[i] ?? 0) - (weights.mean[i] ?? 0)) / (std > 1e-6 ? std : 1);
  }
  let activations = weights.codebook
    ? [...standardized, ...codebookFeatures(weights.codebook, standardized)]
    : standardized;
  for (let l = 0; l < weights.layers.length; l += 1) {
    const layer = weights.layers[l];
    if (!layer) {
      continue;
    }
    const out = new Array<number>(layer.b.length);
    for (let o = 0; o < layer.b.length; o += 1) {
      let sum = layer.b[o] ?? 0;
      const row = layer.w[o] ?? [];
      for (let i = 0; i < activations.length; i += 1) {
        sum += (row[i] ?? 0) * (activations[i] ?? 0);
      }
      out[o] = l < weights.layers.length - 1 ? Math.max(0, sum) : sum;
    }
    activations = out;
  }
  const maxLogit = Math.max(...activations);
  const exps = activations.map((logit) => Math.exp(logit - maxLogit));
  const total = exps.reduce((sum, value) => sum + value, 0) || 1;
  const probs = exps.map((value) => value / total);
  let best = 0;
  for (let i = 1; i < probs.length; i += 1) {
    if ((probs[i] ?? 0) > (probs[best] ?? 0)) {
      best = i;
    }
  }
  const label = DESK_HEAD_LABELS[best] ?? "uncertain";
  return { label, confidence: probs[best] ?? 0, probs };
}

export class YourModel implements DeskModel {
  readonly id = "custom";
  private weights: DeskHeadWeights | null = null;
  private readonly weightsFile: string | undefined;

  /** `weightsFile` is a test seam — production loads the committed default. */
  constructor(weightsFile?: string) {
    this.weightsFile = weightsFile;
  }

  async init(): Promise<void> {
    if (!this.weights) {
      // A null load may be a transient read failure (e.g. antivirus briefly
      // locking the file) — retry on the next init() instead of latching the
      // no-weights fallback for the process lifetime.
      this.weights = this.weightsFile
        ? loadDeskHeadWeights(this.weightsFile)
        : loadDeskHeadWeights();
    }
    if (this.weights) {
      // Warm the shared detector so the first real frame is fast.
      sharedBase = sharedBase ?? new BlazeFaceDeskModel();
      await sharedBase.init();
    }
  }

  async infer(frame: DeskFrame): Promise<DeskModelResult> {
    await this.init();
    if (!this.weights) {
      // No trained head shipped — stay safe: uncertain never desk-only-kills.
      return {
        label: "uncertain",
        confidence: 0,
        debug: { reason: "custom-head-weights-missing", model: this.id },
      };
    }
    if (
      frame.width <= 0 ||
      frame.height <= 0 ||
      frame.data.length < frame.width * frame.height * 3
    ) {
      return {
        label: "uncertain",
        confidence: 0,
        debug: { reason: "custom-invalid-frame", model: this.id },
      };
    }
    const { vector, base } = await extractDeskFeatures(frame);
    const prediction = deskHeadPredict(this.weights, vector);
    return {
      label: prediction.label,
      confidence: prediction.confidence,
      faces: base.faces,
      debug: {
        ...base.debug,
        reason: "custom-head",
        model: this.id,
      },
    };
  }
}
