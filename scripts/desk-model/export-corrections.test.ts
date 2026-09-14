import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { csvWithClip } from "./capture-plan";
import { ATTENTION_CSV_COLUMNS, isFirstPersonRow, clipSplit } from "./first-person";
import { parseCsv, type AttentionLabelRow } from "./lib";
import {
  CORRECTION_MEANING,
  CORRECTIONS_PREFIX,
  censusLines,
  correctionNote,
  correctionNumber,
  exportedPath,
  planExport,
} from "./export-corrections";
import type { StoredCorrection } from "./refit-io";

const here = dirname(fileURLToPath(import.meta.url));
const read = (relative: string): string => readFileSync(join(here, "..", "..", relative), "utf8");

function stored(overrides: Partial<StoredCorrection> = {}): StoredCorrection {
  return {
    id: "dc-0007",
    at: 1_773_000_000_000,
    kind: "phone",
    verdict: "wrong",
    modelLabel: "phone",
    modelConfidence: 0.9412,
    label: "focused",
    head: "attention",
    split: "train",
    baseHeadHash: "a7738e7a295dbb5e",
    frames: [
      { file: "frames/dc-0007/frame-0001.jpg", at: 1, bytes: 34112, predicted: "phone", confidence: 0.94, hidden: null, hiddenFor: null },
      { file: "frames/dc-0007/frame-0002.jpg", at: 2, bytes: 34112, predicted: "phone", confidence: 0.95, hidden: null, hiddenFor: null },
    ],
    capped: false,
    ...overrides,
  };
}

describe("the kind x verdict table", () => {
  it("is the one frozen in docs/CORRECTION-LOOP.md", () => {
    // The exporter derives person / workspace / phone / gaze from the verdict
    // rather than observing them, so the table IS the label. It may not drift.
    const doc = read("docs/CORRECTION-LOOP.md");
    const fenceAt = doc.indexOf("## 3. The `kind × verdict` table");
    const fence = doc.slice(doc.indexOf("```ts", fenceAt), doc.indexOf("```", doc.indexOf("```ts", fenceAt) + 5));
    for (const [key, meaning] of Object.entries(CORRECTION_MEANING)) {
      const block = fence.slice(fence.indexOf(`"${key}"`), fence.indexOf("},", fence.indexOf(`"${key}"`)));
      expect(block, key).toContain(`label: "${meaning.label}"`);
      expect(block, key).toContain(`head: "${meaning.head}"`);
      expect(block, key).toContain(`attention: "${meaning.attention}"`);
      expect(block, key).toContain(`packLabel: "${meaning.packLabel}"`);
      expect(block, key).toContain(`person: "${meaning.person}"`);
      expect(block, key).toContain(`gaze: "${meaning.gaze}"`);
      expect(block, key).toContain(`phoneCell: "${meaning.phoneCell}"`);
    }
    expect(Object.keys(CORRECTION_MEANING).sort()).toEqual([
      "away:right",
      "away:wrong",
      "phone:right",
      "phone:wrong",
    ]);
  });

  it("gives a presence correction no attention label at all", () => {
    // An `away` correction is evidence about the presence head. Exporting it
    // with an attention label would teach the attention head from a claim the
    // student never made.
    expect(CORRECTION_MEANING["away:wrong"]?.attention).toBe("");
    expect(CORRECTION_MEANING["away:right"]?.attention).toBe("");
    expect(CORRECTION_MEANING["phone:wrong"]?.attention).toBe("focused");
  });
});

