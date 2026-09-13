import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ATTENTION_HEAD_LABELS } from "../../src/main/desk/model/your-model";
import {
  PACK_BASELINE_NOT_APPLICABLE,
  TWO_POPULATIONS_BANNER,
  buildAttentionEval,
  scoreSlice,
  type AttentionEval,
  type Pair,
} from "./attention-report";
import { assertClipCounted, clipCount, resolveMinGroups } from "./first-person";

/**
 * The eval is where the capture tool's honesty is either kept or quietly lost,
 * so this file pins the three things `eval-attention.ts` promises and used to
 * assert nowhere:
 *
 *   1. stock (3rd-person) and first-person rows are scored separately and
 *      never pooled — the headline stays the stock slice,
 *   2. below three independent eval clips the first-person slice prints a
 *      refusal instead of an accuracy,
 *   3. EVERY first-person number printed carries its CLIP count, not just its
 *      frame count. "(80 positives)" off three clips is the frames-as-samples
 *      inflation the whole module exists to stop.
 *
 * Everything here is pure: no weights, no data pack, no camera.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");
const labels = [...ATTENTION_HEAD_LABELS] as string[];

/** A 3rd-person stock row, in its own dHash near-duplicate group. */
function stockPair(index: number, truth: string, predicted: string, packLabel = "at_desk"): Pair {
  return {
    path: `eval/main/img_${String(index).padStart(4, "0")}.jpg`,
    truth,
    predicted,
    confidence: 0.5,
    workspace: true,
    packLabel,
    group: `img_${String(index).padStart(4, "0")}`,
    attention: truth,
  };
}

/** One webcam clip: `frames` near-identical frames sharing ONE group key. */
function clipPairs(
  clip: number,
  truth: string,
  predicted: string | ((frameIndex: number) => string),
  frames: number,
): Pair[] {
  const group = `fp-clip-${String(clip).padStart(3, "0")}`;
  return Array.from({ length: frames }, (_unused, index) => ({
    path: `first-person/${truth}/${group}/frame-${String(index + 1).padStart(4, "0")}.jpg`,
    truth,
    predicted: typeof predicted === "function" ? predicted(index) : predicted,
    confidence: 0.5,
    workspace: true,
    // Webcam rows carry the DECLARED label here, never a pack class.
    packLabel: truth,
    group,
    attention: truth,
  }));
}

const STOCK: Pair[] = [
  stockPair(1, "focused", "focused"),
  stockPair(2, "focused", "phone"),
  stockPair(3, "phone", "phone", "distracted"),
  stockPair(4, "phone", "focused", "distracted"),
  stockPair(5, "unfocused", "unfocused"),
  stockPair(6, "unfocused", "focused"),
];

/**
 * The protocol's eval half: one clip per label, 40 frames each, with the head
 * partly right on two of them — 85/120 frames correct, off 3 clips.
 */
const THREE_CLIPS: Pair[] = [
  ...clipPairs(2, "focused", (frame) => (frame < 35 ? "focused" : "unfocused"), 40),
  ...clipPairs(4, "phone", (frame) => (frame < 10 ? "phone" : "unfocused"), 40),
  ...clipPairs(6, "unfocused", "unfocused", 40),
];

function build(pairs: Pair[], over: { minGroups?: number; stockOnly?: boolean } = {}): AttentionEval {
  return buildAttentionEval({
    labels,
    pairs,
    minGroups: over.minGroups ?? resolveMinGroups(undefined),
    stockOnly: over.stockOnly ?? false,
    evaluatedAt: "2026-01-01T00:00:00.000Z",
  });
}

