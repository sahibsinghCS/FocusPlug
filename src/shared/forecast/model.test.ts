import { describe, expect, it } from "vitest";
import {
  FORECAST_HIDDEN_DIM,
  FORECAST_INPUT_DIM,
  FORECAST_PARAM_COUNT,
  attributions,
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

type Layer = { W: number[][]; b: number[] };

describe("parseForecastWeights accepts", () => {
  it("the committed weights.json (the shipped artifact stays loadable)", () => {
    const parsed = parseForecastWeights(weightsJson);
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe("ff-1");
    expect(parsed?.paramCount).toBe(FORECAST_PARAM_COUNT);
    expect(parsed?.featureKeys).toEqual([...FORECAST_FEATURE_KEYS]);
    // Trained artifacts carry the sha-256 of the provenance object embedded
    // in eval-report.json (the pre-training placeholder said "untrained-init").
    expect(parsed?.trainProvenanceSha).toMatch(/^([0-9a-f]{64}|untrained-init)$/);
  });

  it("the golden fixture weights, as a defensive deep copy", () => {
    const source = structuredClone(golden.modelForward.weights) as {
      layers: [Layer, Layer];
    };
    const parsed = parseForecastWeights(source);
    expect(parsed).not.toBeNull();
    const before = forward(parsed as ForecastWeightsFile, new Array(18).fill(0.5)).logit;
    // Mutating the source after parsing must not change the parsed model.
    const firstRow = source.layers[0].W[0];
    expect(firstRow).toBeDefined();
    if (firstRow) {
      firstRow[0] = 999;
    }
    const after = forward(parsed as ForecastWeightsFile, new Array(18).fill(0.5)).logit;
    expect(after).toBe(before);
  });
});

describe("parseForecastWeights rejects every malformed shape", () => {
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["array", []],
    ["number", 241],
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
    ["layers not length 2", corrupt((w) => { (w.layers as unknown[]).pop(); })],
    ["extra layer", corrupt((w) => { (w.layers as Layer[]).push({ W: [[1]], b: [1] }); })],
    ["W1 missing a row", corrupt((w) => { (w.layers as Layer[])[0]?.W.pop(); })],
    ["W1 row too short", corrupt((w) => { (w.layers as Layer[])[0]?.W[5]?.pop(); })],
    ["W1 row too long", corrupt((w) => { (w.layers as Layer[])[0]?.W[5]?.push(0); })],
    ["W1 entry NaN", corrupt((w) => { const row = (w.layers as Layer[])[0]?.W[2]; if (row) row[7] = Number.NaN; })],
    ["W1 entry string", corrupt((w) => { const row = (w.layers as Layer[])[0]?.W[2]; if (row) (row as unknown[])[7] = "0.1"; })],
    ["b1 too short", corrupt((w) => { (w.layers as Layer[])[0]?.b.pop(); })],
    ["b1 non-finite", corrupt((w) => { const layer = (w.layers as Layer[])[0]; if (layer) layer.b[11] = Number.NEGATIVE_INFINITY; })],
    ["W2 row too short", corrupt((w) => { (w.layers as Layer[])[1]?.W[0]?.pop(); })],
    ["W2 as flat vector", corrupt((w) => { const layer = (w.layers as Layer[])[1]; if (layer) (layer as unknown as { W: unknown }).W = new Array(12).fill(0.1); })],
    ["b2 too long", corrupt((w) => { (w.layers as Layer[])[1]?.b.push(0); })],
    ["missing calibration", corrupt((w) => { delete w.calibration; })],
    ["calibration a NaN", corrupt((w) => { (w.calibration as { a: number }).a = Number.NaN; })],
    ["calibration b string", corrupt((w) => { (w.calibration as { b: unknown }).b = "0"; })],
    ["wrong horizonSec", corrupt((w) => { w.horizonSec = 60; })],
    ["missing thresholds", corrupt((w) => { delete w.thresholds; })],
    ["threshold out of range", corrupt((w) => { (w.thresholds as { nudge: number }).nudge = 1.5; })],
    ["threshold negative", corrupt((w) => { (w.thresholds as { clear: number }).clear = -0.1; })],
    ["threshold non-finite", corrupt((w) => { (w.thresholds as { prearm: number }).prearm = Number.NaN; })],
    ["wrong paramCount", corrupt((w) => { w.paramCount = 240; })],
    ["paramCount as string", corrupt((w) => { w.paramCount = "241"; })],
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
    it(`reproduces logit/risk/hidden for "${forwardCase.name}" to ${tolerance}`, () => {
      const weights = goldenWeights();
      const result = forward(weights, forwardCase.encoded);
      expect(Math.abs(result.logit - forwardCase.expected.logit)).toBeLessThanOrEqual(tolerance);
      expect(Math.abs(result.rawRisk - forwardCase.expected.rawRisk)).toBeLessThanOrEqual(tolerance);
      expect(result.hidden).toHaveLength(FORECAST_HIDDEN_DIM);
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

  it("every attribution equals risk(x) − risk(x with feature i at its norm mean)", () => {
    const forwardCase = golden.modelForward.cases.find((c) => c.name === "mixed");
    const weights = goldenWeights();
    const encoded = forwardCase?.encoded ?? [];
    const base = forward(weights, encoded).rawRisk;
    const got = attributions(weights, encoded);
    for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
      const probe = [...encoded];
      probe[i] = weights.norm.mean[i] ?? 0;
      expect(got[i]).toBe(base - forward(weights, probe).rawRisk);
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
