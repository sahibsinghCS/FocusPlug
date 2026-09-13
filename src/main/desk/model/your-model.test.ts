import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DESK_FEATURE_VERSION,
  DESK_HEAD_LABELS,
  loadDeskHeadWeights,
  parseDeskHeadWeights,
  YourModel,
  type DeskHeadWeights,
} from "./your-model";

/** Minimal structurally valid head: 2 features -> 4 hidden -> 3 classes. */
function validWeights(): DeskHeadWeights {
  return {
    version: DESK_FEATURE_VERSION,
    featureDim: 2,
    labels: [...DESK_HEAD_LABELS],
    mean: [0, 0],
    std: [1, 1],
    layers: [
      {
        w: [
          [1, 0],
          [0, 1],
          [0.5, 0.5],
          [0, 0],
        ],
        b: [0, 0, 0, 0],
      },
      {
        w: [
          [1, 0, 0, 0],
          [0, 1, 0, 0],
          [0, 0, 1, 0],
        ],
        b: [0, 0, 0],
      },
    ],
  };
}

function parse(weights: unknown): DeskHeadWeights | null {
  return parseDeskHeadWeights(JSON.stringify(weights));
}

describe("parseDeskHeadWeights content validation", () => {
  it("accepts a structurally valid head", () => {
    expect(parse(validWeights())).not.toBeNull();
  });

  it("the committed desk-head.json passes validation", () => {
    const weights = loadDeskHeadWeights();
    expect(weights).not.toBeNull();
    expect(weights?.version).toBe(DESK_FEATURE_VERSION);
  });

  it("rejects a head trained against a different feature version", () => {
    const weights = validWeights();
    weights.version = DESK_FEATURE_VERSION - 1;
    expect(parse(weights)).toBeNull();
  });

  it("rejects a truncated weight row instead of zero-padding it into logits", () => {
    const weights = validWeights();
    weights.layers[0]?.w[2]?.pop();
    expect(parse(weights)).toBeNull();
  });

  it("rejects non-numeric weight entries", () => {
    const weights = validWeights() as unknown as {
      layers: Array<{ w: unknown[][]; b: unknown[] }>;
    };
    weights.layers[1]!.w[0]![1] = "0.5";
    expect(parse(weights)).toBeNull();
    const biased = validWeights() as unknown as {
      layers: Array<{ w: unknown[][]; b: unknown[] }>;
    };
    biased.layers[0]!.b[0] = null;
    expect(parse(biased)).toBeNull();
  });

  it("rejects layers whose row widths do not chain to the previous output", () => {
    const weights = validWeights();
    // Second layer trained against a differently sized hidden layer.
    weights.layers[1] = {
      w: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      b: [0, 0, 0],
    };
    expect(parse(weights)).toBeNull();
  });

  it("rejects a featureDim that does not match the first layer's rows", () => {
    const weights = validWeights();
    weights.featureDim = 3;
    weights.mean = [0, 0, 0];
    weights.std = [1, 1, 1];
    expect(parse(weights)).toBeNull();
  });

  it("rejects malformed inputSlices", () => {
    const reversed = validWeights();
    reversed.inputSlices = [[5, 2]];
    expect(parse(reversed)).toBeNull();
    const negative = validWeights();
    negative.inputSlices = [[-1, 2]];
    expect(parse(negative)).toBeNull();
  });

  it("accounts for codebook retrieval features in the first layer's width", () => {
    const weights = validWeights();
    // 2 classes x (min-dist + softmin) = 4 extra inputs; first layer rows
    // must widen to featureDim + 4 to stay valid.
    weights.codebook = [
      [
        [0, 0],
        [1, 1],
      ],
      [[0.5, 0.5]],
    ];
    expect(parse(weights)).toBeNull();
    weights.layers[0] = {
      w: [
        [1, 0, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 0],
        [0, 0, 1, 0, 0, 0],
        [0, 0, 0, 1, 0, 0],
      ],
      b: [0, 0, 0, 0],
    };
    expect(parse(weights)).not.toBeNull();
  });
});

describe("YourModel weight-load retry", () => {
  it("a failed weight load is retried on the next init instead of latching", async () => {
    const file = join(mkdtempSync(join(tmpdir(), "focusplug-desk-head-")), "desk-head.json");
    const model = new YourModel(file);
    const badFrame = { width: 0, height: 0, data: new Uint8Array(0) };
    // First load fails (file unreadable) — safe uncertain fallback.
    const missing = await model.infer(badFrame);
    expect(missing.label).toBe("uncertain");
    expect(missing.debug?.reason).toBe("custom-head-weights-missing");
    // The file becomes readable (e.g. a transient AV lock released): the
    // same instance must pick the weights up without an app restart.
    writeFileSync(file, JSON.stringify(validWeights()));
    const recovered = await model.infer(badFrame);
    expect(recovered.debug?.reason).toBe("custom-invalid-frame");
  });
});
