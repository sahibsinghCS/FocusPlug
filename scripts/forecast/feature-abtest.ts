import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expandBasis } from "../../src/shared/forecast/model";
import { forward, parseForecastWeights } from "../../src/shared/forecast/model";
import { FORECAST_FEATURE_KEYS } from "../../src/shared/forecast/types";
import { pairedClusterBootstrap, type BootstrapModel } from "./bootstrap";
import {
  DATASET_FILE,
  forecastDataRoot,
  numberArg,
  readJsonl,
  repoRoot,
  rocAuc,
  round6,
  stringArg,
  type DatasetRow,
} from "./lib";

/**
 * ============================================================================
 * A/B: the shipped head BEFORE and AFTER the feature change, same eval split
 * ============================================================================
 *
 * `eval.ts` scores whatever is in `weights.json` today. It cannot tell you
 * whether the difference from yesterday's artifact is a measurement or noise,
 * because the two models were never put on the same resamples. This does that:
 * both heads score the SAME 48 held-out sessions, and the difference is read
 * off a PAIRED session-clustered bootstrap — the identical estimator
 * `adjudicate.ts` used to adjudicate the model bake-off, so the feature change
 * is judged by the same bar every architecture was.
 *
 * The baseline head is read straight out of git (`git show
 * <ref>:src/shared/forecast/weights.json`), so "before" is a commit, not a
 * remembered number. Its feature vector is the first `featureKeys.length`
 * columns of each dataset row: the feature list is append-only and
 * `make-fixtures.ts` re-verifies every pre-existing column bit-for-bit, so the
 * old head sees exactly the inputs it was fitted on.
 *
 * SELECTION SAFETY: this reports, it never chooses. Nothing in the shipped
 * model, the feature set or the operating point was picked using its output —
 * feature selection ran entirely on train-split sessions
 * (`feature-mine.ts` / `feature-confirm.ts`).
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/feature-abtest.ts
 */

const LEAD_SEC = 20;

interface Config {
  data: string;
  out: string;
  baselineRef: string;
  draws: number;
  seed: number;
}

function readConfig(): Config {
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    out: stringArg("--out", join(forecastDataRoot(), "feature-abtest.json")),
    baselineRef: stringArg("--baseline-ref", "HEAD"),
    draws: Math.max(1, Math.round(numberArg("--draws", 2000))),
    seed: numberArg("--seed", 42),
  };
}

/** A frozen `lr{d}+pairwise` head, read from git — d taken from its own file. */
interface BaselineHead {
  dim: number;
  basis: string;
  coefficients: number[];
  intercept: number;
  a: number;
  b: number;
}

