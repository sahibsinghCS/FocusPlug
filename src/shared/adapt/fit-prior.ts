/**
 * Fit the shipped prior from a dataset file and show whether it is any better
 * than the hand-set one.
 *
 *   npm run prior:adapt -- datasets/focusplug-drifts.csv
 *
 * Point it at a file that has been through something that improves datasets and
 * it will tell you, on held-out drifts, whether the improvement survived contact
 * with the model. If the log-loss does not move, the new data did not help —
 * which is a result worth having before pasting anything into `model.ts`.
 */

import { readFileSync } from "node:fs";

import { parseCsv, parseJsonl, summarise, type DriftRow } from "./dataset";
import { fitPrior, printableWeights } from "./prior";

const path = process.argv[2];
if (path === undefined) {
  console.error("usage: npm run prior:adapt -- <datasets/file.csv|.jsonl>");
  process.exit(1);
}

const text = readFileSync(path, "utf8");
let rows: DriftRow[];
try {
  rows = path.endsWith(".jsonl") ? parseJsonl(text) : parseCsv(text);
} catch (error) {
  console.error(`could not read ${path}: ${(error as Error).message}`);
  process.exit(1);
}

if (rows.length < 50) {
  console.error(`${path} has ${rows.length} rows — too few to fit seventeen weights on`);
  process.exit(1);
}

const summary = summarise(rows);
console.log(`FIT PRIOR FROM ${path}`);
console.log(
  `  ${summary.rows} drifts · ${summary.recovered} recovered, ${summary.killed} censored · cohorts: ${summary.cohorts.join(", ")}\n`,
);

if (summary.problems.length > 0) {
  console.log(`  ${summary.problems.length} suspect rows (first few):`);
  for (const problem of summary.problems.slice(0, 5)) {
    console.log(`    ${problem}`);
  }
  console.log("");
}

const report = fitPrior(rows);

console.log(`  trained on ${report.trainDrifts} drifts, scored on ${report.holdoutDrifts} held out`);
console.log(`  (${report.holdoutExamples} held-out examples after fuse expansion)\n`);
console.log("  held-out log-loss   lower is better");
console.log(`    hand-set prior    ${report.shippedLogLoss.toFixed(4)}`);
console.log(`    fitted prior      ${report.fittedLogLoss.toFixed(4)}`);
console.log("  held-out accuracy");
console.log(`    hand-set prior    ${(report.shippedAccuracy * 100).toFixed(1)}%`);
console.log(`    fitted prior      ${(report.fittedAccuracy * 100).toFixed(1)}%`);

const better = report.fittedLogLoss < report.shippedLogLoss;
const delta = Math.abs(report.shippedLogLoss - report.fittedLogLoss);
console.log("");
if (better && delta > 0.005) {
  console.log(
    `  the fitted prior is better by ${delta.toFixed(4)} log-loss. Paste this into model.ts,\n` +
      `  raise FEATURE_LAYOUT so stored models are discarded, and re-run gauntlet:adapt:\n`,
  );
  console.log(printableWeights(report.weights));
} else if (better) {
  console.log(
    `  the fitted prior is better by only ${delta.toFixed(4)} log-loss — not worth shipping.\n` +
      `  The hand-set prior is already about as good as this dataset can justify.`,
  );
} else {
  console.log(
    `  the hand-set prior is still better by ${delta.toFixed(4)} log-loss. Keep it.\n` +
      `  Either the dataset is too small, too clean, or its drifts do not look like the prior's world.`,
  );
}

console.log(
  "\n  Remember what this can and cannot say: fitting on simulated drifts recovers the\n" +
    "  simulator's assumptions. It is evidence about the pipeline, not about students.",
);
