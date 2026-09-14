import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AttentionLabel } from "@shared/types";
import {
  ATTENTION_HIDDEN_DIM,
  ATTENTION_LABELS,
  CORRECTABLE_LABELS,
  CORRECTION_ANCHOR_EVIDENCE,
  CORRECTION_ANCHOR_L2,
  CORRECTION_BOOTSTRAP_DRAWS,
  CORRECTION_CLASS_WEIGHT_CAP,
  CORRECTION_MAX_DRIFT_RATIO,
  CORRECTION_MAX_SLICE_DROP_PTS,
  CORRECTION_MIN_GAIN_GROUPS,
  CORRECTION_POOLED_MARGIN_PTS,
  CORRECTION_REFIT_EPOCHS,
  CORRECTION_REFIT_LR,
  CORRECTION_REFIT_MIN_EVAL_GROUPS,
  CORRECTION_REFIT_MIN_GROUPS,
  CORRECTION_REFIT_MIN_TRAIN_GROUPS,
  anchorLambda,
  attentionHidden,
  driftRatio,
  evaluateRefit,
  fitPersonalOutputLayer,
  pairedBootstrap,
  poolWeights,
  predictFromHidden,
  scoreAnchorSlice,
  scoreHoldout,
  shippedOutputLayer,
  voteCorrection,
  type AttentionAnchorRow,
  type AttentionAnchors,
  type CorrectionGroupInput,
  type OutputLayer,
  type RefitGateId,
  type RefitGateInput,
} from "./personal-refit";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..", "..");
const read = (relative: string): string => readFileSync(join(repoRoot, relative), "utf8");

/* ────────────────────────────────────────────────────────────────────────
 * A two-dimensional world, so every number below can be checked by hand.
 *
 * logit(focused) = x, logit(unfocused) = 0, logit(phone) = y. The shipped head
 * therefore says `focused` above the diagonal in the positive quadrant and
 * `phone` below it — a boundary a test can reason about, and the same shape
 * as the real 16 -> 3 layer with 14 fewer dimensions.
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Scaled by four so ‖θ₀‖ (5.66) is the same order as the real output layer's
 * 2.56 relative to its 16 inputs: a boundary the trust region lets a fit move,
 * rather than one where any move at all is 50% of a tiny layer.
 */
const BASE: OutputLayer = { w: [[4, 0], [0, 0], [0, 4]], b: [0, 0, 0] };

function group(
  id: string,
  label: AttentionLabel,
  split: "train" | "eval",
  frames: number[][],
): CorrectionGroupInput {
  return { id, label, split, frames: frames.map((hidden) => ({ hidden })) };
}

function anchors(rows: AttentionAnchorRow[], baseHeadHash = "headhash00000000"): AttentionAnchors {
  return { v: 1, baseHeadHash, hiddenDim: 2, labels: ATTENTION_LABELS, rows };
}

function row(
  path: string,
  slice: "adaption" | "proxy",
  truth: AttentionLabel,
  hidden: number[],
): AttentionAnchorRow {
  return { path, slice, truth, hidden };
}

/** A pool that installs nothing on its own — the fixture the gates run over. */
function pool(count: number, options: { label?: AttentionLabel; frames?: number } = {}): CorrectionGroupInput[] {
  const label = options.label ?? "focused";
  const frames = options.frames ?? 3;
  return Array.from({ length: count }, (_, index) =>
    group(
      `dc-${String(index + 1).padStart(4, "0")}`,
      label,
      index % 2 === 0 ? "train" : "eval",
      Array.from({ length: frames }, (_, f) => [0.4 + f * 0.01, 1.6 + f * 0.01]),
    ),
  );
}

function gateInput(overrides: Partial<RefitGateInput> = {}): RefitGateInput {
  return {
    at: 1_773_000_000_000,
    deskModelId: "custom",
    sessionActive: false,
    baseHeadHash: "headhash00000000",
    anchors: anchors([
      row("a/1.jpg", "adaption", "focused", [2, 0.2]),
      row("a/2.jpg", "adaption", "phone", [0.2, 2]),
      row("p/1.jpg", "proxy", "focused", [1.5, 0.1]),
    ]),
    anchorsHash: "anchorshash00000",
    base: BASE,
    groups: pool(12),
    ...overrides,
  };
}

const gate = (gates: ReadonlyArray<{ id: RefitGateId; passed: boolean }>, id: RefitGateId): boolean =>
  gates.find((entry) => entry.id === id)?.passed ?? false;

/* ────────────────────────────────────────────────────────────────────────
 * The constants are the contract, and the doc's frozen fence is the contract
 * ──────────────────────────────────────────────────────────────────────── */

