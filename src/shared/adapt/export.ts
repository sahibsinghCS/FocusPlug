/**
 * Write the drift dataset to disk.
 *
 *   npm run dataset:adapt
 *   npm run dataset:adapt -- --students 400 --drifts 60 --out datasets
 *
 * Rows are produced by running the real `chooseFuse` policy against the
 * simulated population, so the file has the same shape a device would log —
 * including the censoring that matters: when the fuse fires first you never find
 * out whether they were about to come back, and `recovered_after_sec` is empty.
 * A dataset without that property would train a model that cannot exist.
 *
 * Nothing here is real user data. The simulated population is hand-written (see
 * `population.ts`); exporting genuine drifts off someone's machine would need
 * their explicit consent and is not what this script does.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { momentToRow, summarise, toCsv, toJsonl, type DriftRow } from "./dataset";
import { chooseFuse } from "./fuse";
import { createModel, type AdaptiveModel } from "./model";
import { momentFor, population } from "./population";
import { observeDrift } from "./train";

const SHIPPED_FUSE = 10;

/** Habit names have spaces and commas in them; cohort ends up in a CSV cell. */
function slug(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase();
}

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return fallback;
  }
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function stringArg(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

const students = arg("students", 240);
const driftsEach = arg("drifts", 40);
const outDir = stringArg("out", "datasets");

const rows: DriftRow[] = [];

population({ students, driftsEach }).forEach((student, studentIndex) => {
  let model: AdaptiveModel = createModel();
  const history = { priorDrifts: 0, priorKills: 0 };

  student.drifts.forEach((drift, driftIndex) => {
    // Spread drifts across days, and land each one on the hour it was drawn for
    // so ts_iso and the hour column cannot disagree. Treated as UTC throughout:
    // a file with a local-time column and a UTC timestamp is a trap.
    const at = Date.UTC(2026, 8, 1 + studentIndex, drift.covariates.hour, (driftIndex * 7) % 60);
    const moment = momentFor(drift, at, SHIPPED_FUSE, history);
    const choice = chooseFuse(model, moment, SHIPPED_FUSE);
    const latent = drift.latentRecoverySec;
    const observed = latent !== null && latent <= choice.seconds ? latent : null;
    const logged = { ...moment, fuseSec: choice.seconds };

    rows.push(
      momentToRow(
        logged,
        { recoveredAfterSec: observed },
        {
          driftId: `s${String(studentIndex).padStart(4, "0")}-d${String(driftIndex).padStart(3, "0")}`,
          cohort: `sim:${slug(student.habit.name)}`,
        },
      ),
    );

    model = observeDrift(model, logged, {
      recoveredAfterSec: observed,
      fuseSec: choice.seconds,
      probed: choice.exploring,
    });
    history.priorDrifts += 1;
    if (observed === null) {
      history.priorKills += 1;
    }
  });
});

mkdirSync(outDir, { recursive: true });
const csvPath = join(outDir, "focusplug-drifts.csv");
const jsonlPath = join(outDir, "focusplug-drifts.jsonl");
writeFileSync(csvPath, toCsv(rows), "utf8");
writeFileSync(jsonlPath, toJsonl(rows), "utf8");

const summary = summarise(rows);
console.log(`wrote ${csvPath}`);
console.log(`wrote ${jsonlPath}`);
console.log("");
console.log(`  rows            ${summary.rows}`);
console.log(
  `  recovered       ${summary.recovered} (${((summary.recovered / summary.rows) * 100).toFixed(1)}%) — the countdown was cancelled`,
);
console.log(
  `  killed          ${summary.killed} (${((summary.killed / summary.rows) * 100).toFixed(1)}%) — censored: no idea if they were about to return`,
);
console.log(`  mean fuse       ${summary.meanFuseSec.toFixed(1)}s`);
console.log(
  `  median recovery ${summary.medianRecoverySec === null ? "n/a" : `${summary.medianRecoverySec.toFixed(1)}s`} (observed recoveries only, so biased short by the censoring)`,
);
console.log(`  cohorts         ${summary.cohorts.join(", ")}`);

if (summary.problems.length > 0) {
  console.log(`\n  ${summary.problems.length} suspect rows:`);
  for (const problem of summary.problems.slice(0, 10)) {
    console.log(`    ${problem}`);
  }
  process.exitCode = 1;
}
