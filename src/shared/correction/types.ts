import type { AttentionLabel, DeskModelId } from "../types";
import type { PauseKind } from "../nudge";

/* ────────────────────────────────────────────────────────────────────────
 * What the student said
 * ──────────────────────────────────────────────────────────────────────── */

/** `wrong` — the pause was a mistake. `right` — it was not. Nothing else. */
export type CorrectionVerdict = "wrong" | "right";

/** Which head a correction is evidence for. Only `attention` is ever refit. */
export type CorrectionHead = "attention" | "presence";

/**
 * The four labels the two buttons can produce. `unfocused` is deliberately
 * absent: it can never stop a clock, so it can never be corrected, and asking
 * a tired student to grade their own attention on a three-point scale at the
 * moment they are annoyed produces worse labels than not asking.
 */
export type CorrectionLabel = "focused" | "phone" | "at_desk" | "away";

/**
 * One row of the kind x verdict table — the whole meaning of a correction, in
 * one place, so main and the renderer cannot disagree about it.
 */
export interface CorrectionMeaning {
  label: CorrectionLabel;
  head: CorrectionHead;
  /** `attention` CSV cell. Empty for a presence correction, which makes no
   *  attention claim and which `train-attention.ts` then skips unchanged. */
  attention: AttentionLabel | "";
  /** `pack_label` CSV cell: honestly where the row came from. */
  packLabel: CorrectionLabel;
  /** `person` / `workspace` / `phone` / `gaze` are DERIVED from the verdict,
   *  never observed — the same rule self-labelled clips follow. */
  person: string;
  workspace: string;
  phoneCell: string;
  gaze: string;
  /** Enters the personal attention refit pool. False for presence rows. */
  trainsPersonalHead: boolean;
  /** Arms the per-kind cooldown. True exactly for `verdict: "wrong"`. */
  armsCooldown: boolean;
  /** Asks Focus Plan to retract the drift this reading produced. */
  retractsDrift: boolean;
}

export type CorrectionCase = `${PauseKind}:${CorrectionVerdict}`;

/* ────────────────────────────────────────────────────────────────────────
 * The pending capture — held in memory, never on disk until answered
 * ──────────────────────────────────────────────────────────────────────── */

