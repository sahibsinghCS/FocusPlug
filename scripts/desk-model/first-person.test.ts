import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ATTENTION_HEAD_LABELS } from "../../src/main/desk/model/your-model";
import {
  buildCaptureRow,
  buildCaptureRows,
  census,
  censusLine,
  clipCollision,
  clipGroup,
  clipSplit,
  FIRST_PERSON_LABELS,
  FIRST_PERSON_MIN_EVAL_GROUPS,
  FIRST_PERSON_NOTE,
  FIRST_PERSON_PREFIX,
  FIRST_PERSON_PROTOCOL,
  FIRST_PERSON_PROTOCOL_CLIPS,
  assertFirstPersonLabel,
  ATTENTION_CSV_COLUMNS,
  attentionRowCells,
  dedupeByPath,
  duplicatePathWarning,
  firstPersonGate,
  firstPersonRefusal,
  formatAttentionRow,
  formatCsvCell,
  isFirstPersonRow,
  resolveMinGroups,
  rowsInGroup,
  type FirstPersonLabel,
} from "./first-person";
import {
  buildCapturePlan,
  captureArgv,
  csvWithClip,
  describePlan,
  electronRelaunchArgs,
  parseCaptureArgs,
  splitCsvRecords,
  staleFrameNames,
} from "./capture-plan";
import { encodeFrame } from "./capture-attention";
import { decodeImageBuffer } from "../../src/main/desk/frame";
import type { RgbFrame } from "../../src/main/desk/types";
import {
  attentionLabelsFile,
  parseCsv,
  readAttentionLabels,
  standardization,
  standardize,
  type AttentionLabelRow,
} from "./lib";

/**
 * The capture path exists to add FIRST-PERSON rows to a dataset of 3rd-person
 * stock photos without lying about how much data that is. Three things must
 * hold or the whole idea is worse than useless:
 *
 *   1. the appended rows fit the existing CSV schema exactly,
 *   2. one clip is one group, so a clip can never straddle the split,
 *   3. no first-person accuracy is printable off a handful of clips.
 *
 * Everything here runs headlessly — no camera, no Electron, no data pack.
 */

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(scriptDir, "..", "..");

function labelRow(over: Partial<AttentionLabelRow>): AttentionLabelRow {
  return {
    path: "eval/at_desk/x.jpg",
    split: "eval",
    group: "img_0001",
    attention: "focused",
    person: "face_or_body",
    workspace: "True",
    phone: "none",
    gaze: "work",
    note: "",
    packLabel: "at_desk",
    ...over,
  };
}

describe("label validation", () => {
  it("accepts exactly the three attention-head labels and nothing else", () => {
    expect([...FIRST_PERSON_LABELS].sort()).toEqual([...ATTENTION_HEAD_LABELS].sort());
    for (const label of FIRST_PERSON_LABELS) {
      expect(assertFirstPersonLabel(label)).toBe(label);
    }
  });

  it("refuses anything else, and names what it would have accepted", () => {
    for (const bad of ["distracted", "at_desk", "Phone", "phone ", "", "away", "focussed"]) {
      expect(() => assertFirstPersonLabel(bad)).toThrow(/focused, unfocused, phone/);
    }
    expect(() => assertFirstPersonLabel(undefined)).toThrow(/--label is required/);
  });

  it("--label is validated by the CLI parser too, before any camera opens", () => {
    expect(() => parseCaptureArgs(["--label", "distracted", "--clip", "1"])).toThrow(
      /focused, unfocused, phone/,
    );
    expect(() => parseCaptureArgs(["--clip", "1"])).toThrow(/--label is required/);
    expect(parseCaptureArgs(["--label", "phone", "--clip", "3"]).label).toBe("phone");
  });
});

