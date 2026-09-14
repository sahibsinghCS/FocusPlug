import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ATTENTION_HIDDEN_DIM,
  personalHeadFits,
  predictFromHidden,
  shippedOutputLayer,
  type AttentionAnchors,
  type AttentionHeadShape,
  type RefitReport,
} from "@shared/correction/refit";
import type { AttentionLabel } from "@shared/types";
import { deskRoot } from "../assets";
import { attentionHeadHash, wearPersonalAttentionHead } from "../model/your-model";
import { loadDeskHeadWeights } from "../model/your-model";
import { ATTENTION_HEAD_LABELS } from "../model/your-model";
import { createPersonalRefit } from "./refit";
import { CorrectionsStore } from "./store";

/**
 * The app's half of the refit, end to end, against the REAL shipped attention
 * head and the REAL committed anchors — the seam the CLI (`refit-attention.ts`)
 * cannot cover, because what it cannot cover is a `<userData>` directory being
 * read and written by the app itself.
 *
 * Four things, and they are the four things that were missing before the loop
 * could be believed:
 *
 *  1. a refit that passes WRITES a head, and the desk model then wears it;
 *  2. a refit that fails writes a report and NO head, and removes any head
 *     that was there — no inactive file for a bug to load by accident;
 *  3. the head is refused by the model when the base it was fitted against is
 *     not the one running;
 *  4. `personalHeadFits` — the predicate the UI's "which head is running"
 *     answer and the model's decision BOTH go through — agrees with what
 *     actually happened.
 *
 * The activations are pre-cached against the real head hash, so nothing here
 * decodes a JPEG: the fill path is the CLI's and is covered there.
 */

const headFile = join(deskRoot(), "model", "weights", "attention-head.json");
const anchorsFile = join(deskRoot(), "model", "weights", "attention-anchors.json");
const head = JSON.parse(readFileSync(headFile, "utf8")) as AttentionHeadShape;
const anchors = JSON.parse(readFileSync(anchorsFile, "utf8")) as AttentionAnchors;
const shipped = shippedOutputLayer(head);
const baseHeadHash = attentionHeadHash(headFile);

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bottleneck coordinate the 286 stock anchors vary LEAST in. */
const quietAxis = ((): number => {
  let best = 0;
  let bestVariance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < anchors.hiddenDim; i += 1) {
    const mean =
      anchors.rows.reduce((sum, entry) => sum + (entry.hidden[i] ?? 0), 0) / anchors.rows.length;
    const variance =
      anchors.rows.reduce((sum, entry) => sum + ((entry.hidden[i] ?? 0) - mean) ** 2, 0) /
      anchors.rows.length;
    if (variance < bestVariance) {
      bestVariance = variance;
      best = i;
    }
  }
  return best;
})();

const centre = Array.from({ length: anchors.hiddenDim }, (_, i) =>
  anchors.rows.reduce((sum, entry) => sum + (entry.hidden[i] ?? 0), 0) / anchors.rows.length,
);

/**
 * A student whose own room carries a cue the shipped head never had a reason
 * to learn — the same synthetic population `src/shared/correction/gauntlet.ts`
 * measures the gate against, and for the same reason: corrections drawn from
 * the stock anchors themselves would be the eval set, and fitting on the eval
 * set is not what this feature does.
 */
function writeCorrections(directory: string, count: number, seed = 4242): void {
  const random = mulberry32(seed);
  const root = join(directory, "desk-corrections");
  mkdirSync(join(root, "frames"), { recursive: true });
  const corrections = Array.from({ length: count }, (_, index) => {
    const id = `dc-${String(index + 1).padStart(4, "0")}`;
    const label: AttentionLabel = index % 2 === 0 ? "focused" : "phone";
    const hidden = centre.map((value) => Math.max(0, value * (0.7 + random() * 0.6)));
    hidden[quietAxis] = (label === "phone" ? 3 : 0) + random() * 0.2;
    const relative = `frames/${id}/frame-0001.jpg`;
    mkdirSync(join(root, "frames", id), { recursive: true });
    // A real JPEG is not needed: the activation is cached for the running head,
    // so the refit never opens the photo. The FILE must exist, because the
    // store drops a frame whose photograph is gone.
    writeFileSync(join(root, relative), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    return {
      v: 1,
      id,
      at: 1_700_000_000_000 + index,
      day: "2026-09-14",
      kind: "phone",
      verdict: label === "phone" ? "right" : "wrong",
      modelLabel: "phone",
      modelConfidence: 0.61,
      label,
      head: "attention",
      split: index % 4 === 1 || index % 4 === 2 ? "train" : "eval",
      deskModelId: "custom",
      baseHeadHash,
      featureVersion: 2,
      frames: [
        {
          file: relative,
          at: 1,
          width: 640,
          height: 480,
          bytes: 4,
          predicted: "phone",
          confidence: 0.61,
          hidden,
          hiddenFor: baseHeadHash,
        },
      ],
      bytes: 4,
      capped: false,
      retraction: null,
    };
  });
  writeFileSync(
    join(root, "corrections.json"),
    JSON.stringify({ v: 1, lifetimeCorrections: count, corrections }, null, 2),
  );
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "focusplug-refit-"));
}

