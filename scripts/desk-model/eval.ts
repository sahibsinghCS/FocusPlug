import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/shared/defaults";
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

/**
 * How good each presence model's `away` call is — the number the drift pause
 * is proportioned against, which 3-way accuracy hides.
 *
 * `away` is the one desk reading allowed to stop a student's study clock, and
 * a wrong one costs them the round they were working through. What decides
 * that is not overall accuracy but the **precision** of the `away` call: of
 * the frames the model calls `away`, how many really are. The shipped
 * `blazeface` baseline has no `away` class at all — `classifyDesk` answers
 * `away` whenever no usable face is in the frame — so this is also where that
 * shows up. `atFloor` re-scores the same calls through the shipped
 * `pauseAwayConfidence`, because a floor is only a guard if the wrong calls
 * are the ones below it. See `deskModelMayPauseOnAway` in
 * `src/shared/nudge.ts`, which is what the answer here decided.
 */
interface AwayCallQuality {
  floor: number;
  awayCalls: number;
  awayCorrect: number;
  precision: number;
  recall: number;
  atDeskFrames: number;
  atDeskCalledAway: number;
  awayCallsAtFloor: number;
  wrongAwayCallsAtFloor: number;
  wrongAwayCallsScreenedByFloor: number;
}

function awayCallQuality(
  calls: Array<{ truth: string; predicted: string; confidence: number }>,
  floor: number,
): AwayCallQuality {
  const aways = calls.filter((call) => call.predicted === "away");
  const right = aways.filter((call) => call.truth === "away").length;
  const truthAway = calls.filter((call) => call.truth === "away").length;
  const atDesk = calls.filter((call) => call.truth === "at_desk");
  const atFloor = aways.filter((call) => call.confidence >= floor);
  const atFloorRight = atFloor.filter((call) => call.truth === "away").length;
  return {
    floor,
    awayCalls: aways.length,
    awayCorrect: right,
    precision: aways.length > 0 ? right / aways.length : 0,
    recall: truthAway > 0 ? right / truthAway : 0,
    atDeskFrames: atDesk.length,
    atDeskCalledAway: atDesk.filter((call) => call.predicted === "away").length,
    // What the confidence floor actually removes: wrong away calls above it
    // are the ones a sustained-drift pause would act on.
    awayCallsAtFloor: atFloor.length,
    wrongAwayCallsAtFloor: atFloor.length - atFloorRight,
    wrongAwayCallsScreenedByFloor: aways.length - right - (atFloor.length - atFloorRight),
  };
}

function formatAway(name: string, b: AwayCallQuality): string {
  const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;
  return (
    `away call — ${name}: ${b.awayCorrect}/${b.awayCalls} correct ` +
    `(precision ${pct(b.precision)}, recall ${pct(b.recall)}); ` +
    `${b.atDeskCalledAway}/${b.atDeskFrames} at-desk frames called away ` +
    `(${pct(b.atDeskCalledAway / Math.max(1, b.atDeskFrames))}); ` +
    `at pauseAwayConfidence ${b.floor}: ${b.awayCallsAtFloor} calls, ` +
    `${b.wrongAwayCallsAtFloor} of them wrong ` +
    `(the floor screens ${b.wrongAwayCallsScreenedByFloor})`
  );
}

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

  // The pause-relevant view of the same predictions.
  const floor = DEFAULT_SETTINGS.pauseAwayConfidence;
  const awayQuality = {
    custom: awayCallQuality(
      rows.map((row) => {
        const prediction = deskHeadPredict(weights, row.vector);
        return { truth: row.mapped, predicted: prediction.label as string, confidence: prediction.confidence };
      }),
      floor,
    ),
    baseline: awayCallQuality(
      rows.map((row) => ({
        truth: row.mapped,
        predicted: row.baseLabel,
        confidence: row.baseConfidence,
      })),
      floor,
    ),
  };
  console.log(formatAway("custom head", awayQuality.custom));
  console.log(formatAway("blazeface heuristic baseline", awayQuality.baseline));

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
    awayQuality,
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
