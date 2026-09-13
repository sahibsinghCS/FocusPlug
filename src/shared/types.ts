export type DeskLabel = "at_desk" | "away" | "uncertain";
export type AttentionLabel = "focused" | "unfocused" | "phone";
export type Decision = "ON_TASK" | "DISTRACTED" | "AWAY" | "IDLE";
export type DeskModelId = "stub" | "blazeface" | "custom";
export type PlugProtocol = "kasa" | "http" | "mock";

export interface AppEntry {
  id: string;
  name: string;          // display
  match: string[];       // process names and/or title substrings (case-insensitive)
  enabled: boolean;
}

export interface FocusSnapshot {
  ts: number;
  processName: string;
  windowTitle: string;
  matchedAllow: boolean;
  matchedBlock: boolean;
  blockEntryId?: string;
}

export interface DeskAttention {
  label: AttentionLabel;
  confidence: number; // 0..1
}

export interface DeskSnapshot {
  ts: number;
  label: DeskLabel;
  confidence: number; // 0..1
  webcamEnabled: boolean;
  /** only while at_desk, and only from a model with an attention head */
  attention?: DeskAttention;
}

/** RGB frame — same shape as src/main/desk `RgbFrame`, plus Float32 tensors. */
export interface DeskFrame {
  width: number;
  height: number;
  data: Uint8Array | Float32Array;
}

/** Timmy drops his model behind this. No training in this phase. */
export interface DeskModelOutput {
  label: DeskLabel;
  confidence: number; // 0..1
  /** optional: focused / unfocused / phone, only when label is at_desk */
  attention?: DeskAttention;
  /** optional debug faces */
  faces?: Array<{ probability: number; box: { x0: number; y0: number; x1: number; y1: number } }>;
}

export interface DeskModel {
  readonly id: string;
  init(): Promise<void>;
  /** RGB frame bytes + width/height — match existing desk/frame types if present */
  infer(frame: DeskFrame): Promise<DeskModelOutput>;
  dispose?(): Promise<void>;
}

export interface PlugDevice {
  id: string;
  name: string;
  protocol: PlugProtocol;
  /** host/ip or unique device id */
  address: string;
  enabled: boolean;
  /** NEVER true for study PC — fun/secondary devices only */
  isStudyPc: false;
}

export interface PlugSnapshot {
  ts: number;
  deviceId: string;
  online: boolean;
  powerOn: boolean | null;
  error?: string;
}

export interface PolicyInput {
  sessionActive: boolean;
  focus: FocusSnapshot | null;
  desk: DeskSnapshot | null;
  countdownSec: number;
  deskThreshold: number;
  strictMode: boolean; // on-task requires allowlist focus AND at_desk
}

export type PolicyEvent =
  | { type: "start_countdown"; reason: string; seconds: number }
  | { type: "cancel_countdown" }
  | { type: "kill"; targets: string[]; reason: string }
  | { type: "unlock" }
  | { type: "status"; decision: Decision; detail: string }
  | { type: "plug_off"; deviceIds: string[]; reason: string }
  | { type: "plug_on"; deviceIds: string[]; reason: string };

export interface SessionEvent {
  ts: number;
  kind: string;
  detail: string;
}