describe("the clip id IS the group key", () => {
  it("every frame of one clip shares one group", () => {
    const rows = buildCaptureRows({ label: "phone", clip: 3, split: "eval" }, 40);
    expect(rows).toHaveLength(40);
    expect(new Set(rows.map((row) => row.group)).size).toBe(1);
    expect(rows[0]?.group).toBe("fp-clip-003");
    expect(new Set(rows.map((row) => row.path)).size).toBe(40);
  });

  it("a clip therefore cannot straddle the split — one clip, one split value", () => {
    const rows = buildCaptureRows({ label: "focused", clip: 1, split: "train" }, 12);
    expect(new Set(rows.map((row) => row.split))).toEqual(new Set(["train"]));
  });

  it("different clips are different groups, so six clips are six groups", () => {
    const groups = [1, 2, 3, 4, 5, 6].map((clip) => clipGroup(clip));
    expect(new Set(groups).size).toBe(FIRST_PERSON_PROTOCOL_CLIPS);
  });

  it("clip ids are whole numbers in range — the group key is never improvised", () => {
    for (const bad of [0, -1, 1.5, 1000, Number.NaN]) {
      expect(() => clipGroup(bad)).toThrow(/--clip/);
    }
  });

  it("odd clips train, even clips eval — the protocol order lands one clip per label per side", () => {
    const protocol: Array<[number, FirstPersonLabel]> = [
      [1, "focused"],
      [2, "focused"],
      [3, "phone"],
      [4, "phone"],
      [5, "unfocused"],
      [6, "unfocused"],
    ];
    const evalGroups = protocol.filter(([clip]) => clipSplit(clip) === "eval");
    expect(evalGroups.map(([, label]) => label).sort()).toEqual(["focused", "phone", "unfocused"]);
    expect(protocol.filter(([clip]) => clipSplit(clip) === "train")).toHaveLength(3);
  });

  it("a clip number cannot be reused for another label or the other split", () => {
    const existing = buildCaptureRows({ label: "phone", clip: 3, split: "eval" }, 4);
    expect(clipCollision(existing, { group: "fp-clip-003", attention: "focused", split: "eval" })).toMatch(
      /cannot also be focused/,
    );
    expect(clipCollision(existing, { group: "fp-clip-003", attention: "phone", split: "train" })).toMatch(
      /straddle the split/,
    );
    expect(clipCollision(existing, { group: "fp-clip-004", attention: "phone", split: "eval" })).toBeNull();
  });

  it("a stock near-duplicate group cannot be hijacked by a clip either", () => {
    const stock = [labelRow({ group: "img_0021b5c0e435", attention: "focused", split: "eval" })];
    expect(clipCollision(stock, { group: "img_0021b5c0e435", attention: "phone", split: "train" })).toMatch(
      /cannot also be phone/,
    );
  });
});

/**
 * A frame filename is a pure function of label + clip + frame index, so
 * re-recording a clip OVERWRITES its images. The documented "second take" is
 * therefore a replacement: appending a second set of rows for those same paths
 * would add no images at all, and duplicate paths are the quietest corruption
 * this pipeline has — the clip counts stay right while the frame counts name
 * images that are gone and the trainer mis-standardizes the whole run.
 */
