import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../../src/shared/policy";
import type { DeskLabel, DeskSnapshot, FocusSnapshot } from "../../src/shared/types";
import {
  DESK_DROP_FULL_SCALE,
  DESK_SAG_FULL_SCALE_PER_MIN,
  extractFeatures,
} from "../../src/shared/forecast/features";
import { fnv1a32 } from "../../src/shared/forecast/hash";
import {
  findDriftOnsets,
  labelFrames,
  type DecisionFrame,
  type FrameLabel,
} from "../../src/shared/forecast/labels";
import { TelemetryRing } from "../../src/shared/forecast/ring";
import {
  FORECAST_FEATURE_KEYS,
  type DriftType,
  type ForecastFeatureKey,
} from "../../src/shared/forecast/types";

/**
 * Shared helpers for the Focus Forecast training pipeline
 * (`scripts/forecast/`). Everything here is deterministic under a seed: the
 * simulator, the dataset builder, the trainer and the evaluator must produce
 * identical artifacts run to run so the committed weights + report are
 * reproducible claims, not snapshots of a lucky run.
 *
 * The feature extractor, ring, labeler and model are IMPORTED from
 * `src/shared/forecast` — the pipeline never re-implements them, which is the
 * train/serve-skew guarantee the design leans on.
 */

// ---------------------------------------------------------------------------
// Paths + JSONL IO
// ---------------------------------------------------------------------------

export function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

/** `data/forecast/` — gitignored; datasets and raw provenance live here. */
export function forecastDataRoot(): string {
  const dir = join(repoRoot(), "data", "forecast");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? (process.argv[index + 1] as string) : fallback;
}

