import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FORECAST_INPUT_DIM } from "../../src/shared/forecast/model";
import { expandBasis } from "./pairwise";
import { pairedClusterBootstrap, type BootstrapModel } from "./bootstrap";
import {
  DATASET_FILE,
  RAW_SESSIONS_FILE,
  forecastDataRoot,
  mulberry32,
  numberArg,
  rocAuc,
  round6,
  shuffled,
  stringArg,
} from "./lib";
import {
  MINED_BASE_DIM,
  MINED_DIM,
  MINED_KEYS,
  loadMinedTrainRows,
  type MinedRows,
} from "./trend-candidates";
import { applyStandardizer, fitLogisticL2, fitStandardizer, rowLogit } from "./linear";

/**
 * ============================================================================
 * FEATURE CONFIRMATION — the same question, asked on the SHIPPED basis
 * ============================================================================
 *
 * `feature-mine.ts` selects on an ADDITIVE logistic on purpose: a feature that
 * cannot pay for one column should not be handed d+1 of them. But the shipped
 * head is `lr{d}+pairwise`, and a feature can be worthless additively and
 * valuable in a product (a desk sag matters *while* grey-loitering, not on its
 * own). So the survivors — and the borderline rejects the bake-off nominated —
 * get a second hearing on the real basis before anything ships.
 *
 * Same inner split as `feature-mine.ts` (identical seed and rule), same
 * lead-censored metric, same train-only discipline: the eval split and
 * `data/forecast/holdout/` are never opened. Each named set is expanded into
 * its own pairwise basis with the SHARED `expandBasis`, fitted with the same
 * L-BFGS, and compared to the base block by a paired session-clustered
 * bootstrap over the inner-val sessions.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/feature-confirm.ts \
 *     --sets "kept=deskSagSlope30,dwellShrink30v90;plus=deskSagSlope30,titleChurnAccel"
 */

const BASE_DIM = MINED_BASE_DIM;
const SELECTION_LEAD_SEC = 20;
/** Short path — the pairwise design is 100× the work of the additive one. */
const LAMBDAS = [1e-3, 1e-4, 1e-5];

interface Config {
  data: string;
  raw: string;
  out: string;
  seed: number;
  iters: number;
  draws: number;
  sets: Array<{ name: string; keys: string[] }>;
}

function parseSets(spec: string): Array<{ name: string; keys: string[] }> {
  const out: Array<{ name: string; keys: string[] }> = [];
  for (const group of spec.split(";")) {
    const trimmed = group.trim();
    if (trimmed === "") {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      throw new Error(`--sets entry "${trimmed}" must look like name=key1,key2`);
    }
    const name = trimmed.slice(0, eq).trim();
    const keys = trimmed
      .slice(eq + 1)
      .split(",")
      .map((key) => key.trim())
      .filter((key) => key !== "");
    for (const key of keys) {
      if (!MINED_KEYS.includes(key)) {
        throw new Error(
          `unknown feature key "${key}" in set "${name}" — the mined columns are ${MINED_KEYS.join(", ")}`,
        );
      }
    }
    out.push({ name, keys });
  }
  return out;
}

function readConfig(): Config {
  return {
    data: stringArg("--data", join(forecastDataRoot(), DATASET_FILE)),
    raw: stringArg("--raw", join(forecastDataRoot(), RAW_SESSIONS_FILE)),
    out: stringArg("--out", join(forecastDataRoot(), "feature-confirm.json")),
    seed: numberArg("--seed", 42),
    iters: Math.round(numberArg("--iters", 250)),
    draws: Math.max(0, Math.round(numberArg("--draws", 1000))),
    sets: parseSets(stringArg("--sets", "")),
  };
}

type Rows = MinedRows;

function sampleWeights(rows: Rows, fitIdx: Int32Array): Float64Array {
  let wPos = 0;
  let wNeg = 0;
  for (let k = 0; k < fitIdx.length; k += 1) {
    const i = fitIdx[k] as number;
    if ((rows.y[i] as number) === 1) {
      wPos += rows.importance[i] as number;
    } else {
      wNeg += rows.importance[i] as number;
    }
  }
  const cw = wPos > 0 ? wNeg / wPos : 1;
  const out = new Float64Array(rows.n);
  for (let i = 0; i < rows.n; i += 1) {
    out[i] = (rows.importance[i] as number) * ((rows.y[i] as number) === 1 ? cw : 1);
  }
  return out;
}