describe("a second take REPLACES the clip, it never appends a second copy", () => {
  const take = (frames: number): AttentionLabelRow[] =>
    buildCaptureRows({ label: "phone", clip: 3, split: "eval" }, frames);

  /** A header and two stock records, written exactly as the real file is. */
  const STOCK_CSV =
    `${ATTENTION_CSV_COLUMNS.join(",")}\n` +
    "eval/main/img_0001.jpg,eval,img_0001,focused,face_or_body,True,none,work,,at_desk\n" +
    'train/main/img_0002.jpg,train,img_0002,phone,face_or_body,True,in_use,phone,"a, note",distracted\n';

  it("take two writes exactly take one's filenames — which is why it cannot be an append", () => {
    const first = buildCapturePlan(parseCaptureArgs(["--label", "phone", "--clip", "3", "--seconds", "20"]));
    const second = buildCapturePlan(
      parseCaptureArgs(["--label", "phone", "--clip", "3", "--seconds", "20", "--retake"]),
    );
    expect(second.paths).toEqual(first.paths);
    expect(first.config.retake).toBe(false);
    expect(second.config.retake).toBe(true);
  });

  it("is refused by default, and the refusal explains the overwrite", () => {
    const refusal = clipCollision(take(40), { group: "fp-clip-003", attention: "phone", split: "eval" });
    expect(refusal).toMatch(/--retake/);
    expect(refusal).toMatch(/REPLACES take one/);
    expect(refusal).toContain("40 row(s)");
    expect(refusal).toMatch(/one path, two rows/i);
  });

  it("--retake permits the replacement but is never an escape hatch for the group guard", () => {
    const existing = take(40);
    expect(
      clipCollision(existing, { group: "fp-clip-003", attention: "phone", split: "eval" }, { retake: true }),
    ).toBeNull();
    expect(
      clipCollision(existing, { group: "fp-clip-003", attention: "focused", split: "eval" }, { retake: true }),
    ).toMatch(/cannot also be focused/);
    expect(
      clipCollision(existing, { group: "fp-clip-003", attention: "phone", split: "train" }, { retake: true }),
    ).toMatch(/straddle the split/);
    expect(
      clipCollision(
        [labelRow({ group: "img_0021b5c0e435", attention: "phone", split: "eval" })],
        { group: "img_0021b5c0e435", attention: "phone", split: "train" },
        { retake: true },
      ),
    ).toMatch(/straddle the split/);
  });

  it("rowsInGroup names exactly what a retake would replace", () => {
    const existing = [...take(40), ...buildCaptureRows({ label: "focused", clip: 1, split: "train" }, 5)];
    expect(rowsInGroup(existing, "fp-clip-003")).toHaveLength(40);
    expect(rowsInGroup(existing, "fp-clip-001")).toHaveLength(5);
    expect(rowsInGroup(existing, "fp-clip-009")).toHaveLength(0);
  });

  it("the CSV after a retake holds ONE row per path, not two", () => {
    const afterFirst = csvWithClip(STOCK_CSV, "fp-clip-003", take(40));
    expect(afterFirst.replaced).toBe(0);
    const afterSecond = csvWithClip(afterFirst.text, "fp-clip-003", take(40));
    expect(afterSecond.replaced).toBe(40);
    const rows = readAttentionLabelsFromText(afterSecond.text);
    const clip = rows.filter((row) => row.group === "fp-clip-003");
    expect(clip).toHaveLength(40);
    expect(new Set(clip.map((row) => row.path)).size).toBe(40);
    expect(dedupeByPath(rows).dropped).toBe(0);
    // and the clip is still ONE group on ONE split, which is the whole point
    expect(new Set(clip.map((row) => row.split))).toEqual(new Set(["eval"]));
    expect(census(clip).groups).toBe(1);
  });

  it("a shorter retake leaves behind neither rows nor frames of the longer take", () => {
    const long = csvWithClip(STOCK_CSV, "fp-clip-003", take(40));
    const short = csvWithClip(long.text, "fp-clip-003", take(10));
    const clip = readAttentionLabelsFromText(short.text).filter((row) => row.group === "fp-clip-003");
    expect(short.replaced).toBe(40);
    expect(clip.map((row) => row.path)).toEqual(take(10).map((row) => row.path));

    const plan = buildCapturePlan(
      parseCaptureArgs(["--label", "phone", "--clip", "3", "--seconds", "5", "--retake"]),
    );
    const onDisk = take(40).map((row) => row.path.slice(row.path.lastIndexOf("/") + 1));
    const stale = staleFrameNames(onDisk, plan);
    expect(plan.frames).toBe(10);
    expect(stale).toHaveLength(30);
    expect(stale[0]).toBe("frame-0011.jpg");
    expect(staleFrameNames(["frame-0001.jpg", "README.txt"], plan)).toEqual([]);
  });

  it("every record it does not touch survives byte for byte", () => {
    const rows = take(2);
    const write = csvWithClip(STOCK_CSV, "fp-clip-003", rows);
    expect(write.text).toBe(`${STOCK_CSV}${rows.map(formatAttentionRow).join("\n")}\n`);
  });

  it("and that holds against the real labels file, quoted notes and all", () => {
    const real = readFileSync(attentionLabelsFile(), "utf8");
    const before = readAttentionLabels(attentionLabelsFile());
    const write = csvWithClip(real, "fp-clip-003", take(4));
    expect(write.replaced).toBe(0);
    expect(write.text.startsWith(real)).toBe(true);
    const after = readAttentionLabelsFromText(write.text);
    expect(after).toHaveLength(before.length + 4);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(dedupeByPath(after).dropped).toBe(0);
  });

  it("splits records on real line breaks only, never inside a quoted field", () => {
    expect(splitCsvRecords('path,note\na.jpg,"two\nlines"\nb.jpg,plain\n')).toEqual([
      "path,note\n",
      'a.jpg,"two\nlines"\n',
      "b.jpg,plain\n",
    ]);
    expect(splitCsvRecords("a\r\nb\r\n")).toEqual(["a\r\n", "b\r\n"]);
    expect(splitCsvRecords("a\nb")).toEqual(["a\n", "b"]);
    expect(splitCsvRecords("")).toEqual([]);
  });

  it("refuses to rewrite the file when it cannot tell which records are the clip's", () => {
    expect(() => csvWithClip(STOCK_CSV, "fp-clip-003", [])).toThrow(/no rows/);
    expect(() => csvWithClip("path,split\na.jpg,eval\n", "fp-clip-003", take(1))).toThrow(/group column/);
    expect(() => csvWithClip("", "fp-clip-003", take(1))).toThrow(/header/);
  });

  it("the plan says REPLACES rather than adds, so the dry run cannot mislead", () => {
    const plan = buildCapturePlan(
      parseCaptureArgs(["--label", "phone", "--clip", "3", "--retake", "--dry-run"]),
    );
    const csv = "datasets/desk-attention-labels.csv";
    expect(describePlan(plan, "/pack", csv, 40).join("\n")).toContain(
      "retake: replaces this clip's 40 existing row(s) with 40",
    );
    expect(describePlan(plan, "/pack", csv, 0).join("\n")).toContain("+40 rows");
    expect(describePlan(plan, "/pack", csv).join("\n")).toContain("+40 rows");
  });

  it("the capture script writes through that one pure function — no blind append", () => {
    const source = readFileSync(join(scriptDir, "capture-attention.ts"), "utf8");
    expect(source).toContain("csvWithClip(");
    expect(source).toContain("{ retake: config.retake }");
    expect(source).toContain("staleFrameNames(");
    // appendFileSync is what made a retake add 40 rows for 40 overwritten files.
    expect(source).not.toContain("appendFileSync");
  });

  it("the docs describe the replacement, not a second copy", () => {
    const doc = readFileSync(join(repoRoot, "docs", "CUSTOM-MODEL.md"), "utf8").replace(/\s+/g, " ");
    expect(doc).toContain("Re-recording the same clip is a **replacement, not an addition**");
    expect(doc).toContain("--retake");
    expect(doc).toContain("One path, one row");
    expect(doc).not.toContain("A clip id may be reused to add a second take");
  });
});

