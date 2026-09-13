import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DESK_FEATURE_VERSION } from "../../src/main/desk/model/your-model";
import { FIRST_PERSON_BUCKET } from "./first-person";

/**
 * Shared helpers for the desk-model training pipeline.
 *
 * The labeled image pack (release `desk-data-v2-full`) lives OUTSIDE the
 * repo and is never committed. Point `FOCUSPLUG_DESK_DATA` at the extracted
 * `focusplug-desk-data/` directory (the one containing `labels.json`).
 */

export interface PackItem {
  path: string;
  label: string;
  split: "train" | "eval";
  bucket: string;
}

export interface PackLabels {
  version: number;
  target_accuracy: number;
  desk_model_mapping: Record<string, string>;
  items: PackItem[];
}

export interface FeatureRow {
  path: string;
  /** Raw pack label (at_desk / away / distracted / uncertain). */
  label: string;
  /** 3-way DeskLabel after desk_model_mapping. */
  mapped: string;
  split: "train" | "eval";
  bucket: string;
  vector: number[];
  baseLabel: string;
  baseConfidence: number;
}

export function dataRoot(): string {
  const root = process.env.FOCUSPLUG_DESK_DATA;
  if (!root) {
    throw new Error(
      "FOCUSPLUG_DESK_DATA is not set. Download + extract the desk-data-v2-full " +
        "release (see docs/CUSTOM-MODEL.md) and point FOCUSPLUG_DESK_DATA at the " +
        "extracted focusplug-desk-data directory. The dataset must never be committed.",
    );
  }
  if (!existsSync(join(root, "labels.json"))) {
    throw new Error(`FOCUSPLUG_DESK_DATA=${root} does not contain labels.json`);
  }
  return root;
}

export function cacheDir(): string {
  const dir = join(dataRoot(), ".cache");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function loadPackLabels(): PackLabels {
  return JSON.parse(readFileSync(join(dataRoot(), "labels.json"), "utf8")) as PackLabels;
}

export function mapLabel(pack: PackLabels, raw: string): string {
  return pack.desk_model_mapping[raw] ?? "uncertain";
}

export function featureShardFile(shard: number, of: number): string {
  return join(cacheDir(), `features-v${DESK_FEATURE_VERSION}-${shard}-of-${of}.jsonl`);
}

export function featureShardFiles(): string[] {
  const dir = cacheDir();
  const pattern = new RegExp(`^features-v${DESK_FEATURE_VERSION}-\\d+-of-\\d+\\.jsonl$`);
  return readdirSync(dir)
    .filter((name) => pattern.test(name))
    .sort()
    .map((name) => join(dir, name));
}

export interface ReadFeatureRowsOptions {
  /**
   * First-person webcam captures (`bucket: "first_person"`) are EXCLUDED by
   * default. The presence head, its eval and every diagnostic in this folder
   * were trained and measured without them, and appending rows to the shared
   * feature cache must not silently move their numbers. The attention trainer
   * and the attention eval opt in.
   */
  includeFirstPerson?: boolean;
}

export function readFeatureRows(
  files: string[] = featureShardFiles(),
  options: ReadFeatureRowsOptions = {},
): FeatureRow[] {
  const rows: FeatureRow[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const row = JSON.parse(trimmed) as FeatureRow;
      if (options.includeFirstPerson !== true && row.bucket === FIRST_PERSON_BUCKET) {
        continue;
      }
      if (!seen.has(row.path)) {
        seen.add(row.path);
        rows.push(row);
      }
    }
  }
  return rows;
}

export interface Standardization {
  mean: Float64Array;
  std: Float64Array;
  /** How many vectors were summed. The ONLY divisor either statistic uses. */
  count: number;
}

/**
 * Per-feature mean and standard deviation over the train pool.
 *
 * The divisor is derived from the very array that was summed, so the two can
 * never disagree. That is not hypothetical: the attention trainer used to sum
 * over a Map keyed by the feature-row OBJECT (which silently collapses two
 * rows sharing one cached vector) while dividing by the un-collapsed pair
 * count, so a single duplicated path in the labels CSV mis-standardized EVERY
 * sample in the run — stock rows included — and the head degraded quietly.
 */
export function standardization(
  vectors: ReadonlyArray<ArrayLike<number>>,
  dim: number,
): Standardization {
  const mean = new Float64Array(dim);
  const std = new Float64Array(dim);
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) {
      mean[i] = (mean[i] ?? 0) + (vector[i] ?? 0);
    }
  }
  const count = vectors.length;
  for (let i = 0; i < dim; i += 1) {
    mean[i] = (mean[i] ?? 0) / (count > 0 ? count : 1);
  }
  for (const vector of vectors) {
    for (let i = 0; i < dim; i += 1) {
      const diff = (vector[i] ?? 0) - (mean[i] ?? 0);
      std[i] = (std[i] ?? 0) + diff * diff;
    }
  }
  for (let i = 0; i < dim; i += 1) {
    std[i] = Math.sqrt((std[i] ?? 0) / (count > 0 ? count : 1));
  }
  return { mean, std, count };
}