export function numberArg(flag: string, fallback: number): number {
  const parsed = Number(stringArg(flag, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function boolFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

/** Streams a JSONL file line by line — dataset files are too big to slurp. */
export async function* readJsonl<T>(file: string): AsyncGenerator<T> {
  if (!existsSync(file)) {
    throw new Error(`${file} not found — run the earlier pipeline stage first`);
  }
  const lines = createInterface({
    input: createReadStream(file, "utf8"),
    crlfDelay: Infinity,
  });
  for await (const line of lines) {
    const trimmed = line.trim();
    if (trimmed) {
      yield JSON.parse(trimmed) as T;
    }
  }
}

// ---------------------------------------------------------------------------
// Determinism
// ---------------------------------------------------------------------------

/** Deterministic PRNG — same generator the desk-model pipeline uses. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = a;
  }
  return copy;
}

/** Standard normal via Box–Muller on the seeded PRNG. */
export function gaussian(rand: () => number): number {
  const u1 = Math.max(rand(), 1e-12);
  const u2 = rand();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** Stable sub-seed derivation, e.g. per-session generators. */
export function deriveSeed(seed: number, label: string): number {
  return fnv1a32(`${seed}:${label}`);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** JSON with sorted object keys — the provenance sha must not depend on key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Raw session streams (simulator output, augmenter input)
// ---------------------------------------------------------------------------

export type RawSource = "synthetic" | "recorded" | "augmented:local";

export interface RawFocusEvent {
  ts: number; // ms since session start
  proc: string;
  title: string;
  allow: boolean;
  block: boolean;
}

export interface RawDeskEvent {
  ts: number; // ms since session start
  on: boolean; // webcamEnabled
  label: DeskLabel;
  conf: number;
}

/** One simulated (or locally augmented) session — raw behavior, never features. */
export interface RawSession {
  v: 1;
  id: string;
  archetype: string;
  source: RawSource;
  seed: number;
  durationSec: number;
  focus: RawFocusEvent[];
  desk: RawDeskEvent[];
  /**
   * For `augmented:local` sessions only: the train session ids this one was
   * derived from (one for jitter/time-warp, two for a remix). The augmenter
   * records it rather than leaving the trainer to re-derive it, because
   * train.ts uses it to keep a jittered copy of a validation session OUT of
   * that fold's fit set — the leak the round-7 trainer had and the mlp-tuned
   * contender fixed. Never present on simulated sessions.
   */
  parents?: string[];
}

export const RAW_SESSIONS_FILE = "raw-sessions.jsonl";
/**
 * `{ "aug-000000": ["syn-000012"], … }` — the augmenter's own record of which
 * TRAIN sessions each augmented session descends from. Written by
 * build-dataset.ts beside the dataset; read by train.ts to assign every
 * augmented row to its parent's cross-validation fold (or drop it when the
 * parents straddle folds). Augmented sessions never reach
 * `raw-sessions.jsonl`, so this sidecar is where the lineage lives.
 */
export const AUGMENT_PARENTS_FILE = "augment-parents.json";
export const DATASET_FILE = "dataset.jsonl";
export const MANIFEST_FILE = "manifest.json";
export const PROVENANCE_FILE = "provenance.json";

// ---------------------------------------------------------------------------
// Dataset rows (docs/FORECAST-CONTRACTS.md §4 — exact schema)
// ---------------------------------------------------------------------------

export type DatasetSource =
  | "synthetic"
  | "recorded"
  | "augmented:local"
  | "augmented:adaption"
  | "invented:adaption";

export interface DatasetRow {
  v: 1;
  session_id: string;
  source: DatasetSource;
  archetype: string;
  split: "train" | "eval";
  t: number;
  features: number[];
  raw: Record<ForecastFeatureKey, number>;
  label: 0 | 1;
  secs_to_drift: number | null;
  drift_type: DriftType | null;
  prompt: string;
  completion: "DRIFT" | "STAY";
}

/** 80/20 per-SESSION split, seeded — frames of one session never straddle. */
export function splitForSession(sessionId: string, seed: number): "train" | "eval" {
  return fnv1a32(`split:${seed}:${sessionId}`) % 5 === 0 ? "eval" : "train";
}

/** Round to ≤2 decimals and trim trailing zeros — deterministic prompt numbers. */
export function fmtNum(value: number): string {
  if (!Number.isFinite(value)) {
    return "0";
  }
  return String(Math.round(value * 100) / 100);
}

const PROMPT_FIELDS: ReadonlyArray<[string, ForecastFeatureKey]> = [
  ["sw15", "switch15"],
  ["sw60", "switch60"],
  ["acc", "switchAccel"],
  ["dwell", "dwellCur"],
  ["allow60", "fracAllow60"],
  ["other60", "fracOther60"],
  ["od30", "otherDwell30"],
  ["dis", "distinct60"],
  ["sb", "sinceBlock"],
  ["stk", "streak"],
  ["dp30", "deskPresent30"],
  ["dc30", "deskConfMean30"],
  ["ds30", "deskConfStd30"],
  ["df60", "deskFlicker60"],
  ["min", "sessionMin"],
  ["pd", "priorDrifts"],
  ["tc30", "titleChurn30"],
  ["tc60", "titleChurn60"],
  ["sag", "deskSagSlope30"],
  ["dsh", "dwellShrink30v90"],
  ["tca", "titleChurnAccel"],
  ["gl120", "greyLeaky120"],
  ["arun", "absenceRun60"],
  ["dcd", "deskConfDrop120"],
];

/** Deterministic compact serialization for the Adaption `column_mapping` prompt. */
export function promptFor(raw: Record<ForecastFeatureKey, number>): string {
  const parts = PROMPT_FIELDS.map(([short, key]) => `${short}=${fmtNum(raw[key])}`);
  return `fp-forecast v1 | ${parts.join(" ")}`;
}

/** Inverse of `promptFor` — used by the Adaption download gate. Null on any malformed prompt. */
export function parsePrompt(prompt: string): Record<ForecastFeatureKey, number> | null {
  const match = /^fp-forecast v1 \| (.+)$/.exec(prompt.trim());
  if (!match) {
    return null;
  }
  const byShort = new Map<string, ForecastFeatureKey>(PROMPT_FIELDS.map(([s, k]) => [s, k]));
  const out = {} as Record<ForecastFeatureKey, number>;
  const seen = new Set<ForecastFeatureKey>();
  for (const token of (match[1] as string).split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq <= 0) {
      return null;
    }
    const key = byShort.get(token.slice(0, eq));
    const value = Number(token.slice(eq + 1));
    if (key === undefined || !Number.isFinite(value)) {
      return null;
    }
    out[key] = value;
    seen.add(key);
  }
  return seen.size === PROMPT_FIELDS.length ? out : null;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

function logCompress(x: number, cap: number): number {
  if (!Number.isFinite(x) || x <= 0) {
    return 0;
  }
  return Math.min(Math.log1p(x) / Math.log1p(cap), 1);
}

/**
 * Encodes a raw human-unit map into the [0,1] feature vector — the same
 * formulas as `extractFeatures`. Needed only for Adaption-download rows,
 * which arrive as prompts, not streams. `build-dataset.ts` self-checks this
 * against the real extractor on every run so the two can never drift apart.
 */
export function encodeRaw(raw: Record<ForecastFeatureKey, number>): number[] {
  const enc: Record<ForecastFeatureKey, number> = {
    switch15: clamp01(raw.switch15 / 8),
    switch60: clamp01(raw.switch60 / 20),
    switchAccel: clamp01(raw.switchAccel / 4),
    dwellCur: logCompress(raw.dwellCur, 600),
    fracAllow60: clamp01(raw.fracAllow60),
    fracOther60: clamp01(raw.fracOther60),
    otherDwell30: clamp01(raw.otherDwell30 / 30),
    distinct60: clamp01(raw.distinct60 / 8),
    sinceBlock: clamp01(1 - logCompress(Math.min(raw.sinceBlock, 600), 600)),
    streak: logCompress(raw.streak, 1800),
    deskPresent30: clamp01(raw.deskPresent30),
    deskConfMean30: clamp01(raw.deskConfMean30),
    deskConfStd30: clamp01(4 * raw.deskConfStd30),
    deskFlicker60: clamp01(raw.deskFlicker60 / 6),
    sessionMin: clamp01(raw.sessionMin / 50),
    priorDrifts: clamp01(raw.priorDrifts / 5),
    titleChurn30: clamp01(raw.titleChurn30 / 12),
    titleChurn60: clamp01(raw.titleChurn60 / 24),
    deskSagSlope30: clamp01(raw.deskSagSlope30 / DESK_SAG_FULL_SCALE_PER_MIN),
    dwellShrink30v90: clamp01(raw.dwellShrink30v90 / 4),
    titleChurnAccel: clamp01(raw.titleChurnAccel / 4),
    greyLeaky120: clamp01(raw.greyLeaky120),
    absenceRun60: clamp01(raw.absenceRun60 / 20),
    deskConfDrop120: clamp01(raw.deskConfDrop120 / DESK_DROP_FULL_SCALE),
  };
  return FORECAST_FEATURE_KEYS.map((key) => enc[key]);
}

/**
 * Per-feature sanity bounds for untrusted (downloaded) raw maps, in HUMAN
 * units. A table rather than a hand-written conjunction so a new feature key
 * cannot slip through unvalidated: `rawInBounds` asserts the table covers
 * every key in `FORECAST_FEATURE_KEYS`.
 */
export const RAW_BOUNDS: Readonly<Record<ForecastFeatureKey, readonly [number, number]>> = {
  switch15: [0, 200],
  switch60: [0, 500],
  switchAccel: [0, 5000],
  dwellCur: [0, 86_400],
  fracAllow60: [0, 1],
  fracOther60: [0, 1],
  otherDwell30: [0, 120],
  distinct60: [0, 200],
  sinceBlock: [0, 600],
  streak: [0, 86_400],
  deskPresent30: [0, 1],
  deskConfMean30: [0, 1],
  deskConfStd30: [0, 1],
  deskFlicker60: [0, 600],
  sessionMin: [0, 24 * 60],
  priorDrifts: [0, 1000],
  titleChurn30: [0, 500],
  titleChurn60: [0, 1000],
  deskSagSlope30: [0, 600],
  dwellShrink30v90: [0, 5000],
  titleChurnAccel: [0, 5000],
  greyLeaky120: [0, 1],
  absenceRun60: [0, 600],
  deskConfDrop120: [0, 1],
};

/** Sanity bounds for untrusted (downloaded) raw maps — outside ⇒ row dropped. */
export function rawInBounds(raw: Record<ForecastFeatureKey, number>): boolean {
  return FORECAST_FEATURE_KEYS.every((key) => {
    const bounds = RAW_BOUNDS[key];
    if (bounds === undefined) {
      throw new Error(`RAW_BOUNDS is missing feature ${key} — add it before shipping the feature`);
    }
    const value = raw[key];
    return Number.isFinite(value) && value >= bounds[0] && value <= bounds[1];
  });
}

// ---------------------------------------------------------------------------
// Replay: raw session stream → per-second frames through the SHARED core
// ---------------------------------------------------------------------------

/** Session settings for replay — the shipped defaults (strict, webcam on). */
export const REPLAY_DESK_THRESHOLD = 0.6;
export const REPLAY_STRICT_MODE = true;

export interface ReplayFrame {
  /** Seconds since session start (1-based commit at each whole second). */
  t: number;
  values: number[];
  raw: Record<ForecastFeatureKey, number>;
  decision: DecisionFrame["decision"];
  countdownActive: boolean;
}

/**
 * Replays one raw session through the shared `TelemetryRing` + `classify` +
 * `extractFeatures` — the identical code path runtime inference uses. One
 * frame per whole second. `countdownActive` is decision-derived (a policy
 * countdown burns exactly while the decision is drifted in these scripted
 * streams); the labeler treats drifted and counting-down frames identically.
 */
export function replaySession(session: RawSession): ReplayFrame[] {
  const ring = new TelemetryRing(0);
  ring.reset(0);
  const frames: ReplayFrame[] = [];
  let focusIndex = 0;
  let deskIndex = 0;
  let lastFocus: FocusSnapshot | null = null;
  let lastDesk: DeskSnapshot | null = null;

  for (let t = 1; t <= session.durationSec; t += 1) {
    const ts = t * 1000;
    while (focusIndex < session.focus.length && (session.focus[focusIndex] as RawFocusEvent).ts <= ts) {
      const event = session.focus[focusIndex] as RawFocusEvent;
      lastFocus = {
        ts: event.ts,
        processName: event.proc,
        windowTitle: event.title,
        matchedAllow: event.allow,
        matchedBlock: event.block,
      };
      ring.noteFocus(lastFocus);
      focusIndex += 1;
    }
    while (deskIndex < session.desk.length && (session.desk[deskIndex] as RawDeskEvent).ts <= ts) {
      const event = session.desk[deskIndex] as RawDeskEvent;
      lastDesk = {
        ts: event.ts,
        label: event.label,
        confidence: event.conf,
        webcamEnabled: event.on,
      };
      ring.noteDesk(lastDesk, REPLAY_DESK_THRESHOLD);
      deskIndex += 1;
    }
    const classified = classify({
      sessionActive: true,
      focus: lastFocus,
      desk: lastDesk,
      countdownSec: 10,
      deskThreshold: REPLAY_DESK_THRESHOLD,
      strictMode: REPLAY_STRICT_MODE,
    });
    ring.noteStatus(classified.decision);
    ring.commit(ts);
    const extraction = extractFeatures(ring, ts);
    frames.push({
      t,
      values: extraction.values,
      raw: extraction.raw,
      decision: classified.decision,
      countdownActive: classified.decision === "DISTRACTED" || classified.decision === "AWAY",
    });
  }
  return frames;
}

export interface LabeledReplay {
  frames: ReplayFrame[];
  labels: FrameLabel[];
  onsets: ReturnType<typeof findDriftOnsets>;
}

/** Replay + shared drift-onset detection + horizon labels + censoring flags. */
export function labelSession(session: RawSession): LabeledReplay {
  const frames = replaySession(session);
  const decisions: DecisionFrame[] = frames.map((frame) => ({
    t: frame.t,
    decision: frame.decision,
    countdownActive: frame.countdownActive,
  }));
  const onsets = findDriftOnsets(decisions);
  const labels = labelFrames(decisions, onsets, session.durationSec);
  return { frames, labels, onsets };
}

// ---------------------------------------------------------------------------
// Train-only negative downsampling (design §3.3) — rule shared with train.ts
// ---------------------------------------------------------------------------

/** Negatives with an onset within this many seconds ahead are always kept. */
export const NEAR_DRIFT_KEEP_SEC = 120;
/** Keep probability for calm-stretch negatives (train split only). */
export const CALM_KEEP_PROB = 0.25;

/**
 * Keep probability the builder used for a row — derivable from the row alone
 * so train.ts can invert it into importance weights (Platt calibration and
 * val metrics must be unbiased at natural prevalence).
 */
export function keepProbability(label: 0 | 1, secsToDrift: number | null): number {
  if (label === 1) {
    return 1;
  }
  if (secsToDrift !== null && secsToDrift <= NEAR_DRIFT_KEEP_SEC) {
    return 1;
  }
  return CALM_KEEP_PROB;
}

// ---------------------------------------------------------------------------
// Metrics: ROC-AUC (rank-based), PR-AUC, ECE, percentiles
// ---------------------------------------------------------------------------

/** Mann–Whitney ROC-AUC with average ranks for ties. NaN-free; 0.5 on degenerate input. */
export function rocAuc(scores: readonly number[], labels: readonly number[]): number {
  const n = scores.length;
  let positives = 0;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => (scores[a] as number) - (scores[b] as number),
  );
  let rankSum = 0;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && scores[order[j + 1] as number] === scores[order[i] as number]) {
      j += 1;
    }
    const avgRank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) {
      if ((labels[order[k] as number] ?? 0) === 1) {
        rankSum += avgRank;
        positives += 1;
      }
    }
    i = j + 1;
  }
  const negatives = n - positives;
  if (positives === 0 || negatives === 0) {
    return 0.5;
  }
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives);
}

