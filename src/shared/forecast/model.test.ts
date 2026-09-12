import { describe, expect, it } from "vitest";
import {
  FORECAST_BASIS,
  FORECAST_BASIS_SHA,
  FORECAST_INPUT_DIM,
  FORECAST_PARAM_COUNT,
  FORECAST_TERMS,
  FORECAST_TERM_COUNT,
  FORECAST_TERM_KEYS,
  attributions,
  expandBasis,
  forward,
  parseForecastWeights,
  sigmoid,
} from "./model";
import { FORECAST_FEATURE_KEYS, type ForecastWeightsFile } from "./types";
import goldenJson from "./fixtures/golden.json";
import weightsJson from "./weights.json";

interface ForwardCase {
  name: string;
  encoded: number[];
  expected: {
    logit: number;
    rawRisk: number;
    hidden: number[];
    attributions?: number[];
    attributionSum?: number;
  };
}

const golden = goldenJson as unknown as {
  modelForward: { tolerance: number; weights: unknown; cases: ForwardCase[] };
};

function goldenWeights(): ForecastWeightsFile {
  const parsed = parseForecastWeights(golden.modelForward.weights);
  expect(parsed).not.toBeNull();
  return parsed as ForecastWeightsFile;
}

/** Structured clone + one mutation, for the malformed-shape table. */
function corrupt(mutate: (weights: Record<string, unknown>) => void): unknown {
  const clone = structuredClone(golden.modelForward.weights) as Record<string, unknown>;
  mutate(clone);
  return clone;
}

describe("the canonical basis", () => {
  it("is 18 linear terms then every i≤j product — 189 terms, 190 params", () => {
    expect(FORECAST_TERM_COUNT).toBe(189);
    expect(FORECAST_PARAM_COUNT).toBe(190);
    expect(FORECAST_TERMS).toHaveLength(FORECAST_TERM_COUNT);
    // The first 18 are the plain features, in FORECAST_FEATURE_KEYS order.
    for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
      expect(FORECAST_TERMS[i]).toEqual({ i, j: null });
      expect(FORECAST_TERM_KEYS[i]).toBe(FORECAST_FEATURE_KEYS[i]);
    }
    // The remaining 171 are products with i ≤ j, each pair exactly once.
    const pairs = new Set<string>();
    for (let k = FORECAST_INPUT_DIM; k < FORECAST_TERM_COUNT; k += 1) {
      const term = FORECAST_TERMS[k];
      expect(term).toBeDefined();
      expect(term?.j).not.toBeNull();
      expect(term?.i).toBeLessThanOrEqual(term?.j ?? -1);
      pairs.add(`${term?.i}:${term?.j}`);
    }
    expect(pairs.size).toBe(171);
    expect(new Set(FORECAST_TERM_KEYS).size).toBe(FORECAST_TERM_COUNT);
  });

  it("expands a row exactly as the term list describes", () => {
    const x = Array.from({ length: FORECAST_INPUT_DIM }, (_, i) => (i + 1) / 20);
    const out = new Float64Array(FORECAST_TERM_COUNT);
    expandBasis(x, out);
    for (let k = 0; k < FORECAST_TERM_COUNT; k += 1) {
      const term = FORECAST_TERMS[k];
      const expected =
        term?.j === null || term?.j === undefined
          ? (x[term?.i ?? 0] as number)
          : (x[term.i] as number) * (x[term.j] as number);
      expect(out[k]).toBeCloseTo(expected, 12);
    }
  });

  it("checksums the basis so a reordering can never be served with old weights", () => {
    expect(FORECAST_BASIS).toBe("lr18+pairwise");
    expect(FORECAST_BASIS_SHA).toMatch(/^[0-9a-f]{8}$/);
    // Fail-closed: the shipped artifact must carry exactly this checksum.
    expect((weightsJson as unknown as { basisSha: string }).basisSha).toBe(FORECAST_BASIS_SHA);
  });
});

describe("parseForecastWeights accepts", () => {
  it("the committed weights.json (the shipped artifact stays loadable)", () => {
    const parsed = parseForecastWeights(weightsJson);
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe("ff-1");
    expect(parsed?.paramCount).toBe(FORECAST_PARAM_COUNT);
    expect(parsed?.basis).toBe(FORECAST_BASIS);
    expect(parsed?.coefficients).toHaveLength(FORECAST_TERM_COUNT);
    expect(parsed?.featureKeys).toEqual([...FORECAST_FEATURE_KEYS]);
    // Trained artifacts carry the sha-256 of the provenance object embedded
    // in eval-report.json (the pre-training placeholder said "untrained-init").
    expect(parsed?.trainProvenanceSha).toMatch(/^([0-9a-f]{64}|untrained-init)$/);
  });

  it("the golden fixture weights, as a defensive deep copy", () => {
    const source = structuredClone(golden.modelForward.weights) as { coefficients: number[] };
    const parsed = parseForecastWeights(source);
    expect(parsed).not.toBeNull();
    const before = forward(parsed as ForecastWeightsFile, new Array(18).fill(0.5)).logit;
    // Mutating the source after parsing must not change the parsed model.
    source.coefficients[0] = 999;
    const after = forward(parsed as ForecastWeightsFile, new Array(18).fill(0.5)).logit;
    expect(after).toBe(before);
  });
});

