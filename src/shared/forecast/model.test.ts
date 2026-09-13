import { describe, expect, it } from "vitest";
import {
  FORECAST_ACTIVATION,
  FORECAST_BASIS,
  FORECAST_BASIS_SHA,
  FORECAST_ENSEMBLE_MEMBERS,
  FORECAST_FORWARD_MACS,
  FORECAST_HIDDEN_DIM,
  FORECAST_INPUT_DIM,
  FORECAST_MEMBER_HIDDEN_DIM,
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

function hiddenOf(w: Record<string, unknown>): { weights: number[]; bias: number[] } {
  return (w.layers as { hidden: { weights: number[]; bias: number[] } }).hidden;
}

function outputOf(w: Record<string, unknown>): { weights: number[]; bias: number[] } {
  return (w.layers as { output: { weights: number[]; bias: number[] } }).output;
}

/** Structured clone + one mutation, for the malformed-shape table. */
function corrupt(mutate: (weights: Record<string, unknown>) => void): unknown {
  const clone = structuredClone(golden.modelForward.weights) as Record<string, unknown>;
  mutate(clone);
  return clone;
}

describe("the shipped architecture", () => {
  it("is d inputs → (members × 12) tanh units → 1 logit, with a derived param count", () => {
    const d = FORECAST_FEATURE_KEYS.length;
    // Every width is derived from the feature contract and the member count, so
    // this arithmetic is the only place the sizes are asserted — no literal to
    // forget to update when the feature list grows.
    expect(FORECAST_INPUT_DIM).toBe(d);
    expect(FORECAST_HIDDEN_DIM).toBe(FORECAST_ENSEMBLE_MEMBERS * FORECAST_MEMBER_HIDDEN_DIM);
    expect(FORECAST_PARAM_COUNT).toBe(
      FORECAST_HIDDEN_DIM * d + FORECAST_HIDDEN_DIM + FORECAST_HIDDEN_DIM + 1,
    );
    // The published cost claim is derived too: H·D + H multiply-accumulates.
    expect(FORECAST_FORWARD_MACS).toBe(FORECAST_HIDDEN_DIM * d + FORECAST_HIDDEN_DIM);
    expect(FORECAST_FORWARD_MACS).toBeLessThan(FORECAST_PARAM_COUNT);
  });

  it("checksums width + activation + feature order so a change can never be served with old weights", () => {
    expect(FORECAST_BASIS).toBe(`mlp${FORECAST_INPUT_DIM}-${FORECAST_HIDDEN_DIM}-1`);
    expect(FORECAST_ACTIVATION).toBe("tanh");
    expect(FORECAST_BASIS_SHA).toMatch(/^[0-9a-f]{8}$/);
    // Fail-closed: the shipped artifact must carry exactly this checksum.
    expect((weightsJson as unknown as { basisSha: string }).basisSha).toBe(FORECAST_BASIS_SHA);
  });

  it("ships the layer shapes the param count promises", () => {
    const parsed = parseForecastWeights(weightsJson);
    expect(parsed).not.toBeNull();
    const layers = (parsed as ForecastWeightsFile).layers;
    expect(layers.hidden.weights).toHaveLength(FORECAST_HIDDEN_DIM * FORECAST_INPUT_DIM);
    expect(layers.hidden.bias).toHaveLength(FORECAST_HIDDEN_DIM);
    expect(layers.output.weights).toHaveLength(FORECAST_HIDDEN_DIM);
    expect(layers.output.bias).toHaveLength(1);
    const floats =
      layers.hidden.weights.length +
      layers.hidden.bias.length +
      layers.output.weights.length +
      layers.output.bias.length;
    // paramCount is HONEST: it counts every float the forward pass reads. The
    // input standardizer is folded into the hidden layer, so there is no extra
    // 2N-float scaler hiding beside it.
    expect(floats).toBe(FORECAST_PARAM_COUNT);
  });
});

describe("parseForecastWeights accepts", () => {
  it("the committed weights.json (the shipped artifact stays loadable)", () => {
    const parsed = parseForecastWeights(weightsJson);
    expect(parsed).not.toBeNull();
    expect(parsed?.version).toBe("ff-1");
    expect(parsed?.paramCount).toBe(FORECAST_PARAM_COUNT);
    expect(parsed?.basis).toBe(FORECAST_BASIS);
    expect(parsed?.layers.hidden.weights).toHaveLength(FORECAST_HIDDEN_DIM * FORECAST_INPUT_DIM);
    expect(parsed?.featureKeys).toEqual([...FORECAST_FEATURE_KEYS]);
    // Trained artifacts carry the sha-256 of the provenance object embedded
    // in eval-report.json (the pre-training placeholder said "untrained-init").
    expect(parsed?.trainProvenanceSha).toMatch(/^([0-9a-f]{64}|untrained-init)$/);
  });

  it("the golden fixture weights, as a defensive deep copy", () => {
    const source = structuredClone(golden.modelForward.weights) as {
      layers: { hidden: { weights: number[] }; output: { bias: number[] } };
    };
    const parsed = parseForecastWeights(source);
    expect(parsed).not.toBeNull();
    const before = forward(parsed as ForecastWeightsFile, new Array(FORECAST_INPUT_DIM).fill(0.5)).logit;
    // Mutating the source after parsing must not change the parsed model.
    source.layers.hidden.weights[0] = 999;
    source.layers.output.bias[0] = 999;
    const after = forward(parsed as ForecastWeightsFile, new Array(FORECAST_INPUT_DIM).fill(0.5)).logit;
    expect(after).toBe(before);
  });
});

describe("parseForecastWeights rejects every malformed shape", () => {
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["array", []],
    ["number", 937],
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
    ["wrong basis name", corrupt((w) => { w.basis = "mlp18-36-1"; })],
    ["missing basisSha", corrupt((w) => { delete w.basisSha; })],
    ["wrong basisSha (a changed width or activation)", corrupt((w) => { w.basisSha = "deadbeef"; })],
    ["missing layers", corrupt((w) => { delete w.layers; })],
    ["layers as an array", corrupt((w) => { w.layers = [{ weights: [], bias: [] }]; })],
    ["missing hidden layer", corrupt((w) => { delete (w.layers as Record<string, unknown>).hidden; })],
    ["missing output layer", corrupt((w) => { delete (w.layers as Record<string, unknown>).output; })],
    ["hidden weights too short", corrupt((w) => { hiddenOf(w).weights.pop(); })],
    ["hidden weights too long", corrupt((w) => { hiddenOf(w).weights.push(0); })],
    ["hidden weight NaN", corrupt((w) => { hiddenOf(w).weights[42] = Number.NaN; })],
    ["hidden weight Infinity", corrupt((w) => { hiddenOf(w).weights[7] = Number.POSITIVE_INFINITY; })],
    ["hidden weight as string", corrupt((w) => { (hiddenOf(w).weights as unknown[])[3] = "0.1"; })],
    ["hidden weights as an object", corrupt((w) => { (hiddenOf(w) as { weights: unknown }).weights = { 0: 0.1 }; })],
    ["hidden bias too short", corrupt((w) => { hiddenOf(w).bias.pop(); })],
    ["hidden bias non-finite", corrupt((w) => { hiddenOf(w).bias[2] = Number.NaN; })],
    ["output weights too short", corrupt((w) => { outputOf(w).weights.pop(); })],
    ["output weights too long", corrupt((w) => { outputOf(w).weights.push(0); })],
    ["output weight NaN", corrupt((w) => { outputOf(w).weights[5] = Number.NaN; })],
    ["output bias not length 1", corrupt((w) => { outputOf(w).bias.push(0); })],
    ["output bias non-finite", corrupt((w) => { outputOf(w).bias[0] = Number.NaN; })],
    ["output bias as a bare number", corrupt((w) => { (outputOf(w) as { bias: unknown }).bias = 0.05; })],
    ["a transposed hidden layer (H and D swapped)", corrupt((w) => {
      const layer = hiddenOf(w);
      layer.weights = new Array<number>(FORECAST_INPUT_DIM * FORECAST_HIDDEN_DIM).fill(0);
      layer.bias = new Array<number>(FORECAST_INPUT_DIM).fill(0);
    })],
    ["leftover GLM coefficients instead of layers", corrupt((w) => {
      delete w.layers;
      w.coefficients = new Array<number>(324).fill(0);
      w.intercept = 0.05;
    })],
    ["missing calibration", corrupt((w) => { delete w.calibration; })],
    ["calibration a NaN", corrupt((w) => { (w.calibration as { a: number }).a = Number.NaN; })],
    ["calibration b string", corrupt((w) => { (w.calibration as { b: unknown }).b = "0"; })],
    ["wrong horizonSec", corrupt((w) => { w.horizonSec = 60; })],
    ["missing thresholds", corrupt((w) => { delete w.thresholds; })],
    ["threshold out of range", corrupt((w) => { (w.thresholds as { nudge: number }).nudge = 1.5; })],
    ["threshold negative", corrupt((w) => { (w.thresholds as { clear: number }).clear = -0.1; })],
    ["threshold non-finite", corrupt((w) => { (w.thresholds as { prearm: number }).prearm = Number.NaN; })],
    ["wrong paramCount", corrupt((w) => { w.paramCount = FORECAST_PARAM_COUNT + 1; })],
    ["paramCount as string", corrupt((w) => { w.paramCount = String(FORECAST_PARAM_COUNT); })],
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
    it(`reproduces logit/risk/hidden units for "${forwardCase.name}" to ${tolerance}`, () => {
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

  it("is exactly the two-layer arithmetic the artifact describes", () => {
    const weights = goldenWeights();
    const encoded = Array.from({ length: FORECAST_INPUT_DIM }, (_, i) => ((i * 7) % 11) / 11);
    const { hidden, output } = weights.layers;
    let expected = output.bias[0] as number;
    const expectedHidden: number[] = [];
    for (let j = 0; j < FORECAST_HIDDEN_DIM; j += 1) {
      let sum = hidden.bias[j] as number;
      for (let i = 0; i < FORECAST_INPUT_DIM; i += 1) {
        sum += (hidden.weights[j * FORECAST_INPUT_DIM + i] as number) * (encoded[i] as number);
      }
      const activation = Math.tanh(sum);
      expectedHidden.push(activation);
      expected += (output.weights[j] as number) * activation;
    }
    const result = forward(weights, encoded);
    expect(Math.abs(result.logit - expected)).toBeLessThan(1e-12);
    result.hidden.forEach((value, j) => {
      expect(Math.abs(value - (expectedHidden[j] as number)), `hidden[${j}]`).toBeLessThan(1e-12);
    });
  });

  it("throws on a wrong-length feature vector (callers try/catch)", () => {
    const weights = goldenWeights();
    expect(() => forward(weights, new Array(FORECAST_INPUT_DIM - 1).fill(0))).toThrow();
    expect(() => forward(weights, new Array(FORECAST_INPUT_DIM + 1).fill(0))).toThrow();
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
   * `attributions` computes each occluded logit by shifting the CACHED hidden
   * pre-activations by `W1_jf · (m_f − x_f)` instead of re-running the whole
   * forward pass d times. This pins that optimisation to the definition it
   * claims to implement — exactly, not approximately.
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
    const encoded = new Array(FORECAST_INPUT_DIM).fill(0.3);
    attributions(weights, encoded);
    expect(encoded).toEqual(new Array(FORECAST_INPUT_DIM).fill(0.3));
  });
});