/** Average-precision PR-AUC (step interpolation), natural prevalence. */
export function prAuc(scores: readonly number[], labels: readonly number[]): number {
  const order = Array.from({ length: scores.length }, (_, i) => i).sort(
    (a, b) => (scores[b] as number) - (scores[a] as number),
  );
  const totalPositives = labels.reduce<number>((sum, label) => sum + (label === 1 ? 1 : 0), 0);
  if (totalPositives === 0) {
    return 0;
  }
  let tp = 0;
  let seen = 0;
  let ap = 0;
  for (const index of order) {
    seen += 1;
    if ((labels[index] ?? 0) === 1) {
      tp += 1;
      ap += tp / seen;
    }
  }
  return ap / totalPositives;
}

export interface ReliabilityBin {
  lo: number;
  hi: number;
  count: number;
  meanPredicted: number;
  observedRate: number;
}

/** 10-equal-width-bin expected calibration error + reliability table. */
export function ece10(
  scores: readonly number[],
  labels: readonly number[],
): { ece: number; bins: ReliabilityBin[] } {
  const bins: ReliabilityBin[] = Array.from({ length: 10 }, (_, b) => ({
    lo: b / 10,
    hi: (b + 1) / 10,
    count: 0,
    meanPredicted: 0,
    observedRate: 0,
  }));
  for (let i = 0; i < scores.length; i += 1) {
    const score = scores[i] as number;
    const bin = bins[Math.min(9, Math.max(0, Math.floor(score * 10)))] as ReliabilityBin;
    bin.count += 1;
    bin.meanPredicted += score;
    bin.observedRate += labels[i] ?? 0;
  }
  let ece = 0;
  for (const bin of bins) {
    if (bin.count > 0) {
      bin.meanPredicted /= bin.count;
      bin.observedRate /= bin.count;
      ece += (bin.count / scores.length) * Math.abs(bin.meanPredicted - bin.observedRate);
    }
  }
  return {
    ece,
    bins: bins.map((bin) => ({
      ...bin,
      meanPredicted: round6(bin.meanPredicted),
      observedRate: round6(bin.observedRate),
    })),
  };
}