describe("constants", () => {
  const doc = read("docs/CORRECTION-LOOP.md");
  const fenceAt = doc.indexOf("## 2. Constants — `src/shared/correction/constants.ts` (complete source)");
  const fence = doc.slice(doc.indexOf("```ts", fenceAt) + 5, doc.indexOf("```", doc.indexOf("```ts", fenceAt) + 5));
  const fromDoc = new Map<string, number>();
  for (const match of fence.matchAll(/export const ([A-Z0-9_]+)(?:\s*:[^=]+)?\s*=\s*([^;]+);/g)) {
    const value = Number((match[2] ?? "").replace(/_/g, "").trim());
    if (Number.isFinite(value)) {
      fromDoc.set(match[1] as string, value);
    }
  }

  const mirrored: Record<string, number> = {
    CORRECTION_REFIT_MIN_GROUPS,
    CORRECTION_REFIT_MIN_TRAIN_GROUPS,
    CORRECTION_REFIT_MIN_EVAL_GROUPS,
    CORRECTION_ANCHOR_L2,
    CORRECTION_ANCHOR_EVIDENCE,
    CORRECTION_REFIT_EPOCHS,
    CORRECTION_REFIT_LR,
    CORRECTION_CLASS_WEIGHT_CAP,
    CORRECTION_MAX_DRIFT_RATIO,
    CORRECTION_POOLED_MARGIN_PTS,
    CORRECTION_MAX_SLICE_DROP_PTS,
    CORRECTION_MIN_GAIN_GROUPS,
    CORRECTION_BOOTSTRAP_DRAWS,
  };

  it("every mirrored constant equals the frozen appendix in docs/CORRECTION-LOOP.md", () => {
    expect(fromDoc.size).toBeGreaterThan(10);
    for (const [name, value] of Object.entries(mirrored)) {
      expect(fromDoc.get(name), `${name} is not in the doc's frozen constants fence`).toBeDefined();
      expect(fromDoc.get(name), name).toBe(value);
    }
  });

  const sharedConstants = join(repoRoot, "src", "shared", "correction", "constants.ts");
  it.skipIf(!existsSync(sharedConstants))(
    "…and they are IMPORTED from the app's copy, not a second declaration of it",
    () => {
      // The app and this trainer run one fit, not two: `personal-refit.ts` is
      // a barrel over `src/shared/correction/refit.ts`, which imports these
      // numbers from the frozen fence rather than restating them. The values
      // asserted above therefore came out of that file — this re-reads it as
      // text so a future edit that reintroduces a second copy still has to
      // agree with the doc.
      const source = readFileSync(sharedConstants, "utf8");
      for (const [name, value] of Object.entries(mirrored)) {
        const match = new RegExp(`export const ${name}(?:\\s*:[^=]+)?\\s*=\\s*([^;]+);`).exec(source);
        if (match) {
          expect(Number((match[1] ?? "").replace(/_/g, "").trim()), name).toBe(value);
        }
      }
    },
  );

  it("CORRECTION_ANCHOR_EVIDENCE is what the shipped head was actually fitted on", () => {
    // The λ schedule is a literal statement of how much evidence each side
    // has, so this constant cannot be allowed to drift from the metrics file.
    const metrics = JSON.parse(read("src/main/desk/model/weights/attention-head.metrics.json")) as {
      dataset: { train: number; val: number };
    };
    expect(metrics.dataset.train + metrics.dataset.val).toBe(CORRECTION_ANCHOR_EVIDENCE);
  });

  it("the label order is the shipped head's own", () => {
    const head = JSON.parse(read("src/main/desk/model/weights/attention-head.json")) as {
      labels: string[];
    };
    expect(head.labels).toEqual([...ATTENTION_LABELS]);
  });

  it("ATTENTION_HIDDEN_DIM is the shipped head's own bottleneck, not a comment", () => {
    // The app and the desk model both size a personal head with this, and a
    // head of the wrong width is refused rather than coerced — so it has to be
    // the real one.
    const head = JSON.parse(read("src/main/desk/model/weights/attention-head.json")) as {
      layers: Array<{ b: number[] }>;
    };
    expect(head.layers[0]?.b.length).toBe(ATTENTION_HIDDEN_DIM);
    expect(head.layers[head.layers.length - 1]?.b.length).toBe(ATTENTION_LABELS.length);
  });

  it("CORRECTION_REFIT_MIN_EVAL_GROUPS is FIRST_PERSON_MIN_EVAL_GROUPS, not a new bar", () => {
    expect(read("scripts/desk-model/first-person.ts")).toContain(
      `export const FIRST_PERSON_MIN_EVAL_GROUPS = ${CORRECTION_REFIT_MIN_EVAL_GROUPS};`,
    );
  });

  it("the fit is pure: no node import, no clock, no network", () => {
    // The real file, not the barrel that names it: an assertion pointed at a
    // twenty-line re-export would pass whatever the arithmetic did.
    const source = read("src/shared/correction/refit.ts");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("/*") && !line.trim().startsWith("//"))
      .join("\n");
    expect(code).not.toMatch(/from "node:/);
    expect(code).not.toMatch(/\bDate\.now\b|\bnew Date\b/);
    expect(code).not.toMatch(/\bfetch\(|require\(/);
    // …and the barrel itself pulls in nothing else, so importing it from the
    // Electron main bundle drags no filesystem in.
    expect(read("scripts/desk-model/personal-refit.ts")).toMatch(
      /export \* from "@shared\/correction\/refit";/,
    );
    // Positive controls: the assertions above can fail.
    const shell = read("scripts/desk-model/refit-io.ts");
    expect(shell).toMatch(/from "node:/);
    expect(read("scripts/desk-model/refit-attention.ts")).toMatch(/\bDate\.now\b/);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * The arithmetic of the frozen bottleneck
 * ──────────────────────────────────────────────────────────────────────── */

describe("the frozen bottleneck", () => {
  const head = {
    featureDim: 2,
    inputSlices: [[1, 3]] as Array<[number, number]>,
    mean: [1, 1],
    std: [2, 2],
    layers: [
      { w: [[1, 0], [0, 1], [1, 1]], b: [0, 0, -10] },
      { w: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], b: [0, 0, 0] },
    ],
  };

  it("slices, standardizes, and clamps at zero", () => {
    // raw [9, 3, 5] -> slice [3, 5] -> z [(3-1)/2, (5-1)/2] = [1, 2]
    // layer 0 = [1, 2, 1+2-10] -> relu -> [1, 2, 0]
    expect(attentionHidden(head, [9, 3, 5])).toEqual([1, 2, 0]);
  });

  it("shippedOutputLayer takes the LAST layer and copies it", () => {
    const output = shippedOutputLayer(head);
    expect(output.b).toHaveLength(3);
    output.w[0]![0] = 99;
    expect(head.layers[1]!.w[0]![0]).toBe(1);
  });

  it("predicts the argmax of softmax(W h + b)", () => {
    expect(predictFromHidden(BASE, [2, 0.5]).label).toBe("focused");
    expect(predictFromHidden(BASE, [0.5, 2]).label).toBe("phone");
    expect(predictFromHidden(BASE, [-1, -1]).label).toBe("unfocused");
    expect(predictFromHidden(BASE, [2, 0.5]).probs.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * A handful must not dominate
 * ──────────────────────────────────────────────────────────────────────── */

describe("the weighting", () => {
  it("a correction is ONE vote however many frames it carries", () => {
    const three = [group("dc-0001", "focused", "train", [[1, 2], [1.1, 2], [0.9, 2]])];
    const thirty = [
      group(
        "dc-0001",
        "focused",
        "train",
        Array.from({ length: 30 }, (_, i) => [1 + (i % 3) * 0.1 - 0.1, 2]),
      ),
    ];
    expect(poolWeights(three).totalWeight).toBeCloseTo(poolWeights(thirty).totalWeight, 12);
    // Not just the mass: the same 30 frames are the same three photographs
    // repeated, so the fitted layer lands in the same place too.
    const fromThree = fitPersonalOutputLayer(BASE, three).output;
    const fromThirty = fitPersonalOutputLayer(BASE, thirty).output;
    for (let c = 0; c < 3; c += 1) {
      expect(fromThirty.b[c]).toBeCloseTo(fromThree.b[c] as number, 6);
      for (let i = 0; i < 2; i += 1) {
        expect(fromThirty.w[c]![i]).toBeCloseTo(fromThree.w[c]![i] as number, 6);
      }
    }
  });

  it("class balancing uses train-attention.ts's formula, its floor and its cap", () => {
    const lopsided = [
      ...Array.from({ length: 11 }, (_, i) => group(`dc-f${i}`, "focused", "train", [[1, 2]])),
      group("dc-p1", "phone", "train", [[0.2, 3]]),
    ];
    const weights = poolWeights(lopsided);
    // 12 / (3 classes x 11) = 0.36 -> floored at 0.5; 12 / (3 x 1) = 4 -> the cap.
    expect(weights.classWeights.focused).toBeCloseTo(0.5, 12);
    expect(weights.classWeights.phone).toBe(CORRECTION_CLASS_WEIGHT_CAP);
    expect(read("scripts/desk-model/train-attention.ts")).toContain(
      "Math.min(4, Math.max(0.5, trainSamples.length / (labels.length * count)))",
    );
  });

  it("lambda is the evidence ratio, and only becomes visible in the hundreds", () => {
    expect(anchorLambda(0)).toBeCloseTo(CORRECTION_ANCHOR_L2, 12);
    expect(anchorLambda(12)).toBeCloseTo((CORRECTION_ANCHOR_L2 * 693) / 705, 12);
    expect(anchorLambda(120)).toBeCloseTo((CORRECTION_ANCHOR_L2 * 693) / 813, 12);
    // At the floor the anchor is still at 98.3% strength: twelve corrections
    // tilt the boundary, they do not redraw it.
    expect(anchorLambda(12) / CORRECTION_ANCHOR_L2).toBeGreaterThan(0.98);
    expect(anchorLambda(120) / CORRECTION_ANCHOR_L2).toBeGreaterThan(0.85);
  });
});

describe("the fit", () => {
  it("is a pure function: same corrections in, byte-identical layer out", () => {
    const groups = pool(12);
    const first = fitPersonalOutputLayer(BASE, groups);
    const second = fitPersonalOutputLayer(BASE, groups);
    expect(JSON.stringify(second.output)).toBe(JSON.stringify(first.output));
  });

  it("does not depend on the order the corrections arrive in", () => {
    const groups = pool(12);
    const shuffled = [...groups].reverse();
    expect(JSON.stringify(fitPersonalOutputLayer(BASE, shuffled).output)).toBe(
      JSON.stringify(fitPersonalOutputLayer(BASE, groups).output),
    );
  });

  it("with no corrections it returns theta-zero, unchanged and uncoupled", () => {
    const fit = fitPersonalOutputLayer(BASE, []);
    expect(fit.output).toEqual(BASE);
    expect(fit.driftRatio).toBe(0);
    fit.output.b[0] = 42;
    expect(BASE.b[0]).toBe(0);
  });

  it("never touches layer 0: what it returns cannot express one", () => {
    const fit = fitPersonalOutputLayer(BASE, pool(12));
    expect(Object.keys(fit.output).sort()).toEqual(["b", "w"]);
    expect(fit.output.w).toHaveLength(3);
    expect(fit.output.w[0]).toHaveLength(2);
  });

  it("moves toward the student and stays anchored to the shipped layer", () => {
    // Twelve corrections that all say "the phone reading was wrong".
    const groups = pool(12);
    const fit = fitPersonalOutputLayer(BASE, groups);

    // At the corrected point itself the head is pulled the student's way — an
    // order of magnitude more `focused` mass — without being dragged all the
    // way across a boundary it is 4:1 the wrong side of. That restraint is the
    // anchor doing its job, not the fit failing to.
    const corrected = [0.4, 1.6];
    expect(predictFromHidden(BASE, corrected).probs[0] ?? 0).toBeLessThan(0.01);
    expect(predictFromHidden(fit.output, corrected).probs[0] ?? 0).toBeGreaterThan(
      (predictFromHidden(BASE, corrected).probs[0] ?? 0) * 5,
    );

    // …and where the shipped head was genuinely close to the line, the tilt
    // is enough to change its mind.
    const near = [1.1, 1.2];
    expect(predictFromHidden(BASE, near).label).toBe("phone");
    expect(predictFromHidden(fit.output, near).label).toBe("focused");

    // …and it is still recognisably the shipped layer.
    expect(fit.driftRatio).toBeGreaterThan(0);
    expect(fit.driftRatio).toBeLessThan(CORRECTION_MAX_DRIFT_RATIO);
    expect(driftRatio(BASE, fit.output)).toBeCloseTo(fit.driftRatio, 12);
  });

  it("a pool that disagrees with everything runs into the trust region", () => {
    const far = Array.from({ length: 12 }, (_, i) =>
      group(`dc-${i}`, "focused", "train", [[0, 40 + i]]),
    );
    expect(fitPersonalOutputLayer(BASE, far).driftRatio).toBeGreaterThan(CORRECTION_MAX_DRIFT_RATIO);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * Scoring
 * ──────────────────────────────────────────────────────────────────────── */

describe("scoring", () => {
  it("balanced accuracy averages over the classes PRESENT in the slice", () => {
    // Two classes present, one of them missed entirely.
    const score = scoreAnchorSlice(BASE, [
      row("1", "proxy", "focused", [2, 0]),
      row("2", "proxy", "focused", [2, 0]),
      row("3", "proxy", "focused", [0, 2]),
      row("4", "proxy", "phone", [0, 2]),
    ]);
    expect(score.presentLabels).toEqual(["focused", "phone"]);
    expect(score.accuracy).toBeCloseTo(3 / 4, 12);
    expect(score.balanced).toBeCloseTo((2 / 3 + 1) / 2, 12);
    expect(score.groups).toBe(score.images);
  });

  it("phone precision, recall and F1 come off the same tallies", () => {
    const score = scoreAnchorSlice(BASE, [
      row("1", "adaption", "phone", [0, 2]),
      row("2", "adaption", "phone", [2, 0]),
      row("3", "adaption", "focused", [0, 2]),
    ]);
    expect(score.phone.support).toBe(2);
    expect(score.phone.recall).toBeCloseTo(0.5, 12);
    expect(score.phone.precision).toBeCloseTo(0.5, 12);
    expect(score.phone.f1).toBeCloseTo(0.5, 12);
  });

  it("a correction is scored by majority vote of its frames", () => {
    const vote = voteCorrection(
      BASE,
      group("dc-0001", "focused", "eval", [[2, 0], [2, 0], [0, 2]]),
    );
    expect(vote.predicted).toBe("focused");
    expect(vote.votes).toBe(2);
    expect(vote.frames).toBe(3);
    expect(vote.correct).toBe(true);
  });

  it("a tie inside a correction goes to the model's own most confident frame", () => {
    // One frame says focused at 0.73, one says phone at 0.88. The rule is
    // pinned here rather than left to whichever came first in the array.
    const tie = voteCorrection(BASE, group("dc-0001", "focused", "eval", [[1, 0], [0, 2]]));
    expect(tie.predicted).toBe("phone");
    const reversed = voteCorrection(BASE, group("dc-0001", "focused", "eval", [[0, 2], [1, 0]]));
    expect(reversed.predicted).toBe("phone");
  });

  it("the held-out score is stated in corrections, never in frames", () => {
    const holdout = [
      group("dc-0002", "focused", "eval", [[2, 0], [2, 0], [2, 0]]),
      group("dc-0004", "phone", "eval", [[2, 0], [2, 0], [2, 0]]),
    ];
    const scored = scoreHoldout(BASE, holdout);
    expect(scored.score?.groups).toBe(2);
    expect(scored.score?.images).toBe(6);
    expect(scored.correct).toBe(1);
    expect(scored.score?.accuracy).toBeCloseTo(0.5, 12);
    expect(scoreHoldout(BASE, []).score).toBeNull();
  });
});

describe("the interval beside the gate", () => {
  const rows = Array.from({ length: 40 }, (_, i) =>
    row(`a/${i}.jpg`, "adaption", i % 2 === 0 ? "focused" : "phone", [i % 2 === 0 ? 2 : 0.2, i % 2 === 0 ? 0.2 : 2]),
  );

  it("is deterministic run to run", () => {
    const first = pairedBootstrap(BASE, BASE, rows, 200);
    const second = pairedBootstrap(BASE, BASE, rows, 200);
    expect(second).toEqual(first);
  });

  it("is zero, with a zero-width interval, when the two heads are the same", () => {
    const interval = pairedBootstrap(BASE, BASE, rows, 200);
    expect(interval?.point).toBe(0);
    expect(interval?.lo).toBe(0);
    expect(interval?.hi).toBe(0);
    expect(interval?.draws).toBe(200);
  });

  it("defaults to the frozen draw count and refuses an empty anchor set", () => {
    expect(pairedBootstrap(BASE, BASE, rows)?.draws).toBe(CORRECTION_BOOTSTRAP_DRAWS);
    expect(pairedBootstrap(BASE, BASE, [])).toBeNull();
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * The gate — the point of the whole feature
 *
 * The fit is deterministic, so a test can run it once, look at where the two
 * heads disagree, and then choose the truths of the anchor rows to construct
 * any comparison it needs. `evaluateRefit` re-runs the same fit internally and
 * lands on the same layer, so what it scores is exactly what was engineered.
 * ──────────────────────────────────────────────────────────────────────── */

/** Hidden points where the shipped and personal heads disagree, and where they don't. */
function disagreements(personal: OutputLayer): {
  differ: Array<{ hidden: number[]; shipped: AttentionLabel; personal: AttentionLabel }>;
  agree: Array<{ hidden: number[]; label: AttentionLabel }>;
} {
  const differ: Array<{ hidden: number[]; shipped: AttentionLabel; personal: AttentionLabel }> = [];
  const agree: Array<{ hidden: number[]; label: AttentionLabel }> = [];
  for (let x = 0; x <= 30; x += 1) {
    for (let y = 0; y <= 30; y += 1) {
      const hidden = [x * 0.1, y * 0.1];
      const a = predictFromHidden(BASE, hidden).label;
      const b = predictFromHidden(personal, hidden).label;
      if (a === b) {
        agree.push({ hidden, label: a });
      } else {
        differ.push({ hidden, shipped: a, personal: b });
      }
    }
  }
  return { differ, agree };
}

describe("the gate", () => {
  /**
   * Twelve corrections, six a side, that move the boundary measurably.
   *
   * They sit just on the `phone` side of the shipped boundary (which runs
   * along x = y here), because that is what a correction IS: a reading the
   * head got wrong, and heads are wrong near their boundary far more often
   * than deep inside a class. A pool planted deep in `phone` territory would
   * need the fit to redraw the boundary rather than tilt it, which the anchor
   * is there to prevent — see the trust-region test above, which plants one
   * exactly there on purpose.
   */
  const movingPool = (): CorrectionGroupInput[] =>
    Array.from({ length: 12 }, (_, index) =>
      group(
        `dc-${String(index + 1).padStart(4, "0")}`,
        "focused",
        index % 2 === 0 ? "train" : "eval",
        [[1.0, 1.2], [1.05, 1.2], [1.1, 1.2]],
      ),
    );

  it("names every gate, in the documented order, with a detail on each", () => {
    const outcome = evaluateRefit(gateInput());
    expect(outcome.report.gates.map((entry) => entry.id)).toEqual([
      "not-custom-model",
      "session-active",
      "too-few-corrections",
      "too-few-train-groups",
      "too-few-eval-groups",
      "stale-base",
      "stale-anchors",
      "drifted-too-far",
      "regressed-pooled",
      "regressed-slice",
      "no-personal-gain",
    ]);
    for (const entry of outcome.report.gates) {
      expect(entry.detail.length, entry.id).toBeGreaterThan(0);
    }
  });

  it("every gate id is reachable, and the FIRST failure is blockedBy", () => {
    const cases: Array<[RefitGateId, RefitGateInput]> = [
      ["not-custom-model", gateInput({ deskModelId: "blazeface" })],
      ["session-active", gateInput({ sessionActive: true })],
      ["too-few-corrections", gateInput({ groups: pool(11) })],
      [
        "too-few-train-groups",
        // 12 corrections, but only five of them on the train side.
        gateInput({
          groups: pool(12).map((entry, index) => ({ ...entry, split: index < 5 ? "train" : "eval" })),
        }),
      ],
      [
        "too-few-eval-groups",
        gateInput({
          groups: pool(12).map((entry, index) => ({ ...entry, split: index < 10 ? "train" : "eval" })),
        }),
      ],
      ["stale-base", gateInput({ staleGroups: 2 })],
      ["stale-anchors", gateInput({ anchors: anchors([row("a/1.jpg", "adaption", "focused", [2, 0])], "otherhash0000000") })],
      [
        "drifted-too-far",
        gateInput({
          groups: Array.from({ length: 12 }, (_, i) =>
            group(`dc-${i}`, "focused", i % 2 === 0 ? "train" : "eval", [[0, 40 + i]]),
          ),
        }),
      ],
    ];
    for (const [id, input] of cases) {
      const outcome = evaluateRefit(input);
      expect(gate(outcome.report.gates, id), id).toBe(false);
      expect(outcome.report.blockedBy, id).toBe(id);
      expect(outcome.report.installed, id).toBe(false);
      expect(outcome.personal, id).toBeNull();
    }
  });

  it("an empty anchor pack is a stale-anchors failure, not a passing tie", () => {
    const outcome = evaluateRefit(gateInput({ anchors: anchors([]) }));
    expect(gate(outcome.report.gates, "stale-anchors")).toBe(false);
    expect(outcome.report.installed).toBe(false);
  });

  it("while a precondition is failing nothing is fitted, so the two columns are the same head", () => {
    const outcome = evaluateRefit(gateInput({ sessionActive: true, groups: movingPool() }));
    expect(outcome.report.driftRatio).toBe(0);
    expect(outcome.report.personal).toEqual(outcome.report.shipped);
    expect(outcome.report.pooledMarginCi95).toBeNull();
  });

  it("a personal head that is worse on the pooled anchors is refused", () => {
    const groups = movingPool();
    const fitted = fitPersonalOutputLayer(BASE, groups.filter((entry) => entry.split === "train"));
    const { differ, agree } = disagreements(fitted.output);
    expect(differ.length).toBeGreaterThan(3);
    // Truth agrees with the SHIPPED head everywhere they differ: the personal
    // head is now worse by construction, on images it never saw.
    const rows = [
      ...differ.map((entry, i) => row(`d/${i}.jpg`, "adaption", entry.shipped, entry.hidden)),
      ...agree.slice(0, 40).map((entry, i) => row(`s/${i}.jpg`, "adaption", entry.label, entry.hidden)),
    ];
    const outcome = evaluateRefit(gateInput({ groups, anchors: anchors(rows) }));
    expect(outcome.report.personal.pooled.balanced).toBeLessThan(outcome.report.shipped.pooled.balanced);
    expect(gate(outcome.report.gates, "regressed-pooled")).toBe(false);
    expect(outcome.report.blockedBy).toBe("regressed-pooled");
    expect(outcome.personal).toBeNull();
  });

  it("margin 0 means a tie passes the pooled gate and one image does not", () => {
    const groups = movingPool();
    const fitted = fitPersonalOutputLayer(BASE, groups.filter((entry) => entry.split === "train"));
    const { differ, agree } = disagreements(fitted.output);
    const tie = agree.slice(0, 30).map((entry, i) => row(`s/${i}.jpg`, "adaption", entry.label, entry.hidden));
    expect(gate(evaluateRefit(gateInput({ groups, anchors: anchors(tie) })).report.gates, "regressed-pooled")).toBe(true);
    expect(CORRECTION_POOLED_MARGIN_PTS).toBe(0);
    const worseByOne = [...tie, row("d/0.jpg", "adaption", (differ[0] as { shipped: AttentionLabel }).shipped, (differ[0] as { hidden: number[] }).hidden)];
    expect(
      gate(evaluateRefit(gateInput({ groups, anchors: anchors(worseByOne) })).report.gates, "regressed-pooled"),
    ).toBe(false);
  });

  it("a head that wrecks one slice while improving the pool is refused by the slice gate", () => {
    const groups = movingPool();
    const fitted = fitPersonalOutputLayer(BASE, groups.filter((entry) => entry.split === "train"));
    const { differ, agree } = disagreements(fitted.output);
    // The proxy slice: every disagreement, with the SHIPPED head's answer as
    // truth, so the personal head loses all of them. The Adaption slice: many
    // more disagreements the personal head wins, so the POOL improves.
    const proxyRows = differ
      .slice(0, 4)
      .map((entry, i) => row(`p/${i}.jpg`, "proxy", entry.shipped, entry.hidden));
    const proxyFiller = agree
      .slice(0, 36)
      .map((entry, i) => row(`pf/${i}.jpg`, "proxy", entry.label, entry.hidden));
    const adaptionRows = differ
      .slice(4)
      .map((entry, i) => row(`a/${i}.jpg`, "adaption", entry.personal, entry.hidden));
    const outcome = evaluateRefit(
      gateInput({ groups, anchors: anchors([...proxyRows, ...proxyFiller, ...adaptionRows]) }),
    );
    const { shipped, personal } = outcome.report;
    expect(personal.pooled.balanced).toBeGreaterThanOrEqual(shipped.pooled.balanced);
    expect(gate(outcome.report.gates, "regressed-pooled")).toBe(true);
    expect((shipped.proxy.balanced - personal.proxy.balanced) * 100).toBeGreaterThan(
      CORRECTION_MAX_SLICE_DROP_PTS,
    );
    expect(gate(outcome.report.gates, "regressed-slice")).toBe(false);
    expect(outcome.report.blockedBy).toBe("regressed-slice");
    expect(outcome.personal).toBeNull();
  });

  it("a head that ties everywhere is refused by no-personal-gain", () => {
    // Corrections both heads already agree with: nothing to gain, so nothing
    // to install, however harmless the new head is.
    const groups = Array.from({ length: 12 }, (_, index) =>
      group(
        `dc-${String(index + 1).padStart(4, "0")}`,
        index % 4 === 0 ? "phone" : "focused",
        index % 2 === 0 ? "train" : "eval",
        index % 4 === 0 ? [[0.1, 3]] : [[3, 0.1]],
      ),
    );
    const outcome = evaluateRefit(gateInput({ groups }));
    expect(outcome.report.personal.personalHoldoutGroupsCorrect).toBe(
      outcome.report.shipped.personalHoldoutGroupsCorrect,
    );
    expect(gate(outcome.report.gates, "regressed-pooled")).toBe(true);
    expect(gate(outcome.report.gates, "no-personal-gain")).toBe(false);
    expect(outcome.report.blockedBy).toBe("no-personal-gain");
    expect(outcome.report.installed).toBe(false);
  });

  it("installs when, and only when, all three comparisons pass", () => {
    const groups = movingPool();
    const fitted = fitPersonalOutputLayer(BASE, groups.filter((entry) => entry.split === "train"));
    const { differ, agree } = disagreements(fitted.output);
    // Truth agrees with the PERSONAL head where they differ: it is genuinely
    // better on stock, and the held-out corrections it now gets right are the
    // ones the shipped head was wrong about.
    const rows = [
      ...differ.map((entry, i) => row(`d/${i}.jpg`, "adaption", entry.personal, entry.hidden)),
      ...agree.slice(0, 40).map((entry, i) => row(`s/${i}.jpg`, "proxy", entry.label, entry.hidden)),
    ];
    const outcome = evaluateRefit(gateInput({ groups, anchors: anchors(rows) }));
    expect(outcome.report.blockedBy).toBeNull();
    expect(outcome.report.gates.every((entry) => entry.passed)).toBe(true);
    expect(outcome.report.installed).toBe(true);
    expect(outcome.report.gateEnforced).toBe(true);
    expect(outcome.personal).not.toBeNull();
    // 51 numbers in the real head; three-by-two plus three here.
    expect(outcome.personal?.w).toHaveLength(3);
    expect(
      outcome.report.personal.personalHoldoutGroupsCorrect -
        outcome.report.shipped.personalHoldoutGroupsCorrect,
    ).toBeGreaterThanOrEqual(CORRECTION_MIN_GAIN_GROUPS);
    expect(outcome.report.driftRatio).toBeLessThanOrEqual(CORRECTION_MAX_DRIFT_RATIO);
  });

  it("the escape hatch skips the three comparisons, and only those, and stamps itself", () => {
    const groups = movingPool();
    const fitted = fitPersonalOutputLayer(BASE, groups.filter((entry) => entry.split === "train"));
    const { differ, agree } = disagreements(fitted.output);
    const worse = anchors([
      ...differ.map((entry, i) => row(`d/${i}.jpg`, "adaption", entry.shipped, entry.hidden)),
      ...agree.slice(0, 20).map((entry, i) => row(`s/${i}.jpg`, "adaption", entry.label, entry.hidden)),
    ]);
    const off = evaluateRefit(gateInput({ groups, anchors: worse, gateEnforced: false }));
    expect(gate(off.report.gates, "regressed-pooled")).toBe(false);
    expect(off.report.blockedBy).toBe("regressed-pooled");
    expect(off.report.installed).toBe(true);
    expect(off.report.gateEnforced).toBe(false);
    // The claim can be skipped; it can never be faked, and a refusal that is
    // not a claim about quality is not skippable at all.
    const stillRefused = evaluateRefit(
      gateInput({ groups: pool(4), anchors: worse, gateEnforced: false }),
    );
    expect(stillRefused.report.installed).toBe(false);
    expect(stillRefused.report.blockedBy).toBe("too-few-corrections");
  });

  it("reports both heads' numbers and the corrections behind them, whatever it decides", () => {
    const outcome = evaluateRefit(gateInput({ groups: pool(12) }));
    const report = outcome.report;
    expect(Object.keys(report).sort()).toEqual(
      [
        "anchorsHash",
        "at",
        "baseHeadHash",
        "blockedBy",
        "corrections",
        "driftRatio",
        "epochs",
        "gateEnforced",
        "gates",
        "installed",
        "lambda",
        "learningRate",
        "personal",
        "pooledMarginCi95",
        "shipped",
        "v",
      ].sort(),
    );
    expect(report.corrections.total).toBe(12);
    expect(report.corrections.trainGroups + report.corrections.evalGroups).toBe(12);
    expect(report.corrections.frames).toBe(36);
    expect(report.corrections.byLabel).toEqual({ focused: 12 });
    expect(report.corrections.trainIds).toHaveLength(6);
    expect(report.shipped.pooled.images).toBe(3);
    expect(report.personal.pooled.images).toBe(3);
    // λ counts the student's corrections, held-out half included (§6.3).
    expect(report.lambda).toBeCloseTo(anchorLambda(12), 12);
    expect(report.epochs).toBe(CORRECTION_REFIT_EPOCHS);
    expect(report.learningRate).toBe(CORRECTION_REFIT_LR);
  });

  it("the bootstrap is reported beside the gate and never decides anything", () => {
    const groups = movingPool();
    const fitted = fitPersonalOutputLayer(BASE, groups.filter((entry) => entry.split === "train"));
    const { differ, agree } = disagreements(fitted.output);
    const rows = [
      ...differ.map((entry, i) => row(`d/${i}.jpg`, "adaption", entry.personal, entry.hidden)),
      ...agree.slice(0, 40).map((entry, i) => row(`s/${i}.jpg`, "proxy", entry.label, entry.hidden)),
    ];
    const outcome = evaluateRefit(gateInput({ groups, anchors: anchors(rows), bootstrapDraws: 200 }));
    const ci = outcome.report.pooledMarginCi95;
    expect(ci?.draws).toBe(200);
    expect(ci?.lo).toBeLessThanOrEqual(ci?.point ?? 0);
    expect(ci?.hi).toBeGreaterThanOrEqual(ci?.point ?? 0);
    // It installed on the point estimates alone; the interval is printed, not
    // consulted.
    expect(outcome.report.installed).toBe(true);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * The gauntlet, in miniature, on the REAL committed anchors
 * ──────────────────────────────────────────────────────────────────────── */

describe("the shipped anchors", () => {
  const pack = JSON.parse(read("src/main/desk/model/weights/attention-anchors.json")) as AttentionAnchors;
  const head = JSON.parse(read("src/main/desk/model/weights/attention-head.json")) as {
    featureDim: number;
    mean: number[];
    std: number[];
    layers: Array<{ w: number[][]; b: number[] }>;
  };
  const shipped = shippedOutputLayer(head);
  const metrics = JSON.parse(read("src/main/desk/model/weights/attention-anchors.metrics.json")) as {
    baseHeadHash: string;
    parity: { images: number; predictionsAgree: number; maxProbDelta: number };
    excluded: { nonCommercial: number; firstPerson: number };
    shipped: { pooled: { accuracy: number; balanced: number } };
  };

  it("is the 286-image held-out eval, in two slices, and nothing else", () => {
    expect(pack.v).toBe(1);
    expect(pack.hiddenDim).toBe(16);
    expect(pack.labels).toEqual([...ATTENTION_LABELS]);
    expect(pack.rows).toHaveLength(286);
    expect(pack.rows.filter((entry) => entry.slice === "adaption")).toHaveLength(200);
    expect(pack.rows.filter((entry) => entry.slice === "proxy")).toHaveLength(86);
    expect(new Set(pack.rows.map((entry) => entry.path)).size).toBe(286);
    for (const entry of pack.rows) {
      expect(entry.hidden).toHaveLength(16);
      expect(entry.hidden.every((value) => Number.isFinite(value) && value >= 0)).toBe(true);
    }
  });

  it("carries no CC BY-NC-SA image and no first-person frame", () => {
    // The licence rule and the privacy rule, asserted on the artifact rather
    // than on the builder that wrote it.
    expect(pack.rows.filter((entry) => entry.path.startsWith("nc/"))).toHaveLength(0);
    expect(pack.rows.filter((entry) => entry.path.startsWith("first-person/"))).toHaveLength(0);
    expect(metrics.excluded.nonCommercial).toBe(0);
    expect(metrics.excluded.firstPerson).toBe(0);
  });

  it("was built against the head that is committed beside it", () => {
    const hash = createHash("sha256")
      .update(readFileSync(join(repoRoot, "src/main/desk/model/weights/attention-head.json")))
      .digest("hex")
      .slice(0, 16);
    expect(pack.baseHeadHash).toBe(hash);
    expect(metrics.baseHeadHash).toBe(hash);
  });

  it("reproduces eval-attention.ts's numbers for the shipped head, to the image", () => {
    // The long way round (`eval-attention.ts` over 2025-d feature vectors,
    // against the data pack) printed these; the short way round (16
    // activations) has to agree, or the gate is scoring a different eval than
    // the one the docs quote. The builder checks it image by image with the
    // pack present; this pins the result it recorded.
    expect(metrics.parity.images).toBe(286);
    expect(metrics.parity.predictionsAgree).toBe(286);
    expect(metrics.parity.maxProbDelta).toBeLessThan(1e-4);
    const pooled = scoreAnchorSlice(shipped, pack.rows);
    expect(pooled.accuracy).toBeCloseTo(0.6189, 4);
    expect(pooled.balanced).toBeCloseTo(0.6057, 4);
    expect(pooled.phone.recall).toBeCloseTo(0.6824, 4);
    expect(pooled.accuracy).toBeCloseTo(metrics.shipped.pooled.accuracy, 12);
    const adaption = scoreAnchorSlice(shipped, pack.rows.filter((entry) => entry.slice === "adaption"));
    expect(adaption.accuracy).toBeCloseTo(0.64, 4);
    const proxy = scoreAnchorSlice(shipped, pack.rows.filter((entry) => entry.slice === "proxy"));
    expect(proxy.accuracy).toBeCloseTo(0.5698, 4);
    expect(proxy.presentLabels).toEqual(["focused", "phone"]);
  });

  it("negative control: corrections carrying no signal never install a head", () => {
    // Real activations, labels dealt against them by a fixed shuffle — there
    // is nothing here to learn. A loop that installs a head from noise is
    // worse than no loop.
    const rows = pack.rows;
    const groups: CorrectionGroupInput[] = [];
    for (let i = 0; i < 18; i += 1) {
      const frames = [rows[i * 3] , rows[i * 3 + 1], rows[i * 3 + 2]].map((entry) => ({
        hidden: (entry as AttentionAnchorRow).hidden,
      }));
      groups.push({
        id: `dc-${String(i + 1).padStart(4, "0")}`,
        label: i % 3 === 0 ? "phone" : "focused",
        split: i % 2 === 0 ? "train" : "eval",
        frames,
      });
    }
    const outcome = evaluateRefit({
      at: 1_773_000_000_000,
      deskModelId: "custom",
      sessionActive: false,
      baseHeadHash: pack.baseHeadHash,
      anchors: pack,
      anchorsHash: "anchorshash00000",
      base: shipped,
      groups,
      bootstrapDraws: 50,
    });
    expect(outcome.report.installed).toBe(false);
    expect(outcome.report.blockedBy).not.toBeNull();
    expect(outcome.personal).toBeNull();
  });

  it("the handful test: one to eleven corrections are refused every time", () => {
    for (let count = 1; count <= 11; count += 1) {
      const groups = Array.from({ length: count }, (_, i) =>
        group(`dc-${i}`, "focused", i % 2 === 0 ? "train" : "eval", [
          (pack.rows[i] as AttentionAnchorRow).hidden,
        ]),
      );
      const outcome = evaluateRefit({
        at: 1,
        deskModelId: "custom",
        sessionActive: false,
        baseHeadHash: pack.baseHeadHash,
        anchors: pack,
        anchorsHash: "anchorshash00000",
        base: shipped,
        groups,
        bootstrapDraws: 20,
      });
      expect(outcome.report.installed, `${count} correction(s)`).toBe(false);
      expect(outcome.report.blockedBy, `${count} correction(s)`).toBe("too-few-corrections");
      // …and the twelfth is where the floor stops being the reason.
      expect(outcome.report.driftRatio, `${count} correction(s)`).toBe(0);
    }
  });

  /**
   * THE REGRESSION THIS FILE EXISTS TO STOP.
   *
   * A pool of corrections can only ever be `focused` or `phone` — the paused
   * screen has two buttons. Under a three-way softmax every such frame reads
   * as evidence AGAINST `unfocused`, and measured here on the real head and
   * the real 286 anchors that costs `unfocused` recall about forty points and
   * pooled balanced accuracy about ten — on corrections the shipped head
   * already agrees with. The `regressed-pooled` gate would then refuse every
   * refit any student could ever produce, and the deferred half of the feature
   * would be dead while looking alive.
   */
  it("does not spend the class no correction can be about", () => {
    const agreeing = pack.rows.filter(
      (row) =>
        (row.truth === "focused" || row.truth === "phone") &&
        predictFromHidden(shipped, row.hidden).label === row.truth,
    );
    expect(agreeing.length).toBeGreaterThan(20);
    const groups = Array.from({ length: 12 }, (_, i) => {
      const row = agreeing[(i * 13) % agreeing.length] as AttentionAnchorRow;
      return group(`dc-${i}`, row.truth, "train", [row.hidden]);
    });
    const fitted = fitPersonalOutputLayer(shipped, groups).output;

    // The `unfocused` row and bias come out byte-identical: the student said
    // nothing about that class, so the fit says nothing about it either.
    const frozen = ATTENTION_LABELS.indexOf("unfocused");
    expect(fitted.w[frozen]).toEqual(shipped.w[frozen]);
    expect(fitted.b[frozen]).toBe(shipped.b[frozen]);

    // …and the class survives on the real eval. Some loss is honest and the
    // gate is what weighs it: raising the `focused` and `phone` logits does
    // take images that used to win as `unfocused`. What is not honest is
    // spending the class outright — measured on this pool, masked lands at
    // 37.5% against the shipped head's 53.1% (−15.6 points), and the
    // three-way softmax lands at 12.5% (−40.6). The bar sits between them, so
    // this fails the moment the mask is removed.
    const recall = (layer: OutputLayer, truth: AttentionLabel): number => {
      const rows = pack.rows.filter((row) => row.truth === truth);
      return rows.filter((row) => predictFromHidden(layer, row.hidden).label === truth).length / rows.length;
    };
    expect(recall(fitted, "unfocused")).toBeGreaterThan(recall(shipped, "unfocused") - 0.25);
  });

  it("twelve corrections move the real output layer well inside the trust region", () => {
    const groups = Array.from({ length: 12 }, (_, i) =>
      group(`dc-${i}`, "focused", "train", [
        (pack.rows[i * 5] as AttentionAnchorRow).hidden,
        (pack.rows[i * 5 + 1] as AttentionAnchorRow).hidden,
      ]),
    );
    const fit = fitPersonalOutputLayer(shipped, groups);
    expect(fit.groups).toBe(12);
    expect(fit.lambda).toBeCloseTo(anchorLambda(12), 12);
    expect(fit.driftRatio).toBeLessThan(CORRECTION_MAX_DRIFT_RATIO);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * The objective, checked numerically rather than believed
 * ──────────────────────────────────────────────────────────────────────── */

describe("the anchored objective", () => {
  const groups = pool(12).filter((entry) => entry.split === "train");
  const weights = poolWeights(groups);
  const lambda = anchorLambda(groups.length);

  /** The indices of `CORRECTABLE_LABELS`: the classes the softmax runs over. */
  const trainable = ATTENTION_LABELS.map((_, index) => index).filter((index) =>
    CORRECTABLE_LABELS.includes(ATTENTION_LABELS[index] as AttentionLabel),
  );

  /**
   * L(θ) = ( Σ wᵢ · crossEntropy(softmax_C) ) / Σ wᵢ + λ · ‖θ − θ₀‖², written
   * out — with the softmax over `CORRECTABLE_LABELS`, exactly as the file
   * documents. A pool of corrections says nothing about `unfocused`, so the
   * loss must not read it as saying `unfocused` is wrong.
   */
  function objective(layer: OutputLayer, penaltyWeight = lambda): number {
    let loss = 0;
    for (const frame of weights.frames) {
      const logits = trainable.map(
        (c) =>
          (layer.b[c] as number) +
          (layer.w[c] as number[]).reduce((sum, value, i) => sum + value * (frame.hidden[i] ?? 0), 0),
      );
      const max = Math.max(...logits);
      const exps = logits.map((logit) => Math.exp(logit - max));
      const total = exps.reduce((sum, value) => sum + value, 0) || 1;
      const target = trainable.indexOf(frame.y);
      loss += frame.weight * -Math.log(Math.max(1e-12, (exps[target] ?? 0) / total));
    }
    loss /= weights.totalWeight;
    let penalty = 0;
    for (let c = 0; c < layer.b.length; c += 1) {
      penalty += ((layer.b[c] as number) - (BASE.b[c] as number)) ** 2;
      for (let i = 0; i < (layer.w[c] as number[]).length; i += 1) {
        penalty += ((layer.w[c]?.[i] as number) - (BASE.w[c]?.[i] as number)) ** 2;
      }
    }
    return loss + penaltyWeight * penalty;
  }

  /** Central difference in one coordinate of the output layer. */
  function slope(layer: OutputLayer, c: number, i: number | "b", penaltyWeight = lambda): number {
    const step = 1e-4;
    const move = (delta: number): OutputLayer => {
      const nudged: OutputLayer = { w: layer.w.map((r) => [...r]), b: [...layer.b] };
      if (i === "b") {
        nudged.b[c] = (nudged.b[c] as number) + delta;
      } else {
        (nudged.w[c] as number[])[i] = (nudged.w[c]?.[i] as number) + delta;
      }
      return nudged;
    };
    return (objective(move(step), penaltyWeight) - objective(move(-step), penaltyWeight)) / (2 * step);
  }

  it("goes downhill from the shipped layer", () => {
    const fitted = fitPersonalOutputLayer(BASE, groups).output;
    expect(objective(fitted)).toBeLessThan(objective(BASE));
  });

  it("stops where the gradient of THAT objective is flat, not of some other one", () => {
    // A finite-difference check on the loss the file documents. If the
    // analytic gradient disagreed with it — a missing 2 on the anchor term, a
    // sum where the doc says a mean — the fit would settle somewhere this
    // objective is still sloping.
    const fitted = fitPersonalOutputLayer(BASE, groups).output;
    // Only the trainable rows: the frozen one is θ₀ by construction, and the
    // objective has no gradient in it to be stationary at.
    const coordinates: Array<[number, number | "b"]> = [];
    for (const c of trainable) {
      coordinates.push([c, 0], [c, 1], [c, "b"]);
    }
    const residual = Math.max(...coordinates.map(([c, i]) => Math.abs(slope(fitted, c, i))));
    expect(residual).toBeLessThan(2e-3);
    // …and the check has teeth: against an objective with twice the anchor
    // weight, the same point is visibly not stationary.
    const wrong = Math.max(...coordinates.map(([c, i]) => Math.abs(slope(fitted, c, i, lambda * 2))));
    expect(wrong).toBeGreaterThan(residual * 20);
  });

  it("a stronger anchor stays closer to the shipped layer — the pull is real", () => {
    // λ is a function of the number of corrections, so this is the same knob
    // the schedule turns: more corrections, weaker anchor, more movement.
    const few = fitPersonalOutputLayer(BASE, groups);
    const many = fitPersonalOutputLayer(
      BASE,
      Array.from({ length: 600 }, (_, i) => ({ ...(groups[i % groups.length] as CorrectionGroupInput), id: `dc-x${i}` })),
    );
    expect(many.lambda).toBeLessThan(few.lambda);
    expect(many.driftRatio).toBeGreaterThan(few.driftRatio);
  });
});
