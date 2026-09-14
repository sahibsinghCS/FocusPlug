import type { DeskSnapshot } from "@shared/types";

/** RGB, 3 bytes per pixel, row-major. Compatible with shared `DeskFrame`. */
export interface RgbFrame {
  width: number;
  height: number;
  data: Uint8Array;
}

export interface FaceSignal {
  probability: number;
  box: { x0: number; y0: number; x1: number; y1: number };
  landmarks: Array<{ x: number; y: number }>;
}

export interface FrameStats {
  width: number;
  height: number;
  meanLuma: number;
  lumaStd: number;
}

export interface ClassifyInput {
  ts: number;
  webcamEnabled: boolean;
  frame: FrameStats | null;
  faces: FaceSignal[];
}

export interface DeskDebug {
  reason: string;
  faceCount: number;
  usableFaceCount: number;
  maxProbability: number;
  meanLuma: number;
  lumaStd: number;
  largestFaceAreaRatio: number;
  backend: string;
  model: string;
  /**
   * Which attention head produced the reading on this frame — present only on
   * `deskModelId: "custom"` frames that got an attention call at all. It is
   * reported by the model that ran, so a log line or an evidence file can
   * never claim a head the arithmetic did not use.
   */
  attentionHead?: "shipped" | "personal";
}

export interface DeskAnalysis {
  snapshot: DeskSnapshot;
  debug: DeskDebug;
}

export interface FrameSource {
  start(): Promise<void>;
  stop(): Promise<void>;
  grab(): Promise<RgbFrame | null>;
}