export function percentile(sortedAscending: readonly number[], p: number): number | null {
  if (sortedAscending.length === 0) {
    return null;
  }
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.round((sortedAscending.length - 1) * p)),
  );
  return sortedAscending[index] as number;
}

export function round6(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(6)) : value;
}

export function round4(value: number): number {
  return Number.isFinite(value) ? Number(value.toFixed(4)) : value;
}

// ---------------------------------------------------------------------------
// Logistic-regression baselines (eval.ts) — seeded full-batch GD
// ---------------------------------------------------------------------------

export interface LogisticModel {
  w: number[];
  b: number;
  mean: number[];
  std: number[];
}

function sigmoidStable(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/**
 * Class-weighted logistic regression on raw column indices of `x`. Small and
 * deterministic — it exists to be beaten, but it is trained honestly (same
 * rows and class weighting the MLP sees).
 */
export function trainLogistic(
  x: readonly number[][],
  y: readonly number[],
  columns: readonly number[],
  epochs = 250,
  lr = 0.5,
): LogisticModel {
  const n = x.length;
  const d = columns.length;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(0);
  for (const row of x) {
    for (let j = 0; j < d; j += 1) {
      mean[j] = (mean[j] as number) + (row[columns[j] as number] ?? 0);
    }
  }
  for (let j = 0; j < d; j += 1) {
    mean[j] = (mean[j] as number) / Math.max(1, n);
  }
  for (const row of x) {
    for (let j = 0; j < d; j += 1) {
      const diff = (row[columns[j] as number] ?? 0) - (mean[j] as number);
      std[j] = (std[j] as number) + diff * diff;
    }
  }
  for (let j = 0; j < d; j += 1) {
    const s = Math.sqrt((std[j] as number) / Math.max(1, n));
    std[j] = s > 1e-9 ? s : 1;
  }
  const positives = y.reduce<number>((sum, label) => sum + (label === 1 ? 1 : 0), 0);
  const wPos = positives > 0 ? (n - positives) / positives : 1;

  const w = new Array<number>(d).fill(0);
  let b = 0;
  const xs = x.map((row) =>
    columns.map((c, j) => ((row[c] ?? 0) - (mean[j] as number)) / (std[j] as number)),
  );
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    let weightTotal = 0;
    for (let i = 0; i < n; i += 1) {
      const row = xs[i] as number[];
      let z = b;
      for (let j = 0; j < d; j += 1) {
        z += (w[j] as number) * (row[j] as number);
      }
      const weight = (y[i] ?? 0) === 1 ? wPos : 1;
      const err = (sigmoidStable(z) - (y[i] ?? 0)) * weight;
      weightTotal += weight;
      for (let j = 0; j < d; j += 1) {
        gw[j] = (gw[j] as number) + err * (row[j] as number);
      }
      gb += err;
    }
    for (let j = 0; j < d; j += 1) {
      w[j] = (w[j] as number) - (lr * (gw[j] as number)) / Math.max(1, weightTotal);
    }
    b -= (lr * gb) / Math.max(1, weightTotal);
  }
  return { w, b, mean, std };
}

