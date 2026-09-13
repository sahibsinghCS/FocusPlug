import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { extractFeatures } from "../../src/shared/forecast/features";
import {
  FORECAST_BASIS,
  FORECAST_BASIS_SHA,
  FORECAST_INPUT_DIM,
  FORECAST_PARAM_COUNT,
  FORECAST_TERMS,
  FORECAST_TERM_COUNT,
  attributions,
  forward,
  parseForecastWeights,
} from "../../src/shared/forecast/model";
import { TelemetryRing } from "../../src/shared/forecast/ring";
import {
  FORECAST_FEATURE_KEYS,
  FORECAST_HORIZON_SEC,
  FORECAST_MODEL_VERSION,
  type ForecastFeatureKey,
  type ForecastTerm,
  type ForecastWeightsFile,
} from "../../src/shared/forecast/types";
import type { Decision, DeskSnapshot } from "../../src/shared/types";
import { repoRoot } from "./lib";

/**
 * Regenerates the width-dependent halves of
 * `src/shared/forecast/fixtures/golden.json` when `FORECAST_FEATURE_KEYS`
 * grows. Two blocks change; the `escalation` block never does (it is risk-in,
 * events-out and knows nothing about features).
 *
 * 1. `modelForward` — synthetic weights from a closed formula printed in the
 *    fixture's own description, so a reader can recompute any coefficient with
 *    a calculator, then the shipped `forward` / `attributions` evaluated on
 *    them. This block pins the arithmetic of the forward pass.
 *
 * 2. `features` — the extractor replayed over the committed tick scripts. This
 *    block is a characterization of real behavior, so the generator REFUSES to
 *    write unless every previously-pinned column still reproduces bit-for-bit:
 *    the existing 18 encoded values and every raw key already in the file must
 *    match to 1e-9. A refactor that silently moves an old feature therefore
 *    fails here rather than being papered over by a regenerated expectation.
 *
 *   npx tsx --tsconfig tsconfig.node.json scripts/forecast/make-fixtures.ts
 */

const FIXTURE = join(repoRoot(), "src", "shared", "forecast", "fixtures", "golden.json");

/** Fixture weight formulas — quoted verbatim in the fixture description. */
const FIXTURE_MEAN = (k: number): number => k / (2 * FORECAST_INPUT_DIM);
const FIXTURE_SCALE = 0.5;
const FIXTURE_INTERCEPT = 0.05;
const FIXTURE_PLATT = { a: 1.25, b: -0.15 };
const fixtureCoefficient = (t: number, term: ForecastTerm): number => {
  const j = term.j === null ? FORECAST_INPUT_DIM - 1 : term.j;
  return (((7 * t + 3 * term.i + 5 * j) % 11) - 5) / 40;
};
/** `mixed` case: a length-11 cycle, so it never degenerates as the width grows. */
const MIXED = (k: number): number => ((7 * k) % 11) / 10;

interface FixtureTick {
  repeat?: number;
  focus?: Array<[string, string, boolean, boolean]>;
  desk?: [DeskSnapshot["label"], number, boolean];
  decision?: Decision;
}

interface FeatureScenario {
  name: string;
  sessionStartTs: number;
  deskThreshold: number;
  extractTs: number;
  ticks: FixtureTick[];
  expected: { raw: Record<string, number>; values: number[] };
}

interface Golden {
  description: string;
  modelForward: {
    description: string;
    tolerance: number;
    weights: Record<string, unknown>;
    cases: Array<{
      name: string;
      encoded: number[];
      expected: {
        logit: number;
        rawRisk: number;
        hidden: number[];
        attributions?: number[];
        attributionSum?: number;
      };
    }>;
  };
  features: { description: string; tolerance: number; scenarios: FeatureScenario[] };
  escalation: unknown;
}

/** Byte-for-byte the replay loop `features.test.ts` uses on these scenarios. */
function replay(scenario: FeatureScenario): TelemetryRing {
  const ring = new TelemetryRing();
  ring.reset(scenario.sessionStartTs);
  let second = 1;
  for (const tick of scenario.ticks) {
    const repeat = tick.repeat ?? 1;
    for (let r = 0; r < repeat; r += 1) {
      const ts = scenario.sessionStartTs + second * 1000;
      for (const [processName, windowTitle, matchedAllow, matchedBlock] of tick.focus ?? []) {
        ring.noteFocus({ ts, processName, windowTitle, matchedAllow, matchedBlock });
      }
      if (tick.desk !== undefined) {
        const [label, confidence, webcamEnabled] = tick.desk;
        ring.noteDesk({ ts, label, confidence, webcamEnabled }, scenario.deskThreshold);
      }
      if (tick.decision !== undefined) {
        ring.noteStatus(tick.decision);
      }
      ring.commit(ts);
      second += 1;
    }
  }
  return ring;
}

function round(value: number): number {
  return Number.isFinite(value) ? Number(value.toPrecision(17)) : value;
}