describe("parseForecastWeights rejects every malformed shape", () => {
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["array", []],
    ["number", 190],
    ["wrong version", corrupt((w) => { w.version = "ff-2"; })],
    ["missing version", corrupt((w) => { delete w.version; })],
    ["non-string createdAt", corrupt((w) => { w.createdAt = 123; })],
    ["non-finite seed", corrupt((w) => { w.seed = Number.NaN; })],
    ["featureKeys too short", corrupt((w) => { (w.featureKeys as string[]).pop(); })],
    ["featureKeys too long", corrupt((w) => { (w.featureKeys as string[]).push("switch15"); })],
    [
      "featureKeys reordered",
      corrupt((w) => {
        const keys = w.featureKeys as string[];
        [keys[0], keys[1]] = [keys[1] as string, keys[0] as string];
      }),
    ],
    ["featureKeys renamed", corrupt((w) => { (w.featureKeys as string[])[3] = "dwell"; })],
    ["missing norm", corrupt((w) => { delete w.norm; })],
    ["norm.mean short", corrupt((w) => { (w.norm as { mean: number[] }).mean.pop(); })],
    ["norm.scale short", corrupt((w) => { (w.norm as { scale: number[] }).scale.pop(); })],
    ["norm.mean non-finite", corrupt((w) => { (w.norm as { mean: number[] }).mean[4] = Number.POSITIVE_INFINITY; })],
    ["norm.scale zero", corrupt((w) => { (w.norm as { scale: number[] }).scale[0] = 0; })],
    ["norm.scale negative", corrupt((w) => { (w.norm as { scale: number[] }).scale[9] = -1; })],
    ["missing basis", corrupt((w) => { delete w.basis; })],
    ["wrong basis name", corrupt((w) => { w.basis = "lr18"; })],
    ["missing basisSha", corrupt((w) => { delete w.basisSha; })],
    ["wrong basisSha (a reordered term list)", corrupt((w) => { w.basisSha = "deadbeef"; })],
    ["missing coefficients", corrupt((w) => { delete w.coefficients; })],
    ["coefficients too short", corrupt((w) => { (w.coefficients as number[]).pop(); })],
    ["coefficients too long", corrupt((w) => { (w.coefficients as number[]).push(0); })],
    ["coefficient NaN", corrupt((w) => { (w.coefficients as number[])[42] = Number.NaN; })],
    ["coefficient Infinity", corrupt((w) => { (w.coefficients as number[])[7] = Number.POSITIVE_INFINITY; })],
    ["coefficient as string", corrupt((w) => { (w.coefficients as unknown[])[3] = "0.1"; })],
    ["coefficients as an object", corrupt((w) => { w.coefficients = { 0: 0.1 }; })],
    ["missing intercept", corrupt((w) => { delete w.intercept; })],
    ["non-finite intercept", corrupt((w) => { w.intercept = Number.NaN; })],
    ["intercept as string", corrupt((w) => { w.intercept = "0.05"; })],
    ["leftover MLP layers instead of a term list", corrupt((w) => {
      delete w.coefficients;
      delete w.intercept;
      w.layers = [{ W: [[0]], b: [0] }, { W: [[0]], b: [0] }];
    })],
    ["missing calibration", corrupt((w) => { delete w.calibration; })],
    ["calibration a NaN", corrupt((w) => { (w.calibration as { a: number }).a = Number.NaN; })],
    ["calibration b string", corrupt((w) => { (w.calibration as { b: unknown }).b = "0"; })],
    ["wrong horizonSec", corrupt((w) => { w.horizonSec = 60; })],
    ["missing thresholds", corrupt((w) => { delete w.thresholds; })],
    ["threshold out of range", corrupt((w) => { (w.thresholds as { nudge: number }).nudge = 1.5; })],
    ["threshold negative", corrupt((w) => { (w.thresholds as { clear: number }).clear = -0.1; })],
    ["threshold non-finite", corrupt((w) => { (w.thresholds as { prearm: number }).prearm = Number.NaN; })],
    ["wrong paramCount", corrupt((w) => { w.paramCount = 241; })],
    ["paramCount as string", corrupt((w) => { w.paramCount = "190"; })],
    ["missing trainProvenanceSha", corrupt((w) => { delete w.trainProvenanceSha; })],
    ["numeric trainProvenanceSha", corrupt((w) => { w.trainProvenanceSha = 42; })],
  ];

  for (const [name, value] of cases) {
    it(name, () => {
      expect(parseForecastWeights(value)).toBeNull();
    });
  }
});