/** What the renderer needs to draw the verdict row. No pixels cross the wire. */
export interface PendingCorrection {
  /** Also `NudgeEvent.correctionId`, so a verdict names one exact pause. */
  id: string;
  at: number;
  kind: PauseKind;
  /** What the model said: "away" (presence) or "phone" (attention). */
  modelLabel: string;
  modelConfidence: number;
  /** Frames held in memory for this pause. 0 means no chips are offered. */
  frames: number;
  /** Epoch ms after which the offer lapses and the bytes are freed. */
  expiresAt: number;
  /** True when the store is at CORRECTION_CAP_GROUPS: the verdict still
   *  resumes, silences and retracts; only the photos are not kept. */
  capped: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * The stored record
 * ──────────────────────────────────────────────────────────────────────── */

export interface DeskCorrectionFrame {
  /** Relative to <userData>/desk-corrections/, e.g. "frames/dc-0007/frame-0002.jpg". */
  file: string;
  at: number;
  width: number;
  height: number;
  bytes: number;
  /** The model's own call on THIS frame, kept so the review screen and the
   *  CSV note can show what was being corrected. */
  predicted: string;
  confidence: number;
  /** The 16 activations of the frozen 1280->16 layer. Null until the
   *  extraction queue (idle-only) fills it, or the refit fills it itself. */
  hidden: number[] | null;
  /** Base head hash `hidden` was computed against; a mismatch invalidates it. */
  hiddenFor: string | null;
}

export interface DeskCorrectionRetraction {
  roundKey: string;
  /** Served-second offset of the onset removed, or null when refused. */
  retractedAtSec: number | null;
  refusal: PlanRetractionRefusal | null;
}

export interface DeskCorrection {
  v: 1;
  /** "dc-0007". Also the CSV `group`: one correction is one group. */
  id: string;
  at: number;
  /** Local "YYYY-MM-DD", stamped in MAIN so the pure core never touches Date. */
  day: string;
  kind: PauseKind;
  verdict: CorrectionVerdict;
  /** What the model said, and how sure it was, at the moment it paused. */
  modelLabel: string;
  modelConfidence: number;
  label: CorrectionLabel;
  head: CorrectionHead;
  /** Odd correction number train, even eval — exactly `clipSplit`. */
  split: "train" | "eval";
  deskModelId: DeskModelId;
  /** sha256(attention-head.json).slice(0, 16) at capture time. */
  baseHeadHash: string;
  featureVersion: number;
  frames: DeskCorrectionFrame[];
  /** Total bytes on disk for this correction, thumbnail included. */
  bytes: number;
  /** True when the cap was reached: `frames` is empty by design, not by loss. */
  capped: boolean;
  /** The Focus Plan round this pause interrupted, when there was one. */
  retraction: DeskCorrectionRetraction | null;
}

/** On-disk shape of <userData>/desk-corrections/corrections.json. */
export interface DeskCorrectionsFile {
  v: 1;
  lifetimeCorrections: number;
  /** Oldest first, capped at CORRECTION_CAP_GROUPS. */
  corrections: DeskCorrection[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Focus Plan retraction — the command's answer
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanRetractionRefusal =
  | "plan-off"
  | "pinned"
  | "no-round"
  | "no-onset"
  | "not-open"
  | "not-away"
  | "capped";

export interface PlanRetraction {
  retracted: boolean;
  roundKey: string | null;
  retractedAtSec: number | null;
  firstDriftSecBefore: number | null;
  firstDriftSecAfter: number | null;
  /** The first gate that refused, or null when it went through. */
  refusal: PlanRetractionRefusal | null;
}

/* ────────────────────────────────────────────────────────────────────────
 * The refit
 * ──────────────────────────────────────────────────────────────────────── */

/** The 51 numbers a refit produces. Layer 0 is not, and cannot be, in here. */
export interface OutputLayer {
  w: number[][];
  b: number[];
}

/** One eval anchor: 16 activations out of the frozen bottleneck, and a truth. */
export interface AttentionAnchorRow {
  path: string;
  /** Which held-out population. Never pooled in a printed number without
   *  saying so — they are different distributions with different truths. */
  slice: "adaption" | "proxy";
  truth: AttentionLabel;
  hidden: number[];
}

export interface AttentionAnchors {
  v: 1;
  baseHeadHash: string;
  hiddenDim: number;
  labels: readonly AttentionLabel[];
  rows: AttentionAnchorRow[];
}

export interface SliceScore {
  images: number;
  /** Independent groups behind those images. A number without this is not
   *  constructible, which is how "frames are not samples" is enforced. */
  groups: number;
  accuracy: number;
  /** Macro-recall over the classes PRESENT in this slice. */
  balanced: number;
  presentLabels: readonly AttentionLabel[];
  phone: { precision: number; recall: number; f1: number; support: number };
}

export interface RefitScores {
  /** All 286 anchors. The gate's pooled bar. */
  pooled: SliceScore;
  /** The 200 Adaption-annotated stock photos. */
  adaption: SliceScore;
  /** The 86 stock attention proxies (no `unfocused` images at all). */
  proxy: SliceScore;
  /** The student's own held-out corrections, one vote per correction.
   *  Null when there are none. */
  personalHoldout: SliceScore | null;
  /** Held-out corrections this head agrees with the student on. */
  personalHoldoutGroupsCorrect: number;
}

export type RefitGateId =
  | "not-custom-model"
  | "session-active"
  | "too-few-corrections"
  | "too-few-train-groups"
  | "too-few-eval-groups"
  | "stale-base"
  | "stale-anchors"
  | "drifted-too-far"
  | "regressed-pooled"
  | "regressed-slice"
  | "no-personal-gain";

export interface RefitGateResult {
  id: RefitGateId;
  passed: boolean;
  /** Rendered verbatim under "Why this?". Never empty. */
  detail: string;
}

export interface RefitInterval {
  point: number;
  lo: number;
  hi: number;
  draws: number;
}

export interface RefitReport {
  v: 1;
  at: number;
  baseHeadHash: string;
  anchorsHash: string;
  lambda: number;
  epochs: number;
  learningRate: number;
  driftRatio: number;
  corrections: {
    total: number;
    trainGroups: number;
    evalGroups: number;
    frames: number;
    byLabel: Record<string, number>;
    trainIds: string[];
    evalIds: string[];
  };
  shipped: RefitScores;
  personal: RefitScores;
  /** Every gate, in order. */
  gates: RefitGateResult[];
  /** The FIRST gate that failed, or null when all of them passed. */
  blockedBy: RefitGateId | null;
  /** Paired bootstrap of (personal - shipped) balanced accuracy on the pooled
   *  anchors, in points. REPORTED BESIDE THE GATE, never used as the gate. */
  pooledMarginCi95: RefitInterval | null;
  installed: boolean;
  /** False only on the dev-only `{ gate: "off" }` path, and then it is
   *  rendered in the UI until the next real refit. */
  gateEnforced: boolean;
}

/** <userData>/desk-corrections/personal-attention-head.json.
 *  Written ONLY when the gate passed; deleted when it does not. */
export interface PersonalAttentionHead {
  v: 1;
  baseHeadHash: string;
  labels: readonly AttentionLabel[];
  /** The refit output layer. The 1280->16 representation stays the shipped
   *  one, because this file cannot express it. */
  output: OutputLayer;
  fittedAt: number;
  report: RefitReport;
}

/* ────────────────────────────────────────────────────────────────────────
 * Wire shapes
 * ──────────────────────────────────────────────────────────────────────── */

export type ActiveAttentionHead = "shipped" | "personal";

/** One row of the review list. Carries a thumbnail, never a full frame. */
export interface CorrectionListItem {
  id: string;
  at: number;
  day: string;
  kind: PauseKind;
  verdict: CorrectionVerdict;
  modelLabel: string;
  modelConfidence: number;
  label: CorrectionLabel;
  head: CorrectionHead;
  frames: number;
  bytes: number;
  capped: boolean;
  /** 160px JPEG data URL, or null when this correction kept no photos. */
  thumbnail: string | null;
  /** Null exactly when this correction trains the personal head. */
  excludedBecause: string | null;
}

export interface CorrectionCooldown {
  kind: PauseKind;
  until: number;
  /** The correction that armed it, so deleting that row drops this. */
  correctionId: string;
}

/** CORRECTIONS_GET_STATE / CORRECTIONS_STATE payload. */
export interface DeskCorrectionsState {
  v: 1;
  /** False exactly when `deskCorrectionsEnabled` is off. */
  enabled: boolean;
  /** True only on `deskModelId: "custom"` — nothing here is reachable
   *  otherwise, because nothing else can pause. */
  available: boolean;
  /** The pause waiting for an answer, or null. */
  pending: PendingCorrection | null;
  items: CorrectionListItem[];
  lifetimeCorrections: number;
  bytes: number;
  capped: boolean;
  cooldowns: CorrectionCooldown[];
  /** Corrections in the attention pool, and how many more the refit needs. */
  refitReady: boolean;
  refitTrainGroups: number;
  refitEvalGroups: number;
  refitNeeded: number;
  activeHead: ActiveAttentionHead;
  lastRefit: RefitReport | null;
}

export interface RecordCorrectionRequest {
  correctionId: string;
  verdict: CorrectionVerdict;
}

export interface RecordCorrectionResult {
  recorded: boolean;
  correctionId: string;
  /** Non-null when a cooldown was armed. */
  cooldown: CorrectionCooldown | null;
  retraction: PlanRetraction | null;
  state: DeskCorrectionsState;
}
