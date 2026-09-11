import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DESK_FEATURE_VERSION } from "../../src/main/desk/model/your-model";

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

export function readFeatureRows(files: string[] = featureShardFiles()): FeatureRow[] {
  const rows: FeatureRow[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const row = JSON.parse(trimmed) as FeatureRow;
      if (!seen.has(row.path)) {
        seen.add(row.path);
        rows.push(row);
      }
    }
  }
  return rows;
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