export function logisticScore(model: LogisticModel, row: readonly number[], columns: readonly number[]): number {
  let z = model.b;
  for (let j = 0; j < columns.length; j += 1) {
    const value = ((row[columns[j] as number] ?? 0) - (model.mean[j] as number)) / (model.std[j] as number);
    z += (model.w[j] as number) * value;
  }
  return sigmoidStable(z);
}

// ---------------------------------------------------------------------------
// Operating-point thresholds (parity with DEFAULT_SETTINGS forecast keys)
// ---------------------------------------------------------------------------

/** Contract defaults (docs/FORECAST-CONTRACTS.md §3) — the parity target. */
export const CONTRACT_NUDGE_RISK = 0.45;
export const CONTRACT_PREARM_RISK = 0.8;
export const CONTRACT_PREARM_FUSE_SEC = 5;
export const CONTRACT_BASE_FUSE_SEC = 10;

/**
 * Alarm budget for the train-internal operating-point search in train.ts.
 * These exist so recall can never be bought with volume — a candidate
 * threshold is admissible only inside all three:
 *
 * - `CHURN_FPR_CEILING` — the brief's own constraint: the `research_churn`
 *   archetype (heavy allowlist-internal switching, zero drifts) must not fire.
 * - `ALARM_LOAD_ALLOWANCE` — the ALARM rate (nudges + pre-arms) may exceed the
 *   rate the SAME model produces at the FROZEN 0.55/0.80 point on the SAME
 *   sessions by at most this factor. It is deliberately a RATIO, not an
 *   absolute rate: the search runs on cross-fitted train sessions whose risk
 *   scale is not identical to the shipped model's, and a ratio measured against
 *   a reference on that same scale cancels the difference, where an absolute
 *   "3.5 nudges/h" would not transfer at all. 1.15 is the product call: at most
 *   ~15 % louder than what already ships — an alarm roughly every 16 minutes
 *   instead of every 19. It counts pre-arms as well as nudges because a pre-arm
 *   is an interruption too: counting only nudges would let a lower pre-arm line
 *   buy recall by converting nudge events into pre-arm events and then call the
 *   product quieter.
 * - `FALSE_PREARM_CEILING_PER_HOUR` — the design's stated budget
 *   (docs/FORECAST-DESIGN.md §4.5: "< 2 false pre-arms/hour"). Absolute,
 *   because the design states it as an absolute promise to the user.
 */