function readBaseline(ref: string): BaselineHead {
  const text = execSync(`git show ${ref}:src/shared/forecast/weights.json`, {
    cwd: repoRoot(),
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const raw = JSON.parse(text) as {
    featureKeys: string[];
    coefficients: number[];
    intercept: number;
    calibration: { a: number; b: number };
    basis: string;
  };
  const dim = raw.featureKeys.length;
  const expected = dim + (dim * (dim + 1)) / 2;
  if (raw.coefficients.length !== expected) {
    throw new Error(
      `baseline weights at ${ref} carry ${raw.coefficients.length} coefficients, but a ` +
        `${dim}-feature pairwise basis has ${expected} terms — this script only understands ` +
        `the lr{d}+pairwise family`,
    );
  }
  for (let i = 0; i < dim; i += 1) {
    if (raw.featureKeys[i] !== FORECAST_FEATURE_KEYS[i]) {
      throw new Error(
        `baseline feature ${i} is "${raw.featureKeys[i]}" but the current contract has ` +
          `"${FORECAST_FEATURE_KEYS[i]}" — the feature list is append-only, so this is a real ` +
          `divergence and the old head cannot be scored on today's columns`,
      );
    }
  }
  return {
    dim,
    basis: raw.basis,
    coefficients: raw.coefficients,
    intercept: raw.intercept,
    a: raw.calibration.a,
    b: raw.calibration.b,
  };
}

/** The canonical basis order at an arbitrary width; asserted against the shared one. */
function expandAt(x: readonly number[], d: number, out: Float64Array): void {
  for (let i = 0; i < d; i += 1) {
    out[i] = x[i] as number;
  }
  let k = d;
  for (let i = 0; i < d; i += 1) {
    for (let j = i; j < d; j += 1) {
      out[k] = (x[i] as number) * (x[j] as number);
      k += 1;
    }
  }
}

function baselineRisk(head: BaselineHead, features: readonly number[], scratch: Float64Array): number {
  expandAt(features, head.dim, scratch);
  let z = head.intercept;
  for (let k = 0; k < scratch.length; k += 1) {
    z += (head.coefficients[k] as number) * (scratch[k] as number);
  }
  const t = head.a * z + head.b;
  return t >= 0 ? 1 / (1 + Math.exp(-t)) : Math.exp(t) / (1 + Math.exp(t));
}

async function main(): Promise<void> {
  const config = readConfig();
  const dim = FORECAST_FEATURE_KEYS.length;

  // The local expander must agree with the SHARED one at the current width, or
  // the baseline would be scored on a basis nobody ever fitted. (`dim` here is
  // the shipped width — this script reads weights files, not mined columns.)
  {
    const x = Array.from({ length: dim }, (_, i) => ((i * 7) % 11) / 11);
    const mine = new Float64Array(dim + (dim * (dim + 1)) / 2);
    const theirs = new Float64Array(mine.length);
    expandAt(x, dim, mine);
    expandBasis(x, theirs);
    for (let k = 0; k < mine.length; k += 1) {
      if (Math.abs((mine[k] as number) - (theirs[k] as number)) > 1e-12) {
        throw new Error(`local expander disagrees with model.expandBasis at term ${k}`);
      }
    }
  }

  const current = parseForecastWeights(
    JSON.parse(readFileSync(join(repoRoot(), "src", "shared", "forecast", "weights.json"), "utf8")),
  );
  if (current === null) {
    throw new Error("current weights.json failed parseForecastWeights");
  }
  const baseline = readBaseline(config.baselineRef);
  const scratch = new Float64Array(baseline.dim + (baseline.dim * (baseline.dim + 1)) / 2);

  const before: number[] = [];
  const after: number[] = [];
  const labels: number[] = [];
  const clusterOf: number[] = [];
  const sessions: string[] = [];
  const sessionIndex = new Map<string, number>();
  const eligible: boolean[] = [];
  for await (const row of readJsonl<DatasetRow>(config.data)) {
    if (row.split !== "eval") {
      continue;
    }
    if (row.features.length !== dim) {
      throw new Error(
        `eval row has ${row.features.length} features, contract has ${dim} — rebuild with 'npm run forecast:data'`,
      );
    }
    let s = sessionIndex.get(row.session_id);
    if (s === undefined) {
      s = sessions.length;
      sessionIndex.set(row.session_id, s);
      sessions.push(row.session_id);
    }
    before.push(baselineRisk(baseline, row.features.slice(0, baseline.dim), scratch));
    after.push(forward(current, row.features).rawRisk);
    labels.push(row.label);
    clusterOf.push(s);
    eligible.push(row.secs_to_drift === null || row.secs_to_drift >= LEAD_SEC);
  }
  if (before.length === 0) {
    throw new Error("no eval rows");
  }

  const keep: number[] = [];
  eligible.forEach((ok, i) => {
    if (ok) {
      keep.push(i);
    }
  });
  const label = Uint8Array.from(keep.map((i) => labels[i] as number));
  const cluster = Int32Array.from(keep.map((i) => clusterOf[i] as number));
  const models: BootstrapModel[] = [
    {
      name: `before:${baseline.basis}(${baseline.dim}f)`,
      scores: Float64Array.from(keep.map((i) => before[i] as number)),
    },
    {
      name: `after:${current.basis}(${dim}f)`,
      scores: Float64Array.from(keep.map((i) => after[i] as number)),
    },
  ];
  const beforeAuc = rocAuc(
    Array.from(models[0]?.scores ?? []),
    Array.from(label),
  );
  const afterAuc = rocAuc(Array.from(models[1]?.scores ?? []), Array.from(label));
  const bootstrap = pairedClusterBootstrap(
    label,
    cluster,
    sessions.length,
    models,
    models[0]?.name ?? "",
    config.draws,
    config.seed,
  );

  const report = {
    script: "scripts/forecast/feature-abtest.ts",
    baselineRef: config.baselineRef,
    baselineBasis: baseline.basis,
    baselineFeatures: baseline.dim,
    currentBasis: current.basis,
    currentFeatures: dim,
    evalSessions: sessions.length,
    evalRows: before.length,
    eligibleRows: keep.length,
    eligiblePositives: bootstrap.eligiblePositives,
    aucBefore: round6(beforeAuc),
    aucAfter: round6(afterAuc),
    delta: round6(afterAuc - beforeAuc),
    bootstrap,
    note:
      "lead-censored (≥20 s) ROC-AUC on the 48-session eval SPLIT, both heads on the same rows " +
      "and the same resamples. Reporting only — no selection used this file.",
  };
  mkdirSync(join(config.out, ".."), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const pair = bootstrap.pairs[0];
  console.log(
    `before ${beforeAuc.toFixed(4)} (${baseline.basis}) → after ${afterAuc.toFixed(4)} ` +
      `(${current.basis}) | paired Δ ${round6(afterAuc - beforeAuc)} ` +
      `[${pair?.lo95 ?? "?"}, ${pair?.hi95 ?? "?"}] SE ${pair?.sd ?? "?"} ` +
      `p(Δ≤0) ${pair?.pDiffLeZero ?? "?"} over ${sessions.length} sessions → ${config.out}`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