describe("forward pass vs golden fixture", () => {
  const tolerance = golden.modelForward.tolerance;

  for (const forwardCase of golden.modelForward.cases) {
    it(`reproduces logit/risk/term groups for "${forwardCase.name}" to ${tolerance}`, () => {
      const weights = goldenWeights();
      const result = forward(weights, forwardCase.encoded);
      expect(Math.abs(result.logit - forwardCase.expected.logit)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(result.rawRisk - forwardCase.expected.rawRisk)).toBeLessThanOrEqual(tolerance);
      expect(result.hidden).toHaveLength(FORECAST_INPUT_DIM);
      result.hidden.forEach((h, j) => {
        expect(
          Math.abs(h - (forwardCase.expected.hidden[j] ?? Number.NaN)),
          `hidden[${j}]`,
        ).toBeLessThanOrEqual(tolerance);
        expect(h).toBeGreaterThanOrEqual(-1);
        expect(h).toBeLessThanOrEqual(1);
      });
    });
  }

  it("is exactly the dot product the term list describes", () => {
    const weights = goldenWeights();
    const encoded = Array.from({ length: FORECAST_INPUT_DIM }, (_, i) => ((i * 7) % 11) / 11);
    const basis = new Float64Array(FORECAST_TERM_COUNT);
    expandBasis(encoded, basis);
    let expected = weights.intercept;
    for (let k = 0; k < FORECAST_TERM_COUNT; k += 1) {
      expected += (weights.coefficients[k] as number) * (basis[k] as number);
    }
    expect(Math.abs(forward(weights, encoded).logit - expected)).toBeLessThan(1e-12);
  });

  it("throws on a wrong-length feature vector (callers try/catch)", () => {
    const weights = goldenWeights();
    expect(() => forward(weights, new Array(17).fill(0))).toThrow();
    expect(() => forward(weights, new Array(19).fill(0))).toThrow();
  });

  it("sigmoid sanity", () => {
    expect(sigmoid(0)).toBe(0.5);
    expect(sigmoid(10)).toBeGreaterThan(0.9999);
    expect(sigmoid(-10)).toBeLessThan(0.0001);
  });
});

describe("occlusion attributions vs golden fixture", () => {
  const tolerance = golden.modelForward.tolerance;

  it("matches the pinned per-feature deltas and their sum for the mixed case", () => {
    const forwardCase = golden.modelForward.cases.find((c) => c.name === "mixed");
    expect(forwardCase).toBeDefined();
    const expected = forwardCase?.expected.attributions ?? [];
    const weights = goldenWeights();
    const got = attributions(weights, forwardCase?.encoded ?? []);
    expect(got).toHaveLength(FORECAST_INPUT_DIM);
    got.forEach((delta, i) => {
      expect(Math.abs(delta - (expected[i] ?? Number.NaN)), `attribution[${i}]`).toBeLessThanOrEqual(
        tolerance,
      );
    });
    const sum = got.reduce((acc, delta) => acc + delta, 0);
    expect(Math.abs(sum - (forwardCase?.expected.attributionSum ?? Number.NaN))).toBeLessThanOrEqual(
      tolerance,
    );
  });

  /**
   * The GLM computes each occluded logit as a 19-term delta off the base
   * logit instead of re-expanding all 189 terms. This pins the optimisation
   * to the definition it claims to implement.
   */
  it("every attribution equals risk(x) − risk(x with feature i at its norm mean)", () => {
    const weights = goldenWeights();
    for (const forwardCase of golden.modelForward.cases) {
      const encoded = forwardCase.encoded;
      const base = forward(weights, encoded).rawRisk;
      const got = attributions(weights, encoded);
      for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
        const probe = [...encoded];
        probe[i] = weights.norm.mean[i] ?? 0;
        const naive = base - forward(weights, probe).rawRisk;
        expect(Math.abs((got[i] as number) - naive), `attribution[${i}] @ ${forwardCase.name}`).toBeLessThan(
          1e-12,
        );
      }
    }
  });

  it("an input already at the norm mean attributes exactly zero everywhere", () => {
    const weights = goldenWeights();
    const got = attributions(weights, [...weights.norm.mean]);
    for (const delta of got) {
      expect(delta).toBe(0);
    }
  });

  it("does not mutate the input vector", () => {
    const weights = goldenWeights();
    const encoded = new Array(18).fill(0.3);
    attributions(weights, encoded);
    expect(encoded).toEqual(new Array(18).fill(0.3));
  });
});