/** `cols` → the full pairwise basis of that subset, standardized on inner-fit. */
function pairwiseDesign(rows: Rows, cols: readonly number[], fitIdx: Int32Array): {
  design: Float32Array;
  dim: number;
} {
  const d = cols.length;
  const dim = d + (d * (d + 1)) / 2;
  const out = new Float32Array(rows.n * dim);
  const sub = new Array<number>(d).fill(0);
  const expanded = new Float64Array(dim);
  for (let i = 0; i < rows.n; i += 1) {
    const src = i * rows.dim;
    for (let j = 0; j < d; j += 1) {
      sub[j] = rows.x[src + (cols[j] as number)] as number;
    }
    expandSubset(sub, expanded, d);
    const dst = i * dim;
    for (let k = 0; k < dim; k += 1) {
      out[dst + k] = expanded[k] as number;
    }
  }
  applyStandardizer(out, dim, fitStandardizer(out, dim, fitIdx));
  return { design: out, dim };
}

/**
 * The canonical basis order of `model.expandBasis`, for an arbitrary width: the
 * d linear terms, then every product i≤j lexicographically. Asserted against
 * the shared implementation at full width before any fit runs.
 */
function expandSubset(x: readonly number[], out: Float64Array, d: number): void {
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

function leadAuc(rows: Rows, valIdx: Int32Array, scores: Float64Array): number {
  const s: number[] = [];
  const l: number[] = [];
  for (let k = 0; k < valIdx.length; k += 1) {
    const i = valIdx[k] as number;
    const sec = rows.secs[i] as number;
    if (Number.isNaN(sec) || sec >= SELECTION_LEAD_SEC) {
      s.push(scores[k] as number);
      l.push(rows.y[i] as number);
    }
  }
  return rocAuc(s, l);
}

async function main(): Promise<void> {
  const config = readConfig();
  const startedAt = Date.now();
  const dim = MINED_DIM;

  // The subset expander must agree with the SHARED one at the SHIPPED width
  // (`expandBasis` only speaks FORECAST_INPUT_DIM), or this script would be
  // confirming a basis the runtime does not serve. The mined matrix is wider
  // than the shipped one — it carries the retired candidates too — so the
  // agreement is asserted at the shipped width and the same closed form is
  // then used at every candidate width.
  {
    const shippedDim = FORECAST_INPUT_DIM;
    const x = Array.from({ length: shippedDim }, (_, i) => ((i * 7) % 11) / 11);
    const mine = new Float64Array(shippedDim + (shippedDim * (shippedDim + 1)) / 2);
    const theirs = new Float64Array(mine.length);
    expandSubset(x, mine, shippedDim);
    expandBasis(x, theirs);
    for (let k = 0; k < mine.length; k += 1) {
      if (Math.abs((mine[k] as number) - (theirs[k] as number)) > 1e-12) {
        throw new Error(`subset expander disagrees with model.expandBasis at term ${k}`);
      }
    }
  }

  const rows = await loadMinedTrainRows(config.data, config.raw, config.seed);
  const syntheticSessions = rows.sessions.map((_, i) => i).filter((i) => rows.synthetic[i] === true);
  const order = shuffled(syntheticSessions, mulberry32(config.seed ^ 0x4d494e45));
  const valSessions = new Set(order.slice(0, Math.max(1, Math.round(order.length * 0.2))));
  const fitList: number[] = [];
  const valList: number[] = [];
  for (let i = 0; i < rows.n; i += 1) {
    (valSessions.has(rows.sessionOf[i] as number) ? valList : fitList).push(i);
  }
  const fitIdx = Int32Array.from(fitList);
  const valIdx = Int32Array.from(valList);
  const weights = sampleWeights(rows, fitIdx);

  const baseCols = Array.from({ length: BASE_DIM }, (_, i) => i);
  const sets = [{ name: `base${BASE_DIM}`, keys: [] as string[] }, ...config.sets];
  const results: Array<{
    name: string;
    features: number;
    terms: number;
    params: number;
    lambda: number;
    innerValLeadAuc20: number;
    extraKeys: string[];
  }> = [];
  const scoreBySet = new Map<string, Float64Array>();

  for (const set of sets) {
    const cols = [
      ...baseCols,
      ...set.keys.map((key) => MINED_KEYS.indexOf(key)).sort((a, b) => a - b),
    ];
    const { design, dim: termCount } = pairwiseDesign(rows, cols, fitIdx);
    let best: { lambda: number; auc: number; scores: Float64Array } | null = null;
    let warm: Float64Array | undefined;
    for (const lambda of LAMBDAS) {
      const fit = fitLogisticL2(design, termCount, fitIdx, rows.y, weights, lambda, config.iters, warm);
      warm = fit.theta;
      const scores = new Float64Array(valIdx.length);
      for (let k = 0; k < valIdx.length; k += 1) {
        scores[k] = rowLogit(design, termCount, valIdx[k] as number, fit.theta);
      }
      const auc = leadAuc(rows, valIdx, scores);
      if (best === null || auc > best.auc) {
        best = { lambda, auc, scores };
      }
    }
    const chosen = best as { lambda: number; auc: number; scores: Float64Array };
    scoreBySet.set(set.name, chosen.scores);
    results.push({
      name: set.name,
      features: cols.length,
      terms: termCount,
      params: termCount + 1,
      lambda: chosen.lambda,
      innerValLeadAuc20: round6(chosen.auc),
      extraKeys: [...set.keys],
    });
    console.log(
      `[confirm] ${set.name.padEnd(24)} d=${String(cols.length).padStart(2)} terms=${String(termCount).padStart(3)} ` +
        `λ=${chosen.lambda} inner-val lead≥20s ${chosen.auc.toFixed(6)} | ` +
        `${((Date.now() - startedAt) / 1000).toFixed(0)}s`,
    );
  }

  // --- Paired session-clustered bootstrap over inner-val sessions ----------
  const eligible: number[] = [];
  for (let k = 0; k < valIdx.length; k += 1) {
    const i = valIdx[k] as number;
    const sec = rows.secs[i] as number;
    if (Number.isNaN(sec) || sec >= SELECTION_LEAD_SEC) {
      eligible.push(k);
    }
  }
  const clusterIds = new Map<number, number>();
  const label = new Uint8Array(eligible.length);
  const cluster = new Int32Array(eligible.length);
  eligible.forEach((k, m) => {
    const i = valIdx[k] as number;
    label[m] = rows.y[i] as number;
    const s = rows.sessionOf[i] as number;
    let c = clusterIds.get(s);
    if (c === undefined) {
      c = clusterIds.size;
      clusterIds.set(s, c);
    }
    cluster[m] = c;
  });
  const models: BootstrapModel[] = sets.map((set) => ({
    name: set.name,
    scores: Float64Array.from(
      eligible.map((k) => (scoreBySet.get(set.name) as Float64Array)[k] as number),
    ),
  }));
  const bootstrap =
    config.draws > 0
      ? pairedClusterBootstrap(
          label,
          cluster,
          clusterIds.size,
          models,
          `base${BASE_DIM}`,
          config.draws,
          config.seed,
        )
      : null;

  const report = {
    script: "scripts/forecast/feature-confirm.ts",
    seed: config.seed,
    protocol: {
      metric: `inner-val lead-censored (≥ ${SELECTION_LEAD_SEC} s) ROC-AUC`,
      model: "the SHIPPED basis — lr{d}+pairwise, every product and square, L2 L-BFGS",
      split: "identical inner fit/val split to scripts/forecast/feature-mine.ts (same seed, same rule)",
      contamination: "train rows only; the eval split and data/forecast/holdout/ are never opened",
      lambdaPath: LAMBDAS,
    },
    dataset: {
      trainRows: rows.n,
      replaySelfCheck: rows.selfCheck,
      innerFitRows: fitIdx.length,
      innerValRows: valIdx.length,
      innerValSessions: valSessions.size,
      eligibleRows: eligible.length,
    },
    sets: results,
    bootstrap,
    elapsedSec: round6((Date.now() - startedAt) / 1000),
  };
  mkdirSync(join(config.out, ".."), { recursive: true });
  writeFileSync(config.out, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[confirm] → ${config.out} (${((Date.now() - startedAt) / 1000).toFixed(1)}s)`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