function refitIn(
  directory: string,
  options: { sessionActive?: boolean; deskModelId?: "custom" | "blazeface" } = {},
): ReturnType<typeof createPersonalRefit> {
  return createPersonalRefit({
    store: new CorrectionsStore({ userDataDir: directory }),
    userDataDir: directory,
    deskModelId: () => options.deskModelId ?? "custom",
    sessionActive: () => options.sessionActive ?? false,
    attentionHeadFile: headFile,
    anchorsFile,
    now: () => 1_700_000_100_000,
  });
}

const headPath = (directory: string): string =>
  join(directory, "desk-corrections", "personal-attention-head.json");
const reportPath = (directory: string): string =>
  join(directory, "desk-corrections", "refit-report.json");

describe("the refit, in the app", () => {
  it("installs a head that wins, and the desk model then wears it", async () => {
    const directory = tempDir();
    writeCorrections(directory, 20);
    const report = await refitIn(directory).run();

    expect(report.blockedBy, JSON.stringify(report.gates.filter((g) => !g.passed))).toBeNull();
    expect(report.installed).toBe(true);
    expect(report.gateEnforced).toBe(true);
    expect(report.baseHeadHash).toBe(baseHeadHash);
    expect(report.anchorsHash).toMatch(/^[0-9a-f]{16}$/);

    // Both numbers are reported, and the personal one won on the real 286.
    expect(report.shipped.pooled.images).toBe(anchors.rows.length);
    expect(report.personal.pooled.balanced).toBeGreaterThanOrEqual(report.shipped.pooled.balanced);
    expect(
      report.personal.personalHoldoutGroupsCorrect - report.shipped.personalHoldoutGroupsCorrect,
    ).toBeGreaterThanOrEqual(1);

    // The report is always on disk; so, this time, is the head.
    expect(JSON.parse(readFileSync(reportPath(directory), "utf8"))).toMatchObject({ v: 1 });
    expect(existsSync(headPath(directory))).toBe(true);
    const stored = JSON.parse(readFileSync(headPath(directory), "utf8")) as unknown;
    expect(
      personalHeadFits(stored, baseHeadHash, ATTENTION_HIDDEN_DIM, ATTENTION_HEAD_LABELS.length),
    ).toBe(true);

    // …and the model actually puts it on. Fifty-one numbers: the last layer is
    // the student's and every earlier one is the shipped bottleneck, by
    // reference.
    const loaded = loadDeskHeadWeights(headFile, ATTENTION_HEAD_LABELS)!;
    const worn = wearPersonalAttentionHead(loaded, headPath(directory), baseHeadHash);
    expect(worn.source).toBe("personal");
    // The 1280→16 bottleneck is the SHIPPED one, shared by reference: a
    // personal head is 51 numbers and cannot express a representation.
    expect(worn.weights.layers[0]).toBe(loaded.layers[0]);
    expect(worn.weights.mean).toBe(loaded.mean);
    expect(loaded.layers[loaded.layers.length - 1]?.b).toEqual(shipped.b);
    expect(worn.weights.layers[worn.weights.layers.length - 1]?.b).not.toEqual(shipped.b);

    // The shipped head on disk was not touched by any of this.
    expect(createHash("sha256").update(readFileSync(headFile)).digest("hex").slice(0, 16)).toBe(
      baseHeadHash,
    );
  });

  it("refuses while a session is running, and leaves no head behind", async () => {
    const directory = tempDir();
    writeCorrections(directory, 20);
    await refitIn(directory).run();
    expect(existsSync(headPath(directory))).toBe(true);

    // The instrument does not change mid-measurement — and the head that was
    // there is gone, not left inactive for something to load by accident.
    const blocked = await refitIn(directory, { sessionActive: true }).run();
    expect(blocked.blockedBy).toBe("session-active");
    expect(blocked.installed).toBe(false);
    expect(existsSync(headPath(directory))).toBe(false);
    expect(existsSync(reportPath(directory))).toBe(true);

    // A precondition failure fits nothing, so the personal column IS the
    // shipped column — the truthful reading of "no personal head was made".
    expect(blocked.personal.pooled.balanced).toBe(blocked.shipped.pooled.balanced);
    expect(blocked.pooledMarginCi95).toBeNull();
  });

  it("refuses on a desk model that has no attention head at all", async () => {
    const directory = tempDir();
    writeCorrections(directory, 20);
    const report = await refitIn(directory, { deskModelId: "blazeface" }).run();
    expect(report.blockedBy).toBe("not-custom-model");
    expect(existsSync(headPath(directory))).toBe(false);
  });

  it("refuses below the floor, and names the census rather than a number", async () => {
    const directory = tempDir();
    writeCorrections(directory, 6);
    const report = await refitIn(directory).run();
    expect(report.blockedBy).toBe("too-few-corrections");
    expect(report.corrections.total).toBe(6);
    const gate = report.gates.find((entry) => entry.id === "too-few-corrections");
    expect(gate?.detail).toContain("6 attention correction(s) usable, 12 needed");
    expect(existsSync(headPath(directory))).toBe(false);
  });

  it("a head fitted against another base is left on disk and not worn", async () => {
    const directory = tempDir();
    writeCorrections(directory, 20);
    await refitIn(directory).run();
    expect(existsSync(headPath(directory))).toBe(true);

    // An app update ships a different attention head: the student's 51 numbers
    // no longer apply to the bottleneck that is running, so BOTH the model and
    // the UI predicate say shipped. Nothing is deleted and nothing is coerced.
    const shippedHead = loadDeskHeadWeights(headFile, ATTENTION_HEAD_LABELS)!;
    expect(
      wearPersonalAttentionHead(shippedHead, headPath(directory), "0000deadbeef0000").source,
    ).toBe("shipped");
    const stored = JSON.parse(readFileSync(headPath(directory), "utf8")) as unknown;
    expect(
      personalHeadFits(stored, "0000deadbeef0000", ATTENTION_HIDDEN_DIM, ATTENTION_HEAD_LABELS.length),
    ).toBe(false);
    expect(existsSync(headPath(directory))).toBe(true);
  });

  it("the escape hatch installs a loser and stamps itself, and the app can see that", async () => {
    const directory = tempDir();
    // Six train / six eval corrections is above every floor; the labels here
    // are deliberately the wrong way round, so no comparison can pass.
    const random = mulberry32(99);
    const root = join(directory, "desk-corrections");
    mkdirSync(join(root, "frames"), { recursive: true });
    const corrections = Array.from({ length: 16 }, (_, index) => {
      const id = `dc-${String(index + 1).padStart(4, "0")}`;
      // The truth is inverted against the cue, so the fit learns nonsense.
      const label: AttentionLabel = index % 2 === 0 ? "phone" : "focused";
      const hidden = centre.map((value) => Math.max(0, value * (0.7 + random() * 0.6)));
      hidden[quietAxis] = (label === "phone" ? 0 : 3) + random() * 0.2;
      const relative = `frames/${id}/frame-0001.jpg`;
      mkdirSync(join(root, "frames", id), { recursive: true });
      writeFileSync(join(root, relative), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
      return {
        v: 1, id, at: 1_700_000_000_000 + index, day: "2026-09-14", kind: "phone",
        verdict: "wrong", modelLabel: "phone", modelConfidence: 0.6, label, head: "attention",
        split: index % 4 === 1 || index % 4 === 2 ? "train" : "eval", deskModelId: "custom",
        baseHeadHash, featureVersion: 2,
        frames: [{ file: relative, at: 1, width: 640, height: 480, bytes: 4, predicted: "phone", confidence: 0.6, hidden, hiddenFor: baseHeadHash }],
        bytes: 4, capped: false, retraction: null,
      };
    });
    writeFileSync(
      join(root, "corrections.json"),
      JSON.stringify({ v: 1, lifetimeCorrections: corrections.length, corrections }, null, 2),
    );

    const enforced = await refitIn(directory).run();
    expect(enforced.installed).toBe(false);

    const off = await refitIn(directory).run({ gate: "off" });
    expect(off.installed).toBe(true);
    // The claim can be skipped; it can never be faked.
    expect(off.gateEnforced).toBe(false);
    expect(off.blockedBy).not.toBeNull();
    const stored = JSON.parse(readFileSync(headPath(directory), "utf8")) as {
      report: RefitReport;
    };
    expect(stored.report.gateEnforced).toBe(false);
  });

  it("scores both heads on the real anchors, and the shipped column is the shipped head", async () => {
    const directory = tempDir();
    writeCorrections(directory, 20);
    const report = await refitIn(directory).run();
    // Recomputed here from the pack rather than trusted from the report: if
    // the shipped column were anything but the shipped head's own numbers,
    // every margin in the UI would be measured against a fiction.
    let hits = 0;
    for (const entry of anchors.rows) {
      if (predictFromHidden(shipped, entry.hidden).label === entry.truth) {
        hits += 1;
      }
    }
    expect(report.shipped.pooled.accuracy).toBeCloseTo(hits / anchors.rows.length, 12);
    expect(report.shipped.adaption.images + report.shipped.proxy.images).toBe(anchors.rows.length);
  });
});