export const CHURN_FPR_CEILING = 0.01;
export const ALARM_LOAD_ALLOWANCE = 1.15;
export const FALSE_PREARM_CEILING_PER_HOUR = 2;

/**
 * The nudge threshold the product shipped BEFORE the bake-off (0.55). The
 * alarm budget is pinned to what this costs, never to whatever
 * `DEFAULT_SETTINGS` currently says — otherwise every re-run would measure
 * itself against its own previous answer and ratchet the threshold downward
 * one grid step at a time. Frozen: it is a historical fact, not a setting.
 */
export const ALARM_BUDGET_REFERENCE_NUDGE_RISK = 0.55;

/**
 * The pre-arm threshold that rode alongside it (0.80, unchanged from the
 * original design). Frozen for the same reason: the alarm-load reference has
 * to be one fixed historical point, not whatever the last run selected.
 */
export const ALARM_BUDGET_REFERENCE_PREARM_RISK = 0.8;

export interface ThresholdSource {
  nudge: number;
  prearm: number;
  clear: number;
  source: "DEFAULT_SETTINGS" | "contract-defaults";
}

/**
 * Reads the forecast thresholds from `DEFAULT_SETTINGS` when the settings
 * stream has landed its five keys; until then the frozen contract defaults
 * stand in (same numbers). eval.ts asserts weights.thresholds against this.
 */