const PRINTS_A_NUMBER = /\d+(?:\.\d+)?\s*%|\(\d+\s*\/\s*\d+/;

describe("two populations, never pooled", () => {
  it("keeps the top-level report on the stock slice, whatever the webcam rows say", () => {
    const alone = build(STOCK);
    const mixed = build([...STOCK, ...THREE_CLIPS]);

    expect(mixed.report.population).toBe("stock");
    expect(mixed.report.overall).toEqual(mixed.report.stock.overall);
    // Adding 120 first-person frames must not move a single stock number.
    expect(mixed.report.stock).toEqual(alone.report.stock);
    expect(mixed.report.overall.total).toBe(STOCK.length);
  });

  it("says out loud that the two are separate as soon as webcam rows appear", () => {
    expect(build(STOCK).stockLines).not.toContain(TWO_POPULATIONS_BANNER);
    const mixed = build([...STOCK, ...THREE_CLIPS]);
    expect(mixed.stockLines[0]).toBe(TWO_POPULATIONS_BANNER);
    expect(mixed.stockLines.join("\n")).toContain("attention head (eval · stock 3rd-person)");
    expect(mixed.stockLines.join("\n")).toContain("(stock rows only)");
    // The first-person block is a separate block with its own headline.
    expect(mixed.firstPersonLines.join("\n")).toContain("1st-person webcam");
  });

  it("--stock-only reproduces the pre-capture block line for line", () => {
    const preCapture = build(STOCK);
    const heldOut = build([...STOCK, ...THREE_CLIPS], { stockOnly: true });
    expect(heldOut.stockLines).toEqual(preCapture.stockLines);
    expect(heldOut.report.stock).toEqual(preCapture.report.stock);
    // …and it says what it held out, in clips, rather than silently dropping it.
    expect(heldOut.report.firstPerson.excludedByStockOnly).toBe(true);
    expect(heldOut.report.firstPerson.metrics).toBeNull();
    expect(heldOut.report.firstPerson.census.groups).toBe(3);
    expect(heldOut.firstPersonLines.join("\n")).toMatch(/NOT SCORED — --stock-only/);
    expect(heldOut.firstPersonLines.join("\n")).toContain("3 independent clip(s), 120 frames");
  });

  it("refuses to print a top-level accuracy with no stock rows behind it", () => {
    expect(() => build(THREE_CLIPS)).toThrow(/No stock \(3rd-person\) eval rows/);
  });
});

describe("the group-count gate, as the eval actually wires it", () => {
  it("prints a refusal and no percentage at all below three clips", () => {
    const twoClips = [...clipPairs(2, "phone", "phone", 40), ...clipPairs(4, "focused", "focused", 40)];
    const result = build([...STOCK, ...twoClips]);

    expect(result.report.firstPerson.blockedBy).toBe("too-few-groups");
    expect(result.report.firstPerson.metrics).toBeNull();
    expect(result.firstPersonLines.join("\n")).toContain("2 independent clip(s) on the eval split, 3 needed");
    for (const line of result.firstPersonLines) {
      expect(line).not.toMatch(/\d+(\.\d+)?%/);
    }
    // 80 frames is the tempting number; it is never presented as 80 samples.
    expect(result.firstPersonLines.join("\n")).toContain("one clip is one sample");
  });

  it("refuses when a label has no eval clip, even at three clips", () => {
    const noUnfocused = [
      ...clipPairs(2, "focused", "focused", 20),
      ...clipPairs(4, "phone", "phone", 20),
      ...clipPairs(8, "phone", "phone", 20),
    ];
    const result = build([...STOCK, ...noUnfocused]);
    expect(result.report.firstPerson.blockedBy).toBe("missing-label");
    expect(result.report.firstPerson.metrics).toBeNull();
    expect(result.firstPersonLines.join("\n")).toContain("no eval clip for unfocused");
  });

  it("scores exactly at the protocol's three eval clips, one per label", () => {
    const result = build([...STOCK, ...THREE_CLIPS]);
    expect(result.report.firstPerson.blockedBy).toBeNull();
    expect(result.report.firstPerson.metrics).not.toBeNull();
    expect(result.report.firstPerson.census).toMatchObject({
      groups: 3,
      frames: 120,
      groupsByLabel: { focused: 1, phone: 1, unfocused: 1 },
    });
  });

  it("cannot be talked down through the eval's own flag path", () => {
    const twoClips = [...clipPairs(2, "phone", "phone", 999), ...clipPairs(4, "focused", "focused", 999)];
    // `--min-fp-groups 1` resolves to 3, so 1998 frames still score nothing.
    const talkedDown = build([...STOCK, ...twoClips], { minGroups: resolveMinGroups(1) });
    expect(talkedDown.report.firstPerson.minGroups).toBe(3);
    expect(talkedDown.report.firstPerson.metrics).toBeNull();
    // …and it can be raised.
    const raised = build([...STOCK, ...THREE_CLIPS], { minGroups: resolveMinGroups(6) });
    expect(raised.report.firstPerson.minGroups).toBe(6);
    expect(raised.report.firstPerson.blockedBy).toBe("too-few-groups");
    expect(raised.report.firstPerson.metrics).toBeNull();
  });
});

describe("every first-person number printed carries its clip count", () => {
  const scored = build([...STOCK, ...THREE_CLIPS]);
  const firstPerson = scored.firstPersonLines;

  it("holds for every single printed line, not just the headline", () => {
    const numeric = firstPerson.filter((line) => PRINTS_A_NUMBER.test(line));
    expect(numeric.length).toBeGreaterThanOrEqual(6);
    for (const line of numeric) {
      expect(line, `no clip count on: ${line}`).toMatch(/\bclips?\b/i);
    }
  });

  it("puts clips on the headline, on each class row and on the workspace row", () => {
    const text = firstPerson.join("\n");
    expect(text).toContain("(85/120 frames · 3 clips)"); // 35 + 10 + 40 correct
    expect(text).toMatch(/focused\s+87\.50% \(35\/40 frames · 1 clip\)/);
    expect(text).toMatch(/phone\s+25\.00% \(10\/40 frames · 1 clip\)/);
    expect(text).toMatch(/at a workspace only: .*frames · 3 clips\)/);
    expect(text).toMatch(/majority baseline \(always \w+\): .*frames · 3 clips\)/);
  });

  it("replaces the bare '(N positives)' tail on the precision/recall lines", () => {
    const offTask = firstPerson.find((line) => line.startsWith("off task"));
    expect(offTask).toBeDefined();
    // The exact shape the tool used to print off a 3-clip recording.
    expect(offTask).not.toMatch(/\(\d+ positives\)/);
    expect(offTask).toContain("(80 positive frames from 2 clips; scored over 3 clips)");
    const phone = firstPerson.find((line) => line.startsWith("phone detection"));
    expect(phone).toContain("(40 positive frames from 1 clip; scored over 3 clips)");
  });

  it("frames the whole slice as a 3-sample measurement, before and after the numbers", () => {
    expect(firstPerson.join("\n")).toContain("a clip is one sample, so this rests on 3 samples");
    expect(firstPerson.join("\n")).toContain(
      'The honest claim is "adapted toward first-person, measured on 3 clips"',
    );
  });

  it("is enforced in code: a bare frame count throws instead of printing", () => {
    expect(() =>
      assertClipCounted([
        "off task (unfocused or phone): precision 64.6% · recall 77.5% · F1 70.5% (80 positives)",
      ]),
    ).toThrow(/no clip count behind it/);
    expect(() => assertClipCounted(["attention head: 41.67% (50/120)"])).toThrow(
      /no clip count behind it/,
    );
    // Clip-counted lines and number-free refusals pass untouched.
    expect(assertClipCounted(firstPerson)).toEqual(firstPerson);
    expect(
      assertClipCounted([
        "first-person: NOT SCORED — no eval clip for phone. An accuracy that never sees a label is not an accuracy.",
      ]),
    ).toHaveLength(1);
    expect(clipCount(1)).toBe("1 clip");
    expect(clipCount(3)).toBe("3 clips");
  });

  it("carries the clip counts into the JSON report too, not only into stdout", () => {
    const metrics = scored.report.firstPerson.metrics;
    expect(metrics?.clips.overall).toEqual({
      total: 3,
      byLabel: { focused: 1, phone: 1, unfocused: 1 },
    });
    expect(metrics?.offTask.support).toBe(80);
    expect(metrics?.offTask.supportGroups).toBe(2);
    expect(metrics?.phone.supportGroups).toBe(1);
    expect(scored.report.firstPerson.note).toContain("a clip is one sample");
  });
});

