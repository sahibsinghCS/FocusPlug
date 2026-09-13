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
  standardization,
  standardize,
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
import {
  census,
  censusLine,
  dedupeByPath,
  duplicatePathWarning,
  isFirstPersonRow,
} from "./first-person";

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
 *
 * FIRST-PERSON ROWS. Webcam clips recorded by capture-attention.ts sit in the
 * same CSV with no schema change, and are trained on like any other row —
 * `--first-person-weight`, `--exclude-first-person` and `--first-person-only`
 * change that, and their defaults (1, off, off) leave behaviour exactly as it
 * was. Their `group` is the clip id, so the group-aware validation split below
 * already refuses to put frames of one clip on both sides.
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
  /**
   * Cross-validation: with `--folds K`, groups are dealt into K folds and fold
   * `--fold i` is the validation slice. Pick settings on the mean over folds;
   * one small validation slice is too noisy to choose a model on.
   */
  folds: numberArg("--folds", 0),
  fold: numberArg("--fold", 0),
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
  /**
   * First-person webcam rows. Defaults are a no-op: weight 1, nothing
   * filtered — the head trains on exactly what it trained on before, plus
   * whatever clips are now in the CSV.
   */
  firstPersonWeight: numberArg("--first-person-weight", 1),
  excludeFirstPerson: process.argv.includes("--exclude-first-person"),
  firstPersonOnly: process.argv.includes("--first-person-only"),
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
  // One path is one image. A repeated path is one sample counted twice, and
  // standardization is computed over the whole pool, so a handful of them
  // would shift the mean and std of every feature for every row in the run.
  const distinct = dedupeByPath(readAttentionLabels(config.labels));
  const duplicates = duplicatePathWarning(distinct, config.labels);
  if (duplicates) {
    console.warn(duplicates);
  }
  const annotations = distinct.rows.filter(
    (row) =>
      row.split === "train" &&
      (labels as string[]).includes(row.attention) &&
      (config.excludeFirstPerson ? !isFirstPersonRow(row) : true) &&
      (config.firstPersonOnly ? isFirstPersonRow(row) : true),
  );
  const features = new Map(
    readFeatureRows(undefined, { includeFirstPerson: true }).map((row) => [row.path, row]),
  );
  const pairs = annotations
    .map((label) => ({ label, row: features.get(label.path) }))
    .filter((pair): pair is { label: AttentionLabelRow; row: FeatureRow } => pair.row !== undefined);
  if (pairs.length === 0) {
    throw new Error("No labelled train rows with cached features — run adaption-label.py export and extract-features.ts");
  }
  // A plain array, not a Map keyed by the feature row: two pairs sharing one
  // cached vector must stay two entries, so the population that is summed and
  // the count it is divided by are the same thing by construction.
  const projected = pairs.map(({ label, row }) => ({
    label,
    row,
    vector: applyInputSlices(config.slices ?? undefined, row.vector),
  }));
  const dim = projected[0]?.vector.length ?? 0;

  // Standardization from the train pool only.
  const stats = standardization(
    projected.map((entry) => entry.vector),
    dim,
  );
  const mean = stats.mean;
  const std = stats.std;
  const toSample = ({ label, row, vector }: (typeof projected)[number]): AttentionSample => ({
    x: standardize(vector, stats),
    y: labels.indexOf(label.attention as (typeof labels)[number]),
    weight: 1,
    row,
    label,
  });

  // Validation split by near-duplicate group, stratified by class, so model
  // selection never scores a copy of a training image.
  const rand = mulberry32(config.seed);
  const groupsByClass = new Map<string, AttentionSample[][]>();
  const groups = new Map<string, AttentionSample[]>();
  for (const sample of projected.map(toSample)) {
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
    const inVal = (index: number): boolean =>
      config.folds > 1 ? index % config.folds === config.fold : index < valCount;
    mixed.forEach((members, index) => (inVal(index) ? valSamples : trainSamples).push(...members));
  }

  if (trainSamples.length === 0) {
    // One group per class all lands in validation, which is what happens with
    // `--first-person-only` on a handful of clips. Say so instead of writing
    // weights fitted to nothing.
    throw new Error(
      `Every group went to validation (${valSamples.length} samples): there is nothing to train on. ` +
        "With only a clip or two per label there is no train/val split to make — record more clips (npm run capture:protocol).",
    );
  }

  const classCounts = new Map<number, number>();
  for (const sample of trainSamples) {
    classCounts.set(sample.y, (classCounts.get(sample.y) ?? 0) + 1);
  }
  for (const sample of trainSamples) {
    const count = classCounts.get(sample.y) ?? 1;
    const balance = Math.min(4, Math.max(0.5, trainSamples.length / (labels.length * count)));
    // --first-person-weight 1 (the default) leaves this identical to before.
    sample.weight = balance * (isFirstPersonRow(sample.label) ? config.firstPersonWeight : 1);
  }

  const firstPersonTrain = census(
    trainSamples.filter((sample) => isFirstPersonRow(sample.label)).map((sample) => sample.label),
  );
  const firstPersonVal = census(
    valSamples.filter((sample) => isFirstPersonRow(sample.label)).map((sample) => sample.label),
  );
  console.log(
    firstPersonTrain.frames + firstPersonVal.frames === 0
      ? "first-person: no webcam rows in the train split (stock photos only)"
      : `first-person train: ${censusLine(firstPersonTrain)} | val: ${censusLine(firstPersonVal)} | weight ${config.firstPersonWeight}`,
  );

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
      // Frames are not samples: one webcam clip is one independent group.
      firstPerson: { train: firstPersonTrain, val: firstPersonVal, weight: config.firstPersonWeight },
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
