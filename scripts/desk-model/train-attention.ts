import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyInputSlices,
  ATTENTION_HEAD_LABELS,
  type DeskHeadWeights,
} from "../../src/main/desk/model/your-model";
import {
  attentionLabelsFile,
  formatMetrics,
  mulberry32,
  readAttentionLabels,
  readFeatureRows,
  scorePredictions,
  shuffled,
  type AttentionLabelRow,
  type FeatureRow,
} from "./lib";
import {
  argmax,
  balancedAccuracy,
  createLayers,
  forward,
  serializeLayers,
  trainMlp,
  type Sample,
} from "./mlp";

/**
 * Trainer for the attention head: focused / unfocused / phone.
 *
 * Labels are Adaption Labs annotations of the desk-data pack
 * (`datasets/desk-attention-labels.csv`, made by adaption-label.py). Inputs
 * are the same cached `extractDeskFeatures` vectors the presence head reads,
 * so at runtime the head costs one small matrix multiply and no extra model.
 * Only `split: "train"` rows are touched; eval-attention.ts scores the rest.
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/train-attention.ts --hidden 0 --l2 0.01 --slices 745-2025
 */

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..");
}

function stringArg(flag: string, fallback: string): string {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] !== undefined ? (process.argv[index + 1] as string) : fallback;
}

function numberArg(flag: string, fallback: number): number {
  const parsed = Number(stringArg(flag, String(fallback)));
  return Number.isFinite(parsed) ? parsed : fallback;
}

const config = {
  /** Comma-separated hidden sizes; "0" trains a linear softmax. */
  hidden: stringArg("--hidden", "32")
    .split(",")
    .map((part) => Number(part.trim()))
    .filter((size) => Number.isFinite(size) && size > 0),
  epochs: numberArg("--epochs", 400),
  lr: numberArg("--lr", 0.001),
  batch: numberArg("--batch", 64),
  seed: numberArg("--seed", 42),
  l2: numberArg("--l2", 0.001),
  patience: numberArg("--patience", 60),
  valFraction: numberArg("--val", 0.15),
  /** Feature ranges to train on, e.g. "745-2025" = the MobileNet embedding alone. */
  slices: ((): Array<[number, number]> | null => {
    const parsed = stringArg("--slices", "")
      .split(",")
      .filter((part) => part.includes("-"))
      .map((part) => part.split("-").map((n) => Number(n.trim())))
      .filter((pair) => pair.length === 2 && pair.every((n) => Number.isFinite(n)))
      .map((pair) => [pair[0] as number, pair[1] as number] as [number, number]);
    return parsed.length > 0 ? parsed : null;
  })(),
  labels: stringArg("--labels", attentionLabelsFile()),
  out: stringArg(
    "--out",
    join(repoRoot(), "src", "main", "desk", "model", "weights", "attention-head.json"),
  ),
};

interface AttentionSample extends Sample {
  row: FeatureRow;
  label: AttentionLabelRow;
}