describe("no baseline is manufactured for webcam rows", () => {
  it("does not score the pack's `distracted` label against rows the pack never saw", () => {
    const scored = build([...STOCK, ...THREE_CLIPS]);
    expect(scored.firstPersonLines).toContain(PACK_BASELINE_NOT_APPLICABLE);
    // A 0.0% "baseline" beside the head's number would flatter the head.
    for (const line of scored.firstPersonLines) {
      expect(line).not.toMatch(/distracted.*0\.0%/);
    }
    const packPhone = scoreSlice(labels, THREE_CLIPS).packPhone;
    expect(packPhone.precision).toBe(0); // it exists in the data, and is meaningless
    expect(packPhone.recall).toBe(0);
  });

  it("still prints the pack baseline on the stock slice, where it means something", () => {
    const scored = build([...STOCK, ...THREE_CLIPS]);
    const line = scored.stockLines.find((each) => each.startsWith("pack label"));
    expect(line).toMatch(/precision \d+\.\d%/);
    expect(scored.report.stock.packPhone.support).toBe(2);
  });
});

/**
 * A repeated path is the quietest way to lie with this report. The clip count
 * — the number the whole module exists to protect — stays exactly right,
 * while every frame count doubles and names images that no longer exist.
 */
describe("one path is one image, scored once", () => {
  const once = clipPairs(4, "phone", "phone", 40);

  it("refuses to render a report at all when a path is scored twice", () => {
    const twice = [...STOCK, ...THREE_CLIPS, ...once];
    expect(() => build(twice)).toThrow(/repeat a path already scored/);
    expect(() => build(twice)).toThrow(/counted twice/);
    // and it names the fix, which is the capture tool's --retake replacement
    expect(() => build(twice)).toThrow(/--retake/);
  });

  it("refuses a repeated stock row too, not only webcam frames", () => {
    expect(() => build([...STOCK, stockPair(1, "focused", "focused")])).toThrow(
      /repeat a path already scored/,
    );
  });

  it("shows why it must: the duplicate doubles the frames and the clips stay right", () => {
    const doubled = scoreSlice(labels, [...once, ...once]);
    expect(doubled.images).toBe(80); // 40 images, 80 rows
    expect(doubled.groups).toBe(1); // the group gate would never notice
    expect(doubled.phone.support).toBe(80); // "80 positive frames" off 40 files
  });

  it("eval-attention.ts dedupes on the way in, so the throw is a backstop", () => {
    const source = readFileSync(join(scriptDir, "eval-attention.ts"), "utf8");
    expect(source).toContain("dedupeByPath(readAttentionLabels(labelsFile))");
    expect(source).toContain("duplicatePathWarning(");
  });

  it("docs/CUSTOM-MODEL.md promises exactly this on both sides of the tool", () => {
    const doc = readFileSync(join(repoRoot, "docs", "CUSTOM-MODEL.md"), "utf8").replace(/\s+/g, " ");
    expect(doc).toContain("**One path is one row**");
    expect(doc).toContain("deduplicate by path before scoring or training");
  });
});

describe("the script is the shell, the tested module is the substance", () => {
  const source = readFileSync(join(scriptDir, "eval-attention.ts"), "utf8");

  it("eval-attention.ts delegates every scoring and printing decision here", () => {
    expect(source).toContain('from "./attention-report"');
    expect(source).toContain("buildAttentionEval({");
    // If any of this comes back into the script, it stops being covered.
    for (const escaped of ["function scoreSlice", "function printSlice", "function binary("]) {
      expect(source).not.toContain(escaped);
    }
  });

  it("prints exactly the lines the builder returns, in order", () => {
    expect(source).toMatch(/for \(const line of lines\) \{\s*console\.log\(line\);/);
    const scored = build([...STOCK, ...THREE_CLIPS]);
    expect(scored.lines).toEqual([...scored.stockLines, "", ...scored.firstPersonLines]);
  });

  it("docs/CUSTOM-MODEL.md promises the clip count and names the guard that keeps it", () => {
    const doc = readFileSync(join(repoRoot, "docs", "CUSTOM-MODEL.md"), "utf8");
    expect(doc.replace(/\s+/g, " ")).toContain(
      "Every first-person number printed carries its **clip count**, not just its frame count",
    );
    expect(doc).toContain("assertClipCounted");
  });
});
