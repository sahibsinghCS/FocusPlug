import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FORECAST_FEATURE_KEYS } from "../../../../src/shared/forecast/types";
import { FORECAST_INPUT_DIM, forward, parseForecastWeights } from "../../../../src/shared/forecast/model";
import { ece10, logisticScore, prAuc, repoRoot, rocAuc, round4, trainLogistic } from "../../lib";
import { candidateDir, loadDataset, loadRawIndex } from "./data";
import {
  addTotals,
  escalationSettings,
  leadAuc,
  newAlarmTotals,
  simulateAlarms,
  summarizeAlarms,
} from "./metrics";

/**
 * Parity harness — proves this candidate's metric code is the shipped metric
 * code before any of its own numbers are believed.
 *
 * It scores the COMMITTED `src/shared/forecast/weights.json` through the same
 * loaders, the same `lib.rocAuc`, the same lead-censored eligibility rule and
 * the same escalation-reducer alarm loop this contender uses, and prints them
 * next to `src/shared/forecast/eval-report.json`. Every shared number must
 * match to the reported precision; a mismatch means the contender's numbers
 * are measured on a different ruler and cannot be compared.
 *
 * It also prints the full 18-feature logistic ceiling (0.9325 in the committed
 * report) on the identical eligibility set.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/candidates/mlp-tuned/parity.ts
 */

async function main(): Promise<void> {
  const startedAt = Date.now();
  const { train, evalRows } = await loadDataset();
  const { replays } = await loadRawIndex(42);
  const evalReplays = replays.filter((session) => session.split === "eval");

  const weights = parseForecastWeights(
    JSON.parse(readFileSync(join(repoRoot(), "src", "shared", "forecast", "weights.json"), "utf8")),
  );
  if (weights === null) {
    throw new Error("committed weights.json failed parseForecastWeights");
  }
  const committed = JSON.parse(
    readFileSync(join(repoRoot(), "src", "shared", "forecast", "eval-report.json"), "utf8"),
  ) as {
    metrics: Record<string, number>;
    alarms: Record<string, number>;
    baselines: { fullLogistic18: { leadAuc20: number }; bestSingleFeatureLogistic: { feature: string; leadAuc20: number } };
  };

  const row = new Array<number>(FORECAST_INPUT_DIM);
  const scores = new Float64Array(evalRows.n);
  for (let i = 0; i < evalRows.n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      row[f] = evalRows.x[i * FORECAST_INPUT_DIM + f] as number;
    }
    scores[i] = forward(weights, row).rawRisk;
  }
  const scoreList = Array.from(scores);
  const labelList = Array.from(evalRows.y);

  const cap = 40_000;
  const stride = Math.max(1, Math.ceil(train.n / cap));
  const subX: number[][] = [];
  const subY: number[] = [];
  for (let i = 0; i < train.n; i += stride) {
    const r: number[] = [];
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      r.push(train.x[i * FORECAST_INPUT_DIM + f] as number);
    }
    subX.push(r);
    subY.push(train.y[i] as number);
  }
  const columns = FORECAST_FEATURE_KEYS.map((_, i) => i);
  const lr = trainLogistic(subX, subY, columns);
  const lrScores = new Float64Array(evalRows.n);
  for (let i = 0; i < evalRows.n; i += 1) {
    for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
      row[f] = evalRows.x[i * FORECAST_INPUT_DIM + f] as number;
    }
    lrScores[i] = logisticScore(lr, row, columns);
  }

  const frameBuf = new Float64Array(FORECAST_INPUT_DIM);
  const totals = newAlarmTotals();
  for (const session of evalReplays) {
    addTotals(
      totals,
      simulateAlarms(
        session,
        (values, offset) => {
          for (let f = 0; f < FORECAST_INPUT_DIM; f += 1) {
            frameBuf[f] = values[offset + f] as number;
          }
          return forward(weights, Array.from(frameBuf)).rawRisk;
        },
        escalationSettings(0.55, 0.8),
      ),
    );
  }
  const alarms = summarizeAlarms(totals);

  const measured = {
    rocAuc: round4(rocAuc(scoreList, labelList)),
    prAuc: round4(prAuc(scoreList, labelList)),
    aucLead20: round4(leadAuc(scores, evalRows.y, evalRows.secs, 20)),
    aucLead10: round4(leadAuc(scores, evalRows.y, evalRows.secs, 10)),
    ece: round4(ece10(scoreList, labelList).ece),
    evalFrames: evalRows.n,
    recallAt30Prearm: alarms.recallAt30Prearm,
    recallAt30Nudge: alarms.recallAt30Nudge,
    falsePrearmsPerHour: alarms.falsePrearmsPerHour,
    nudgesPerHour: alarms.nudgesPerHour,
    fullLogistic18AucLead20: round4(leadAuc(lrScores, evalRows.y, evalRows.secs, 20)),
  };
  const expected = {
    rocAuc: committed.metrics.rocAuc,
    prAuc: committed.metrics.prAuc,
    aucLead20: committed.metrics.aucLead20,
    aucLead10: committed.metrics.aucLead10,
    ece: committed.metrics.ece,
    evalFrames: committed.metrics.evalFrames,
    recallAt30Prearm: committed.alarms.recallAt30,
    recallAt30Nudge: null, // eval.ts does not report a nudge-level recall
    falsePrearmsPerHour: committed.alarms.falsePrearmsPerHour,
    nudgesPerHour: committed.alarms.nudgesPerHour,
    fullLogistic18AucLead20: committed.baselines.fullLogistic18.leadAuc20,
  };

  const mismatches: string[] = [];
  for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
    const want = expected[key];
    if (want === null) {
      continue;
    }
    if (measured[key] !== want) {
      mismatches.push(`${key}: harness ${measured[key]} vs committed ${want}`);
    }
  }

  const out = {
    parity: mismatches.length === 0 ? "MATCH" : "MISMATCH",
    mismatches,
    measuredOnShippedWeights: measured,
    committedEvalReport: expected,
    note: "the nudge-level recall has no counterpart in eval.ts; it is this contender's definition applied to the shipped weights, and is the number mlp-tuned must beat",
    runtimeSec: round4((Date.now() - startedAt) / 1000),
  };
  writeFileSync(join(candidateDir(), "parity.json"), `${JSON.stringify(out, null, 2)}\n`);
  console.log(JSON.stringify(out, null, 2));
  if (mismatches.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