describe("the exported rows", () => {
  it("land under first-person/, which is what makes the rest of the pipeline work", () => {
    const path = exportedPath("dc-0007", "frames/dc-0007/frame-0002.jpg");
    expect(path).toBe(`${CORRECTIONS_PREFIX}dc-0007/frame-0002.jpg`);
    expect(isFirstPersonRow({ path })).toBe(true);
  });

  it("are one group per correction, split by the odd-train/even-eval rule", () => {
    const plan = planExport([stored({ id: "dc-0007", split: "train" }), stored({ id: "dc-0008", split: "eval" })], []);
    expect(plan.groups.map((group) => group.id)).toEqual(["dc-0007", "dc-0008"]);
    expect(plan.groups[0]?.rows.every((row) => row.group === "dc-0007")).toBe(true);
    expect(plan.groups[0]?.split).toBe(clipSplit(7));
    expect(plan.groups[1]?.split).toBe(clipSplit(8));
    // Every frame of one correction is on one side of the split.
    expect(new Set(plan.groups[0]?.rows.map((row) => row.split)).size).toBe(1);
  });

  it("carry the ten existing columns, derived from the verdict", () => {
    const [group] = planExport([stored()], []).groups;
    const row = group?.rows[0] as AttentionLabelRow;
    expect(Object.keys(row)).toHaveLength(ATTENTION_CSV_COLUMNS.length);
    expect(row.attention).toBe("focused");
    expect(row.packLabel).toBe("focused");
    expect(row.person).toBe("face_or_body");
    expect(row.workspace).toBe("True");
    expect(row.phone).toBe("none");
    expect(row.gaze).toBe("work");
  });

  it("keep the model's own call next to the truth, on every row", () => {
    const note = correctionNote(stored());
    expect(note).toBe(
      "first-person correction: the model said phone at 0.94, the student said focused; labelled in-app at the pause, not annotated",
    );
    expect(note).toContain("not annotated");
    const [group] = planExport([stored()], []).groups;
    expect(group?.rows.every((row) => row.note === note)).toBe(true);
  });

  it("say nothing about accuracy, and count corrections rather than photos", () => {
    const lines = censusLines(planExport([stored(), stored({ id: "dc-0008", split: "eval" })], []));
    expect(lines[0]).toContain("2 correction(s)");
    expect(lines[1]).toContain("4 photo(s)");
    for (const line of lines) {
      expect(line).not.toMatch(/\d+(\.\d+)?%/);
    }
  });
});

describe("what it refuses", () => {
  it("skips a correction that kept no photos, and says which", () => {
    const plan = planExport([stored({ id: "dc-0009", frames: [], capped: true })], []);
    expect(plan.groups).toHaveLength(0);
    expect(plan.skipped[0]?.[0]).toBe("dc-0009");
    expect(plan.skipped[0]?.[1]).toContain("cap");
  });

  it("skips an id it cannot assign a split to", () => {
    expect(correctionNumber("dc-0007")).toBe(7);
    expect(correctionNumber("dc-x")).toBeNull();
    const plan = planExport([stored({ id: "dc-x" })], []);
    expect(plan.groups).toHaveLength(0);
    expect(plan.skipped[0]?.[1]).toContain("dc-NNNN");
  });

  it("skips a record whose stored split disagrees with the rule", () => {
    // Odd correction numbers train. A record that says otherwise was not
    // written by this feature, and guessing which side is right would put a
    // correction's frames on both sides of somebody's eval.
    const plan = planExport([stored({ id: "dc-0007", split: "eval" })], []);
    expect(plan.groups).toHaveLength(0);
    expect(plan.skipped[0]?.[1]).toContain("odd-train/even-eval");
  });

  it("refuses a group already in the CSV under a different label", () => {
    const existing: AttentionLabelRow[] = [
      {
        path: "first-person/corrections/dc-0007/frame-0001.jpg",
        split: "train",
        group: "dc-0007",
        attention: "phone",
        person: "face_or_body",
        workspace: "True",
        phone: "in_use",
        gaze: "phone",
        note: "",
        packLabel: "phone",
      },
    ];
    const plan = planExport([stored()], existing);
    expect(plan.groups).toHaveLength(0);
    expect(plan.collisions[0]?.[0]).toBe("dc-0007");
    expect(plan.collisions[0]?.[1]).toContain("cannot also be focused");
  });

  it("re-exporting the same correction REPLACES its rows rather than duplicating a path", () => {
    // One path is one image on disk. The exporter goes through the capture
    // tool's own `csvWithClip`, so a second export of dc-0007 drops the first
    // one's rows instead of appending a second set for the same files.
    const header = `${ATTENTION_CSV_COLUMNS.join(",")}\n`;
    const [group] = planExport([stored()], []).groups;
    const first = csvWithClip(header, "dc-0007", group?.rows ?? []);
    expect(first.replaced).toBe(0);
    const second = csvWithClip(first.text, "dc-0007", group?.rows ?? []);
    expect(second.replaced).toBe(2);
    const paths = parseCsv(second.text)
      .slice(1)
      .filter((cells) => cells.length > 1)
      .map((cells) => cells[0]);
    expect(paths).toHaveLength(2);
    expect(new Set(paths).size).toBe(2);
  });
});
