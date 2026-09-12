import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ATTENTION_HEAD_LABELS,
  attentionHeadPredict,
  loadDeskHeadWeights,
} from "../../src/main/desk/model/your-model";
import { deskRoot } from "../../src/main/desk/assets";
import {
  cacheDir,
  formatMetrics,
  readAttentionLabels,
  readFeatureRows,
  scorePredictions,
} from "./lib";

/**
 * Held-out eval for the attention head. Scores ONLY `split: "eval"` rows of
 * datasets/desk-attention-labels.csv, whose near-duplicate groups never
 * straddle the split.
 *
 * Truth here is Adaption Labs' annotation, not a human label — the report
 * says so, and says how often the pack's own `distracted` label agrees.
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/eval-attention.ts
 */

interface Binary {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

function binary(pairs: Array<{ truth: boolean; predicted: boolean }>): Binary {
  const tp = pairs.filter((pair) => pair.truth && pair.predicted).length;
  const fp = pairs.filter((pair) => !pair.truth && pair.predicted).length;
  const fn = pairs.filter((pair) => pair.truth && !pair.predicted).length;
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  return {
    precision,
    recall,
    f1: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
    support: tp + fn,
  };
}

function formatBinary(name: string, value: Binary): string {
  return `${name}: precision ${(value.precision * 100).toFixed(1)}% · recall ${(value.recall * 100).toFixed(1)}% · F1 ${(value.f1 * 100).toFixed(1)}% (${value.support} positives)`;
}

async function main(): Promise<void> {
  const file = join(deskRoot(), "model", "weights", "attention-head.json");
  const weights = loadDeskHeadWeights(file, ATTENTION_HEAD_LABELS);
  if (!weights) {
    throw new Error("attention-head.json not found — run train-attention.ts first");
  }
  const labels = [...ATTENTION_HEAD_LABELS] as string[];
  const features = new Map(readFeatureRows().map((row) => [row.path, row]));
  const rows = readAttentionLabels()
    .filter((row) => row.split === "eval" && labels.includes(row.attention))
    .flatMap((label) => {
      const feature = features.get(label.path);
      return feature ? [{ label, feature }] : [];
    });
  if (rows.length === 0) {
    throw new Error("No labelled eval rows with cached features");
  }

  const pairs = rows.map(({ label, feature }) => {
    const prediction = attentionHeadPredict(weights, feature.vector);
    return {
      path: label.path,
      truth: label.attention,
      predicted: prediction.label as string,
      confidence: prediction.confidence,
      workspace: label.workspace === "True" || label.workspace === "true",
      packLabel: label.packLabel,
    };
  });

  const overall = scorePredictions(labels, pairs);
  const workspace = scorePredictions(labels, pairs.filter((pair) => pair.workspace));
  const majority = labels
    .map((label) => ({ label, count: pairs.filter((pair) => pair.truth === label).length }))
    .sort((a, b) => b.count - a.count)[0]?.label as string;
  const majorityBaseline = scorePredictions(
    labels,
    pairs.map((pair) => ({ truth: pair.truth, predicted: majority })),
  );
  const phone = binary(pairs.map((pair) => ({ truth: pair.truth === "phone", predicted: pair.predicted === "phone" })));
  const offTask = binary(
    pairs.map((pair) => ({ truth: pair.truth !== "focused", predicted: pair.predicted !== "focused" })),
  );
  // What the pack's own label would have said, scored against the same truth.
  const packPhone = binary(
    pairs.map((pair) => ({ truth: pair.truth === "phone", predicted: pair.packLabel === "distracted" })),
  );

  console.log(formatMetrics("attention head (eval)", overall));
  console.log(formatMetrics("  at a workspace only", workspace));
  console.log(formatMetrics(`majority baseline (always ${majority})`, majorityBaseline));
  console.log(formatBinary("phone detection", phone));
  console.log(formatBinary("off task (unfocused or phone)", offTask));
  console.log(formatBinary("pack label `distracted` as a phone detector", packPhone));
  console.log("truth = Adaption Labs annotation; see datasets/desk-attention-labels.csv");

  const report = {
    evaluatedAt: new Date().toISOString(),
    truth: "Adaption Labs Adaptive Data annotation",
    overall,
    workspace,
    majorityBaseline,
    phone,
    offTask,
    packPhone,
    misses: pairs.filter((pair) => pair.truth !== pair.predicted),
  };
  const reportFile = join(cacheDir(), "attention-eval-report.json");
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`report -> ${reportFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