/** z-scores one vector; a feature with no spread passes through unscaled. */
export function standardize(vector: ArrayLike<number>, stats: Standardization): Float64Array {
  const dim = stats.mean.length;
  const x = new Float64Array(dim);
  for (let i = 0; i < dim; i += 1) {
    const s = stats.std[i] ?? 1;
    x[i] = ((vector[i] ?? 0) - (stats.mean[i] ?? 0)) / (s > 1e-6 ? s : 1);
  }
  return x;
}

/** Deterministic PRNG — training must be reproducible run to run. */
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

export function shuffled<T>(items: T[], rand: () => number): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    const a = copy[i] as T;
    copy[i] = copy[j] as T;
    copy[j] = a;
  }
  return copy;
}

export interface EvalMetrics {
  total: number;
  correct: number;
  accuracy: number;
  perClass: Record<string, { total: number; correct: number; accuracy: number }>;
  confusion: Record<string, Record<string, number>>;
}

export function scorePredictions(
  labels: readonly string[],
  pairs: Array<{ truth: string; predicted: string }>,
): EvalMetrics {
  const perClass: EvalMetrics["perClass"] = {};
  const confusion: EvalMetrics["confusion"] = {};
  for (const label of labels) {
    perClass[label] = { total: 0, correct: 0, accuracy: 0 };
    confusion[label] = {};
    for (const other of labels) {
      confusion[label][other] = 0;
    }
  }
  let correct = 0;
  for (const { truth, predicted } of pairs) {
    const cls = perClass[truth] ?? { total: 0, correct: 0, accuracy: 0 };
    perClass[truth] = cls;
    cls.total += 1;
    const row = (confusion[truth] = confusion[truth] ?? {});
    row[predicted] = (row[predicted] ?? 0) + 1;
    if (truth === predicted) {
      cls.correct += 1;
      correct += 1;
    }
  }
  for (const label of Object.keys(perClass)) {
    const cls = perClass[label];
    if (cls) {
      cls.accuracy = cls.total > 0 ? cls.correct / cls.total : 0;
    }
  }
  return {
    total: pairs.length,
    correct,
    accuracy: pairs.length > 0 ? correct / pairs.length : 0,
    perClass,
    confusion,
  };
}

/** One row of `datasets/desk-attention-labels.csv` (written by adaption-label.py export). */
export interface AttentionLabelRow {
  path: string;
  split: "train" | "eval";
  /** Near-duplicate group; every member shares one split. */
  group: string;
  /** focused / unfocused / phone, or "" when the image is not a usable example. */
  attention: string;
  person: string;
  workspace: string;
  phone: string;
  gaze: string;
  note: string;
  packLabel: string;
}

export function attentionLabelsFile(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "datasets", "desk-attention-labels.csv");
}

/** RFC 4180 CSV: quoted fields may hold commas, quotes ("") and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") {
        i += 1;
      }
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export function readAttentionLabels(file: string = attentionLabelsFile()): AttentionLabelRow[] {
  const [header, ...rows] = parseCsv(readFileSync(file, "utf8"));
  const column = (name: string): number => {
    const index = header?.indexOf(name) ?? -1;
    if (index < 0) {
      throw new Error(`${file} has no ${name} column`);
    }
    return index;
  };
  const index = {
    path: column("path"),
    split: column("split"),
    group: column("group"),
    attention: column("attention"),
    person: column("person"),
    workspace: column("workspace"),
    phone: column("phone"),
    gaze: column("gaze"),
    note: column("note"),
    packLabel: column("pack_label"),
  };
  return rows
    .filter((cells) => cells.length > 1)
    .map((cells) => ({
      path: cells[index.path] ?? "",
      split: cells[index.split] === "eval" ? "eval" : "train",
      group: cells[index.group] ?? "",
      attention: cells[index.attention] ?? "",
      person: cells[index.person] ?? "",
      workspace: cells[index.workspace] ?? "",
      phone: cells[index.phone] ?? "",
      gaze: cells[index.gaze] ?? "",
      note: cells[index.note] ?? "",
      packLabel: cells[index.packLabel] ?? "",
    }));
}

export function formatMetrics(name: string, metrics: EvalMetrics): string {
  const lines = [
    `${name}: ${(metrics.accuracy * 100).toFixed(2)}% (${metrics.correct}/${metrics.total})`,
  ];
  for (const [label, cls] of Object.entries(metrics.perClass)) {
    if (cls.total > 0) {
      lines.push(
        `  ${label.padEnd(10)} ${(cls.accuracy * 100).toFixed(2).padStart(6)}% (${cls.correct}/${cls.total})`,
      );
    }
  }
  return lines.join("\n");
}