/**
 * The CSV has had one row per path for all of its stock rows. Everything
 * downstream quietly assumes it: the eval prints frame counts per image, and
 * the trainer standardizes over the whole train pool, so one repeated path
 * moves the mean and std of EVERY feature for EVERY row in the run.
 */
describe("one path is one image", () => {
  const pathRow = (path: string, over: Partial<AttentionLabelRow> = {}): AttentionLabelRow =>
    labelRow({ path, group: path, ...over });

  it("the real labels file has exactly one row per path — the invariant at stake", () => {
    const rows = readAttentionLabels(attentionLabelsFile());
    const distinct = dedupeByPath(rows);
    expect(rows.length).toBeGreaterThan(1900);
    expect(distinct.rows).toHaveLength(rows.length);
    expect(distinct.dropped).toBe(0);
    expect(distinct.duplicatePaths).toEqual([]);
  });

  it("keeps the first row for a path and counts every later one as a duplicate", () => {
    const distinct = dedupeByPath([
      pathRow("a.jpg", { attention: "focused" }),
      pathRow("b.jpg"),
      pathRow("a.jpg", { attention: "phone" }),
      pathRow("a.jpg"),
    ]);
    expect(distinct.rows.map((row) => row.path)).toEqual(["a.jpg", "b.jpg"]);
    expect(distinct.rows[0]?.attention).toBe("focused");
    expect(distinct.duplicatePaths).toEqual(["a.jpg"]);
    expect(distinct.dropped).toBe(2);
  });

  it("warns with the file, the paths and the fix — and stays silent when clean", () => {
    expect(duplicatePathWarning(dedupeByPath([pathRow("a.jpg"), pathRow("b.jpg")]), "x.csv")).toBeNull();
    const warning = duplicatePathWarning(dedupeByPath([pathRow("a.jpg"), pathRow("a.jpg")]), "x.csv") ?? "";
    expect(warning).toContain("x.csv");
    expect(warning).toContain("a.jpg");
    expect(warning).toMatch(/one sample counted twice/i);
    expect(warning).toMatch(/--retake/);
  });

  it("standardization divides by the vectors it actually summed", () => {
    const stats = standardization([[0], [10]], 1);
    expect(stats.count).toBe(2);
    expect(stats.mean[0]).toBeCloseTo(5, 10);
    expect(stats.std[0]).toBeCloseTo(5, 10);
    // The old trainer summed a Map that collapsed identical rows while
    // dividing by the un-collapsed count: 3 rows in, 2 summed, mean 10/3.
    const withDuplicate = standardization([[10], [10], [0]], 1);
    expect(withDuplicate.count).toBe(3);
    expect(withDuplicate.mean[0]).toBeCloseTo(20 / 3, 10);
    expect(standardization([], 2).count).toBe(0);
  });

  it("standardize z-scores against those stats, and a flat feature survives it", () => {
    const stats = standardization(
      [
        [0, 4],
        [10, 4],
      ],
      2,
    );
    const x = standardize([10, 9], stats);
    expect(x[0]).toBeCloseTo(1, 10);
    expect(x[1]).toBeCloseTo(5, 10); // std 0 divides by 1, never by 0
  });

  it("the eval and the trainer both dedupe before they count anything", () => {
    for (const name of ["eval-attention.ts", "train-attention.ts"]) {
      const source = readFileSync(join(scriptDir, name), "utf8");
      expect(source).toContain("dedupeByPath(");
      expect(source).toContain("duplicatePathWarning(");
    }
  });

  it("the trainer no longer sums a Map keyed by the feature row", () => {
    const source = readFileSync(join(scriptDir, "train-attention.ts"), "utf8");
    expect(source).toContain("standardization(");
    // Both halves of the old bug: a Map that collapsed duplicate rows, and a
    // divisor that was not the population summed.
    expect(source).not.toMatch(/new Map\(\s*pairs\.map/);
    expect(source).not.toContain("/ pairs.length");
  });
});

describe("CSV row construction", () => {
  const row = buildCaptureRow({ label: "phone", clip: 3, split: "eval", frameIndex: 7 });

  it("fills every column of the existing schema, in order", () => {
    expect(ATTENTION_CSV_COLUMNS).toEqual([
      "path",
      "split",
      "group",
      "attention",
      "person",
      "workspace",
      "phone",
      "gaze",
      "note",
      "pack_label",
    ]);
    expect(attentionRowCells(row)).toEqual([
      "first-person/phone/fp-clip-003/frame-0007.jpg",
      "eval",
      "fp-clip-003",
      "phone",
      "face_or_body",
      "True",
      "in_use",
      "phone",
      FIRST_PERSON_NOTE,
      "phone",
    ]);
  });

  it("matches the header of the real datasets/desk-attention-labels.csv", () => {
    const header = parseCsv(readFileSync(attentionLabelsFile(), "utf8").slice(0, 400))[0];
    expect(header).toEqual([...ATTENTION_CSV_COLUMNS]);
  });

  it("pack_label is the label the user declared, not a desk-data pack class", () => {
    for (const label of FIRST_PERSON_LABELS) {
      const built = buildCaptureRow({ label, clip: 1, split: "train", frameIndex: 1 });
      expect(built.packLabel).toBe(label);
      expect(built.attention).toBe(label);
    }
  });

  it("the note says where the row came from and that nothing annotated it", () => {
    expect(row.note).toBe("first-person webcam capture, self-labelled by clip");
  });

  it("quotes only the cells that need it, and survives a round trip", () => {
    expect(formatCsvCell("plain")).toBe("plain");
    expect(formatCsvCell("has, comma")).toBe('"has, comma"');
    expect(formatCsvCell('say "hi"')).toBe('"say ""hi"""');
    const line = formatAttentionRow(row);
    expect(line).toContain(`"${FIRST_PERSON_NOTE}"`); // the note has a comma
    expect(parseCsv(`${line}\n`)[0]).toEqual(attentionRowCells(row));
  });

  it("appending the rows to the real CSV still parses, with the clip as one group", () => {
    const text = readFileSync(attentionLabelsFile(), "utf8");
    const rows = buildCaptureRows({ label: "unfocused", clip: 6, split: "eval" }, 3);
    const appended = readAttentionLabelsFromText(
      text + rows.map(formatAttentionRow).join("\n") + "\n",
    );
    const mine = appended.filter((each) => each.group === "fp-clip-006");
    expect(mine).toHaveLength(3);
    expect(new Set(mine.map((each) => each.split))).toEqual(new Set(["eval"]));
    expect(new Set(mine.map((each) => each.attention))).toEqual(new Set(["unfocused"]));
    expect(mine.every(isFirstPersonRow)).toBe(true);
  });

  it("marks first-person rows by path prefix, and leaves stock rows alone", () => {
    expect(isFirstPersonRow(row)).toBe(true);
    expect(row.path.startsWith(FIRST_PERSON_PREFIX)).toBe(true);
    expect(readAttentionLabels(attentionLabelsFile()).some(isFirstPersonRow)).toBe(false);
  });
});

/** parseCsv + the same column mapping readAttentionLabels uses, on a string. */
function readAttentionLabelsFromText(text: string): AttentionLabelRow[] {
  const [header, ...rows] = parseCsv(text);
  const at = (name: string): number => (header ?? []).indexOf(name);
  return rows
    .filter((cells) => cells.length > 1)
    .map((cells) => ({
      path: cells[at("path")] ?? "",
      split: cells[at("split")] === "eval" ? ("eval" as const) : ("train" as const),
      group: cells[at("group")] ?? "",
      attention: cells[at("attention")] ?? "",
      person: cells[at("person")] ?? "",
      workspace: cells[at("workspace")] ?? "",
      phone: cells[at("phone")] ?? "",
      gaze: cells[at("gaze")] ?? "",
      note: cells[at("note")] ?? "",
      packLabel: cells[at("pack_label")] ?? "",
    }));
}

describe("the group-count guard", () => {
  /** `frames` frames of one clip, all carrying `label`. */
  function clip(group: string, label: string, frames: number): Array<{ group: string; attention: string }> {
    return Array.from({ length: frames }, () => ({ group, attention: label }));
  }

  const protocolEval = [
    ...clip("fp-clip-002", "focused", 40),
    ...clip("fp-clip-004", "phone", 40),
    ...clip("fp-clip-006", "unfocused", 40),
  ];

  it("counts clips, not frames — 120 frames of 3 clips is 3 samples", () => {
    const counts = census(protocolEval);
    expect(counts.frames).toBe(120);
    expect(counts.groups).toBe(3);
    expect(counts.groupsByLabel).toEqual({ focused: 1, phone: 1, unfocused: 1 });
    expect(censusLine(counts)).toContain("3 independent clip(s), 120 frames");
  });

  it("refuses to score nothing at all", () => {
    expect(firstPersonGate(census([]))).toBe("no-rows");
  });

  it("refuses a number below the minimum, however many frames back it", () => {
    // Two clips, 2000 frames: the tempting big-N lie this gate exists to stop.
    const twoClips = [...clip("fp-clip-002", "phone", 1000), ...clip("fp-clip-004", "focused", 1000)];
    const counts = census(twoClips);
    expect(counts.frames).toBe(2000);
    expect(firstPersonGate(counts)).toBe("too-few-groups");
    expect(firstPersonRefusal("too-few-groups", counts)).toMatch(/one clip is one sample/i);
    expect(firstPersonRefusal("too-few-groups", counts)).toContain("2 independent clip(s)");
  });

  it("refuses when a label has no eval clip, even with enough clips", () => {
    const noUnfocused = [
      ...clip("fp-clip-002", "focused", 20),
      ...clip("fp-clip-004", "phone", 20),
      ...clip("fp-clip-008", "phone", 20),
    ];
    const counts = census(noUnfocused);
    expect(counts.groups).toBe(3);
    expect(firstPersonGate(counts)).toBe("missing-label");
    expect(firstPersonRefusal("missing-label", counts)).toContain("unfocused");
  });

  it("passes exactly at the protocol's three eval clips, one per label", () => {
    expect(FIRST_PERSON_MIN_EVAL_GROUPS).toBe(3);
    expect(firstPersonGate(census(protocolEval))).toBeNull();
  });

  it("every gate has its own sentence, and none of them prints a percentage", () => {
    const sentences = (["no-rows", "too-few-groups", "missing-label"] as const).map((gate) =>
      firstPersonRefusal(gate, census(protocolEval)),
    );
    expect(new Set(sentences).size).toBe(3);
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\d+(\.\d+)?%/);
    }
  });

  it("the minimum can be raised but never lowered — no flag talks it down", () => {
    expect(resolveMinGroups(undefined)).toBe(FIRST_PERSON_MIN_EVAL_GROUPS);
    expect(resolveMinGroups(6)).toBe(6);
    expect(resolveMinGroups(1)).toBe(FIRST_PERSON_MIN_EVAL_GROUPS);
    expect(resolveMinGroups(0)).toBe(FIRST_PERSON_MIN_EVAL_GROUPS);
    expect(resolveMinGroups(-99)).toBe(FIRST_PERSON_MIN_EVAL_GROUPS);
    expect(firstPersonGate(census(protocolEval), resolveMinGroups(6))).toBe("too-few-groups");
  });
});