function main(): void {
  const golden = JSON.parse(readFileSync(FIXTURE, "utf8")) as Golden;

  // --- modelForward ---------------------------------------------------------
  const coefficients = FORECAST_TERMS.map((term, t) => fixtureCoefficient(t, term));
  const weightsFile = {
    version: FORECAST_MODEL_VERSION,
    createdAt: golden.modelForward.weights.createdAt,
    seed: golden.modelForward.weights.seed,
    featureKeys: [...FORECAST_FEATURE_KEYS],
    norm: {
      mean: Array.from({ length: FORECAST_INPUT_DIM }, (_, k) => FIXTURE_MEAN(k)),
      scale: new Array<number>(FORECAST_INPUT_DIM).fill(FIXTURE_SCALE),
    },
    basis: FORECAST_BASIS,
    basisSha: FORECAST_BASIS_SHA,
    coefficients,
    intercept: FIXTURE_INTERCEPT,
    calibration: { ...FIXTURE_PLATT },
    horizonSec: FORECAST_HORIZON_SEC,
    thresholds: golden.modelForward.weights.thresholds,
    paramCount: FORECAST_PARAM_COUNT,
    trainProvenanceSha: golden.modelForward.weights.trainProvenanceSha,
  };
  const parsed = parseForecastWeights(structuredClone(weightsFile));
  if (parsed === null) {
    throw new Error("generated fixture weights fail parseForecastWeights");
  }
  const encodings: Record<string, (k: number) => number> = {
    mixed: MIXED,
    at_norm_mean: FIXTURE_MEAN,
    zeros: () => 0,
  };
  golden.modelForward.weights = weightsFile as unknown as Record<string, unknown>;
  golden.modelForward.cases = golden.modelForward.cases.map((entry) => {
    const encode = encodings[entry.name];
    if (encode === undefined) {
      throw new Error(`no encoding formula for fixture case "${entry.name}"`);
    }
    const encoded = Array.from({ length: FORECAST_INPUT_DIM }, (_, k) => encode(k));
    const result = forward(parsed as ForecastWeightsFile, encoded);
    const expected: (typeof entry)["expected"] = {
      logit: round(result.logit),
      rawRisk: round(result.rawRisk),
      hidden: result.hidden.map(round),
    };
    if (entry.expected.attributions !== undefined) {
      const deltas = attributions(parsed as ForecastWeightsFile, encoded);
      expected.attributions = deltas.map(round);
      expected.attributionSum = round(deltas.reduce((sum, d) => sum + d, 0));
    }
    return { name: entry.name, encoded, expected };
  });
  golden.modelForward.description =
    `GLM ${FORECAST_BASIS} forward pass (${FORECAST_TERM_COUNT} basis terms, ` +
    `${FORECAST_PARAM_COUNT} params). Basis order: the ${FORECAST_INPUT_DIM} linear terms in ` +
    `FORECAST_FEATURE_KEYS order, then every product x_i*x_j for i<=j in lexicographic order. ` +
    `Fixture weights: mean[k]=k/${2 * FORECAST_INPUT_DIM}, scale[k]=${FIXTURE_SCALE} (published ` +
    `dispersion only — the standardizer is folded into the coefficients, so the forward pass uses ` +
    `neither), coefficients[t]=(((7t+3i+5j')%11)-5)/40 where (i,j) is term t and ` +
    `j'=${FORECAST_INPUT_DIM - 1} for a linear term, intercept=${FIXTURE_INTERCEPT}, ` +
    `Platt a=${FIXTURE_PLATT.a} b=${FIXTURE_PLATT.b}. Case encodings: mixed[k]=((7k)%11)/10, ` +
    `at_norm_mean[k]=mean[k], zeros[k]=0. logit=intercept+sum_t coefficients[t]*t(x); ` +
    `rawRisk=sigmoid(a*logit+b); hidden[i]=tanh(sum over terms containing feature i of ` +
    `coefficients[t]*t(x)) — product terms count toward BOTH of their features, so hidden does not ` +
    `sum to the logit. attribution_i = rawRisk(x) - rawRisk(x with encoded[i] set to mean[i]). ` +
    `Regenerate with scripts/forecast/make-fixtures.ts.`;

  // --- features -------------------------------------------------------------
  let checked = 0;
  for (const scenario of golden.features.scenarios) {
    const { raw, values } = extractFeatures(replay(scenario), scenario.extractTs);
    // Refuse to rewrite a pinned expectation: every column and raw key already
    // in the fixture must still reproduce. Only NEW keys may appear.
    scenario.expected.values.forEach((want, i) => {
      const got = values[i] ?? Number.NaN;
      if (!(Math.abs(got - want) <= 1e-9)) {
        throw new Error(
          `${scenario.name}.values[${i}] (${FORECAST_FEATURE_KEYS[i]}) changed: ${want} → ${got}. ` +
            `The generator only ADDS columns; fix the extractor or hand-review the fixture.`,
        );
      }
      checked += 1;
    });
    for (const [key, want] of Object.entries(scenario.expected.raw)) {
      const got = raw[key as ForecastFeatureKey];
      if (got === undefined || !(Math.abs(got - want) <= 1e-9)) {
        throw new Error(`${scenario.name}.raw.${key} changed: ${want} → ${String(got)}`);
      }
      checked += 1;
    }
    const nextRaw: Record<string, number> = {};
    for (const key of FORECAST_FEATURE_KEYS) {
      nextRaw[key] = round(raw[key]);
    }
    scenario.expected = { raw: nextRaw, values: values.map(round) };
  }
  golden.features.description =
    `Each tick i (1-based) is one wall second at ts = sessionStartTs + i*1000: apply focus ` +
    `snapshots in order, then desk, then decision status, then commit(ts). focus tuples are ` +
    `[processName, windowTitle, matchedAllow, matchedBlock]; desk tuples are [label, confidence, ` +
    `webcamEnabled]. expected.values are the ${FORECAST_INPUT_DIM} encoded features in ` +
    `FORECAST_FEATURE_KEYS order. Regenerate with scripts/forecast/make-fixtures.ts, which refuses ` +
    `to overwrite an existing pinned value — only new columns may be added.`;

  writeFileSync(FIXTURE, `${JSON.stringify(golden, null, 2)}\n`, "utf8");
  console.log(
    `golden.json regenerated: ${FORECAST_INPUT_DIM} features, ${FORECAST_TERM_COUNT} terms, ` +
      `${golden.features.scenarios.length} feature scenarios | ${checked} previously-pinned values ` +
      `re-verified unchanged`,
  );
}

main();