export async function thresholdDefaults(): Promise<ThresholdSource> {
  const { DEFAULT_SETTINGS } = await import("../../src/shared/defaults");
  const { CLEAR_HYSTERESIS } = await import("../../src/shared/forecast/escalate");
  const settings = DEFAULT_SETTINGS as unknown as Record<string, unknown>;
  const nudge = settings.forecastNudgeRisk;
  const prearm = settings.forecastPrearmRisk;
  if (typeof nudge === "number" && typeof prearm === "number") {
    return { nudge, prearm, clear: nudge - CLEAR_HYSTERESIS, source: "DEFAULT_SETTINGS" };
  }
  return {
    nudge: CONTRACT_NUDGE_RISK,
    prearm: CONTRACT_PREARM_RISK,
    clear: CONTRACT_NUDGE_RISK - CLEAR_HYSTERESIS,
    source: "contract-defaults",
  };
}

// ---------------------------------------------------------------------------
// Manifest / provenance (honesty artifacts)
// ---------------------------------------------------------------------------

export interface AdaptionProvenance {
  attempted: boolean;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  datasetId: string | null;
  augmentedDatasetId: string | null;
  mergedRows: number;
  droppedRows: number;
}

export interface DatasetManifest {
  version: 1;
  createdAt: string;
  seed: number;
  mode: "offline" | "offline-fallback" | "adaption";
  gitCommit: string;
  counts: {
    sessions: Record<string, number>; // by source
    sessionsByArchetype: Record<string, number>;
    rows: { train: number; eval: number; total: number };
    rowsBySource: Record<string, number>;
    positives: { train: number; eval: number };
    excludedFrames: number;
    rawFrames: number;
  };
  adaption: AdaptionProvenance;
  downsample: { nearDriftKeepSec: number; calmKeepProb: number };
}