describe("the capture plan (what --dry-run prints, and what a real run does)", () => {
  it("frames follow seconds × fps, and the rows match the frames one for one", () => {
    const plan = buildCapturePlan(parseCaptureArgs(["--label", "phone", "--seconds", "20", "--clip", "3"]));
    expect(plan.frames).toBe(40); // 20s at the default 2 fps
    expect(plan.intervalMs).toBe(500);
    expect(plan.rows).toHaveLength(plan.frames);
    expect(plan.paths).toEqual(plan.rows.map((row) => row.path));
    expect(plan.config.split).toBe("train"); // clip 3 is odd
    expect(new Set(plan.rows.map((row) => row.group))).toEqual(new Set([plan.group]));
  });

  it("defaults: 20 seconds, 2 fps, 3-second countdown, split by clip parity", () => {
    const config = parseCaptureArgs(["--label", "focused", "--clip", "1"]);
    expect(config.seconds).toBe(20);
    expect(config.fps).toBe(2);
    expect(config.countdownSec).toBe(3);
    expect(config.split).toBe("train");
    expect(config.splitFrom).toBe("clip");
    expect(config.dryRun).toBe(false);
    expect(config.source).toBe("auto");
  });

  it("rejects nonsense flags instead of recording something useless", () => {
    const base = ["--label", "focused", "--clip", "1"];
    expect(() => parseCaptureArgs([...base, "--seconds", "0"])).toThrow(/--seconds/);
    expect(() => parseCaptureArgs([...base, "--seconds", "abc"])).toThrow(/--seconds/);
    expect(() => parseCaptureArgs([...base, "--fps", "60"])).toThrow(/--fps/);
    expect(() => parseCaptureArgs([...base, "--split", "holdout"])).toThrow(/--split/);
    expect(() => parseCaptureArgs([...base, "--source", "obs"])).toThrow(/--source/);
    expect(() => parseCaptureArgs(["--label", "focused"])).toThrow(/--clip is required/);
  });

  it("--dry-run is a flag, not a value, so it can never be mistaken for a label", () => {
    const config = parseCaptureArgs(["--label", "unfocused", "--clip", "5", "--dry-run"]);
    expect(config.dryRun).toBe(true);
    expect(config.label).toBe("unfocused");
  });

  it("--split overrides parity and says so, for a seventh clip", () => {
    const config = parseCaptureArgs(["--label", "phone", "--clip", "7", "--split", "eval"]);
    expect(config.split).toBe("eval");
    expect(config.splitFrom).toBe("flag");
  });

  it("relaunch args carry the script and, on Linux, the sandbox switch", () => {
    expect(electronRelaunchArgs("/x/boot.mjs", "linux")).toEqual(["--no-sandbox", "/x/boot.mjs"]);
    expect(electronRelaunchArgs("/x/boot.mjs", "win32")).toEqual(["/x/boot.mjs"]);
  });

  it("flags survive the relaunch through the env var, not through argv", () => {
    const args = ["--label", "phone", "--clip", "3"];
    expect(captureArgv({ FOCUSPLUG_CAPTURE_ARGS: JSON.stringify(args) }, ["electron", "boot.mjs"])).toEqual(
      args,
    );
    expect(captureArgv({}, ["node", "capture-attention.ts", "--label", "phone"])).toEqual([
      "--label",
      "phone",
    ]);
    expect(() => captureArgv({ FOCUSPLUG_CAPTURE_ARGS: '"nope"' }, [])).toThrow(/array of strings/);
  });
});

