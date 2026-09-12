import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeImageBuffer } from "../../src/main/desk/frame";
import {
  deskHeadPredict,
  DESK_HEAD_LABELS,
  loadDeskHeadWeights,
  YourModel,
} from "../../src/main/desk/model/your-model";
import {
  dataRoot,
  formatMetrics,
  readFeatureRows,
  scorePredictions,
} from "./lib";

/**
 * Held-out eval for the custom desk head. Scores ONLY `split: "eval"` rows —
 * the bar (≥90% 3-way accuracy after desk_model_mapping) comes from the
 * dataset pack's labels.json.
 *
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/eval.ts          # cached features
 *   FOCUSPLUG_DESK_DATA=... tsx scripts/desk-model/eval.ts --e2e    # + full YourModel.infer pass
 */

const BAR = 0.9;

async function main(): Promise<void> {
  const e2e = process.argv.includes("--e2e");
  const weights = loadDeskHeadWeights();
  if (!weights) {
    throw new Error("desk-head.json not found — run train.ts first");
  }
  const labels = [...DESK_HEAD_LABELS];
  const rows = readFeatureRows().filter((row) => row.split === "eval");
  if (rows.length === 0) {
    throw new Error("No eval rows found — run extract-features.ts first");
  }

  const pairs = rows.map((row) => ({
    truth: row.mapped,
    predicted: deskHeadPredict(weights, row.vector).label as string,
    bucket: row.bucket,
    baseline: row.baseLabel,
    path: row.path,
  }));

  const overall = scorePredictions(labels, pairs);
  const baseline = scorePredictions(
    labels,
    pairs.map((pair) => ({ truth: pair.truth, predicted: pair.baseline })),
  );
  console.log(formatMetrics("custom head (eval)", overall));
  console.log(formatMetrics("blazeface heuristic baseline (eval)", baseline));

  const buckets: Record<string, ReturnType<typeof scorePredictions>> = {};
  for (const bucket of [...new Set(pairs.map((pair) => pair.bucket))].sort()) {
    buckets[bucket] = scorePredictions(
      labels,
      pairs.filter((pair) => pair.bucket === bucket),
    );
    console.log(formatMetrics(`bucket ${bucket}`, buckets[bucket] as never));
  }

  const misses = pairs
    .filter((pair) => pair.truth !== pair.predicted)
    .map((pair) => ({ path: pair.path, truth: pair.truth, predicted: pair.predicted }));

  let e2eBlock: object | null = null;
  if (e2e) {
    console.log(`e2e: running YourModel.infer over ${rows.length} eval images...`);
    const model = new YourModel();
    await model.init();
    const root = dataRoot();
    const e2ePairs: Array<{ truth: string; predicted: string }> = [];
    let mismatches = 0;
    let processed = 0;
    for (const row of rows) {
      const file = join(root, row.path);
      if (!existsSync(file)) {
        continue;
      }
      const frame = decodeImageBuffer(readFileSync(file));
      const output = await model.infer(frame);
      e2ePairs.push({ truth: row.mapped, predicted: output.label });
      const cached = pairs.find((pair) => pair.path === row.path);
      if (cached && cached.predicted !== output.label) {
        mismatches += 1;
      }
      processed += 1;
      if (processed % 100 === 0) {
        console.log(`e2e ${processed}/${rows.length}`);
      }
    }
    const e2eMetrics = scorePredictions(labels, e2ePairs);
    console.log(formatMetrics("e2e YourModel.infer (eval)", e2eMetrics));
    console.log(`e2e vs cached-feature prediction mismatches: ${mismatches}`);
    e2eBlock = { metrics: e2eMetrics, mismatchesVsCached: mismatches };
  }

  const report = {
    evaluatedAt: new Date().toISOString(),
    bar: BAR,
    pass: overall.accuracy >= BAR,
    overall,
    baseline,
    buckets,
    misses,
    e2e: e2eBlock,
  };
  const reportFile = join(
    join(dataRoot(), ".cache"),
    "eval-report.json",
  );
  writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`report -> ${reportFile}`);
  console.log(
    overall.accuracy >= BAR
      ? `BAR MET: ${(overall.accuracy * 100).toFixed(2)}% >= ${BAR * 100}%`
      : `BAR MISSED: ${(overall.accuracy * 100).toFixed(2)}% < ${BAR * 100}%`,
  );
  if (overall.accuracy < BAR && !process.argv.includes("--no-bar")) {
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