async function main(): Promise<void> {
  const labels = [...ATTENTION_HEAD_LABELS];
  const annotations = readAttentionLabels(config.labels).filter(
    (row) => row.split === "train" && (labels as string[]).includes(row.attention),
  );
  const features = new Map(readFeatureRows().map((row) => [row.path, row]));
  const pairs = annotations
    .map((label) => ({ label, row: features.get(label.path) }))
    .filter((pair): pair is { label: AttentionLabelRow; row: FeatureRow } => pair.row !== undefined);
  if (pairs.length === 0) {
    throw new Error("No labelled train rows with cached features — run adaption-label.py export and extract-features.ts");
  }
  const projected = new Map(
    pairs.map(({ row }) => [row, applyInputSlices(config.slices ?? undefined, row.vector)]),
  );
  const dim = projected.get(pairs[0]?.row as FeatureRow)?.length ?? 0;

  // Standardization from the train pool only.
  const mean = new Float64Array(dim);
  const std = new Float64Array(dim);
  for (const vector of projected.values()) {
    for (let i = 0; i < dim; i += 1) {
      mean[i] = (mean[i] ?? 0) + (vector[i] ?? 0);
    }
  }
  for (let i = 0; i < dim; i += 1) {
    mean[i] = (mean[i] ?? 0) / pairs.length;
  }
  for (const vector of projected.values()) {
    for (let i = 0; i < dim; i += 1) {
      const diff = (vector[i] ?? 0) - (mean[i] ?? 0);
      std[i] = (std[i] ?? 0) + diff * diff;
    }
  }
  for (let i = 0; i < dim; i += 1) {
    std[i] = Math.sqrt((std[i] ?? 0) / pairs.length);
  }
  const toSample = ({ label, row }: { label: AttentionLabelRow; row: FeatureRow }): AttentionSample => {
    const vector = projected.get(row) as number[];
    const x = new Float64Array(dim);
    for (let i = 0; i < dim; i += 1) {
      const s = std[i] ?? 1;
      x[i] = ((vector[i] ?? 0) - (mean[i] ?? 0)) / (s > 1e-6 ? s : 1);
    }
    return { x, y: labels.indexOf(label.attention as (typeof labels)[number]), weight: 1, row, label };
  };

  // Validation split by near-duplicate group, stratified by class, so model
  // selection never scores a copy of a training image.
  const rand = mulberry32(config.seed);
  const groupsByClass = new Map<string, AttentionSample[][]>();
  const groups = new Map<string, AttentionSample[]>();
  for (const sample of pairs.map(toSample)) {
    const group = groups.get(sample.label.group) ?? [];
    group.push(sample);
    groups.set(sample.label.group, group);
  }
  for (const key of [...groups.keys()].sort()) {
    const members = groups.get(key) as AttentionSample[];
    const cls = (members[0] as AttentionSample).label.attention;
    const list = groupsByClass.get(cls) ?? [];
    list.push(members);
    groupsByClass.set(cls, list);
  }
  const trainSamples: AttentionSample[] = [];
  const valSamples: AttentionSample[] = [];
  for (const cls of [...groupsByClass.keys()].sort()) {
    const mixed = shuffled(groupsByClass.get(cls) ?? [], rand);
    const valCount = Math.max(1, Math.round(mixed.length * config.valFraction));
    mixed.forEach((members, index) => (index < valCount ? valSamples : trainSamples).push(...members));
  }

  const classCounts = new Map<number, number>();
  for (const sample of trainSamples) {
    classCounts.set(sample.y, (classCounts.get(sample.y) ?? 0) + 1);
  }
  for (const sample of trainSamples) {
    const count = classCounts.get(sample.y) ?? 1;
    sample.weight = Math.min(4, Math.max(0.5, trainSamples.length / (labels.length * count)));
  }

  const sizes = [dim, ...config.hidden, labels.length];
  const layers = createLayers(sizes, rand);
  console.log(
    `train ${trainSamples.length} / val ${valSamples.length} | ${labels
      .map((label, y) => `${label} ${classCounts.get(y) ?? 0}`)
      .join(", ")} | arch ${sizes.join("-")} | l2 ${config.l2} | slices ${JSON.stringify(config.slices)} | seed ${config.seed}`,
  );

  const best = trainMlp(layers, trainSamples, config, rand, (current) => {
    const val = balancedAccuracy(current, valSamples);
    return {
      score: val.balanced,
      line: `val bal ${(val.balanced * 100).toFixed(2)}% acc ${(val.accuracy * 100).toFixed(2)}%`,
    };
  });

  const weights: DeskHeadWeights = {
    version: 2,
    featureDim: dim,
    labels,
    ...(config.slices ? { inputSlices: config.slices } : {}),
    mean: [...mean].map((value) => Number(value.toPrecision(8))),
    std: [...std].map((value) => Number(value.toPrecision(8))),
    layers: serializeLayers(best.layers),
  };
  mkdirSync(dirname(config.out), { recursive: true });
  writeFileSync(config.out, JSON.stringify(weights));

  const valMetrics = scorePredictions(
    labels,
    valSamples.map((sample) => ({
      truth: labels[sample.y] as string,
      predicted: labels[argmax(forward(best.layers, sample.x).probs)] as string,
    })),
  );
  console.log(formatMetrics("val (best epoch)", valMetrics));

  const report = {
    trainedAt: new Date().toISOString(),
    config: { ...config, labels: undefined, out: undefined, arch: sizes },
    labelSource: "Adaption Labs Adaptive Data annotations — datasets/desk-attention-labels.csv",
    dataset: {
      train: trainSamples.length,
      val: valSamples.length,
      perClass: Object.fromEntries(labels.map((label, y) => [label, classCounts.get(y) ?? 0])),
    },
    bestEpoch: best.epoch,
    bestScore: best.score,
    valMetrics,
  };
  writeFileSync(config.out.replace(/\.json$/, ".metrics.json"), JSON.stringify(report, null, 2));
  console.log(`weights -> ${config.out}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