describe("the frames it writes", () => {
  /** A 16×8 gradient, so a channel swap would be visible in the decode. */
  function testFrame(): RgbFrame {
    const width = 16;
    const height = 8;
    const data = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i += 1) {
      data[i * 3] = 200;
      data[i * 3 + 1] = 40;
      data[i * 3 + 2] = 10;
    }
    return { width, height, data };
  }

  it("are JPEGs the feature extractor can decode, at the captured size", () => {
    const jpeg = encodeFrame(testFrame(), 88);
    expect(jpeg[0]).toBe(0xff);
    expect(jpeg[1]).toBe(0xd8);
    const decoded = decodeImageBuffer(new Uint8Array(jpeg));
    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(8);
    // Red stays red: RGB→RGBA→JPEG must not rotate the channels.
    expect(decoded.data[0]).toBeGreaterThan(150);
    expect(decoded.data[1]).toBeLessThan(90);
    expect(decoded.data[2]).toBeLessThan(70);
  });
});

describe("the protocol the user is asked to follow", () => {
  const doc = readFileSync(join(repoRoot, "docs", "CUSTOM-MODEL.md"), "utf8");
  const flat = (text: string): string => text.replace(/\s+/g, " ").trim();

  it("is six clips and about two minutes, with no labelling step", () => {
    const text = FIRST_PERSON_PROTOCOL.join(" ");
    expect(text).toContain("Six clips");
    expect(text).toContain("two focused, two phone, two unfocused");
    expect(text).toMatch(/two minutes/);
    expect(text).toMatch(/no labelling step/);
    expect(text).toMatch(/lighting/);
    expect(text).toMatch(/angle/);
    expect(text).toMatch(/time of day/);
  });

  it("says why six short clips beat one long one", () => {
    expect(FIRST_PERSON_PROTOCOL.join(" ")).toMatch(
      /six independent groups; one long clip is one group/i,
    );
  });

  it("appears verbatim in docs/CUSTOM-MODEL.md, so the two cannot drift", () => {
    for (const line of FIRST_PERSON_PROTOCOL) {
      expect(flat(doc)).toContain(flat(line));
    }
  });

  it("the docs refuse a new headline accuracy after six clips", () => {
    expect(flat(doc)).toContain(flat("adapted toward first-person, measured on"));
    expect(doc).toMatch(/not a new headline accuracy/i);
  });
});
