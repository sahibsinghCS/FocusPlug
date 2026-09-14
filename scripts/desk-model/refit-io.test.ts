import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ATTENTION_LABELS, type PersonalAttentionHead, type RefitReport } from "./personal-refit";
import {
  anchorSlice,
  attentionAnchorsFile,
  attentionHeadFile,
  attentionHeadHash,
  correctionPool,
  installPersonalHead,
  isNonCommercialPath,
  loadAttentionAnchors,
  personalHeadPath,
  readCorrections,
  refitReportPath,
  saveCachedActivations,
  sha16,
  writeRefitReport,
  type StoredCorrection,
} from "./refit-io";

const dirs: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "focusplug-corrections-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  // Nothing here writes outside its own temp directory; the OS cleans them up.
  dirs.length = 0;
});

function write(dir: string, value: unknown): string {
  writeFileSync(join(dir, "corrections.json"), typeof value === "string" ? value : JSON.stringify(value));
  return dir;
}

function record(overrides: Partial<StoredCorrection> = {}): Record<string, unknown> {
  return {
    v: 1,
    id: "dc-0001",
    at: 1,
    day: "2026-09-13",
    kind: "phone",
    verdict: "wrong",
    modelLabel: "phone",
    modelConfidence: 0.94,
    label: "focused",
    head: "attention",
    split: "train",
    deskModelId: "custom",
    baseHeadHash: "hash0000",
    featureVersion: 4,
    frames: [
      {
        file: "frames/dc-0001/frame-0001.jpg",
        at: 1,
        width: 640,
        height: 480,
        bytes: 100,
        predicted: "phone",
        confidence: 0.94,
        hidden: [1, 2],
        hiddenFor: "hash0000",
      },
    ],
    bytes: 100,
    capped: false,
    retraction: null,
    ...overrides,
  };
}

describe("reading a student's directory", () => {
  it("survives every shape of broken file, and says what it dropped", () => {
    expect(readCorrections(scratch()).dropped[0]).toContain("does not exist");
    expect(readCorrections(write(scratch(), "{not json")).dropped[0]).toContain("is not JSON");
    expect(readCorrections(write(scratch(), { v: 2, corrections: [] })).dropped[0]).toContain("not a v1");
    expect(readCorrections(write(scratch(), { v: 1, corrections: {} })).dropped[0]).toContain("not a v1");
    for (const result of [
      readCorrections(scratch()),
      readCorrections(write(scratch(), "{not json")),
    ]) {
      expect(result.corrections).toEqual([]);
    }
  });

  it("drops a bad record and keeps the rest of the file", () => {
    const dir = write(scratch(), {
      v: 1,
      lifetimeCorrections: 4,
      corrections: [
        record(),
        { ...record({ id: "dc-0002" }), id: undefined },
        record({ id: "dc-0001" }),
        { ...record({ id: "dc-0003" }), split: "somewhere" },
        record({ id: "dc-0004", split: "eval" }),
      ],
    });
    const read = readCorrections(dir);
    expect(read.corrections.map((entry) => entry.id)).toEqual(["dc-0001", "dc-0004"]);
    expect(read.dropped).toEqual([
      "a record with no id",
      "dc-0001: repeated id",
      "dc-0003: split is not train or eval",
    ]);
    expect(read.lifetimeCorrections).toBe(4);
  });

  it("treats a NaN activation as no activation, and says so", () => {
    const dir = write(scratch(), {
      v: 1,
      corrections: [
        {
          ...record(),
          frames: [{ file: "frames/dc-0001/frame-0001.jpg", hidden: [1, null], hiddenFor: "hash0000" }],
        },
      ],
    });
    const read = readCorrections(dir);
    expect(read.corrections[0]?.frames[0]?.hidden).toBeNull();
    expect(read.dropped[0]).toContain("not finite numbers");
  });
});

describe("the pool the fit is allowed to see", () => {
  const pool = (records: Array<Record<string, unknown>>) =>
    correctionPool(readCorrections(write(scratch(), { v: 1, corrections: records })).corrections, "hash0000");

  it("keeps attention corrections whose activations belong to the running head", () => {
    const result = pool([record(), record({ id: "dc-0002", split: "eval" })]);
    expect(result.groups.map((group) => group.id)).toEqual(["dc-0001", "dc-0002"]);
    expect(result.groups[0]?.frames[0]?.hidden).toEqual([1, 2]);
    expect(result.stale).toEqual([]);
  });

  it("never lets an `away` correction train the attention head", () => {
    // A presence correction makes no attention claim. It is evidence for the
    // other head, and this one does not get to guess from it.
    const result = pool([
      { ...record({ id: "dc-0002" }), head: "presence", label: "at_desk", kind: "away" },
    ]);
    expect(result.groups).toEqual([]);
    expect(result.skipped).toEqual(["dc-0002"]);
  });

  it("holds back a correction whose activations were computed for another head", () => {
    const result = pool([
      {
        ...record({ id: "dc-0003" }),
        frames: [{ file: "f.jpg", hidden: [1, 2], hiddenFor: "someotherhead" }],
      },
    ]);
    expect(result.groups).toEqual([]);
    expect(result.stale).toEqual(["dc-0003"]);
    expect(result.missing).toEqual([]);
  });

  it("counts a correction with no activations as missing, not stale", () => {
    const result = pool([
      { ...record({ id: "dc-0004" }), frames: [{ file: "f.jpg", hidden: null, hiddenFor: null }] },
    ]);
    expect(result.missing).toEqual(["dc-0004"]);
    expect(result.stale).toEqual([]);
  });

  it("skips a capped record, which kept no photos by design", () => {
    const result = pool([{ ...record({ id: "dc-0005" }), frames: [], capped: true }]);
    expect(result.skipped).toEqual(["dc-0005"]);
    expect(result.missing).toEqual([]);
  });
});

describe("writing back", () => {
  const report = (installed: boolean): RefitReport =>
    ({ v: 1, at: 1, installed, blockedBy: installed ? null : "regressed-pooled" }) as RefitReport;
  const head: PersonalAttentionHead = {
    v: 1,
    baseHeadHash: "hash0000",
    labels: ATTENTION_LABELS,
    output: { w: [[1], [0], [0]], b: [0, 0, 0] },
    fittedAt: 1,
    report: report(true),
  };

  it("installs a passing head and reports where it went", () => {
    const dir = scratch();
    expect(installPersonalHead(dir, head)).toEqual({ installed: true, removed: false });
    const written = JSON.parse(readFileSync(personalHeadPath(dir), "utf8")) as PersonalAttentionHead;
    expect(written.output.b).toHaveLength(3);
    expect(written.labels).toEqual([...ATTENTION_LABELS]);
  });

  it("a failing refit DELETES the head that was there, so nothing inactive is left to load", () => {
    const dir = scratch();
    installPersonalHead(dir, head);
    expect(existsSync(personalHeadPath(dir))).toBe(true);
    expect(installPersonalHead(dir, null)).toEqual({ installed: false, removed: true });
    expect(existsSync(personalHeadPath(dir))).toBe(false);
    // …and refusing twice is not an error.
    expect(installPersonalHead(dir, null)).toEqual({ installed: false, removed: false });
  });

  it("writes the report whether it passed or not", () => {
    const dir = scratch();
    writeRefitReport(dir, report(false));
    const written = JSON.parse(readFileSync(refitReportPath(dir), "utf8")) as RefitReport;
    expect(written.installed).toBe(false);
    expect(written.blockedBy).toBe("regressed-pooled");
  });

  it("caches activations without losing anything else in the student's file", () => {
    const dir = write(scratch(), { v: 1, lifetimeCorrections: 9, corrections: [record()] });
    const patched = saveCachedActivations(dir, [
      {
        correctionId: "dc-0001",
        file: "frames/dc-0001/frame-0001.jpg",
        hidden: [7, 8],
        hiddenFor: "newhash0",
      },
    ]);
    expect(patched).toBe(1);
    const raw = JSON.parse(readFileSync(join(dir, "corrections.json"), "utf8")) as {
      lifetimeCorrections: number;
      corrections: Array<{ day: string; retraction: null; frames: Array<Record<string, unknown>> }>;
    };
    expect(raw.corrections[0]?.frames[0]?.hidden).toEqual([7, 8]);
    expect(raw.corrections[0]?.frames[0]?.hiddenFor).toBe("newhash0");
    // Fields this trainer has no opinion about survive the write.
    expect(raw.corrections[0]?.day).toBe("2026-09-13");
    expect(raw.corrections[0]?.retraction).toBeNull();
    expect(raw.corrections[0]?.frames[0]?.width).toBe(640);
    expect(raw.lifetimeCorrections).toBe(9);
  });
});

describe("the committed anchor pack", () => {
  it("loads, and its hash is the hash of the bytes on disk", () => {
    const loaded = loadAttentionAnchors();
    expect(loaded?.anchors.rows).toHaveLength(286);
    expect(loaded?.hash).toBe(sha16(readFileSync(attentionAnchorsFile())));
    expect(loaded?.anchors.baseHeadHash).toBe(attentionHeadHash());
  });

  it("is refused, not half-read, when it is not an anchor pack", () => {
    const dir = scratch();
    const file = join(dir, "anchors.json");
    writeFileSync(file, "{oops");
    expect(loadAttentionAnchors(file)).toBeNull();
    writeFileSync(file, JSON.stringify({ v: 2, baseHeadHash: "x", hiddenDim: 16, labels: ATTENTION_LABELS, rows: [] }));
    expect(loadAttentionAnchors(file)).toBeNull();
    writeFileSync(
      file,
      JSON.stringify({ v: 1, baseHeadHash: "x", hiddenDim: 16, labels: ["a", "b", "c"], rows: [] }),
    );
    expect(loadAttentionAnchors(file)).toBeNull();
    expect(loadAttentionAnchors(join(dir, "absent.json"))).toBeNull();
  });

  it("drops a malformed row rather than scoring a head against it", () => {
    const dir = scratch();
    const file = join(dir, "anchors.json");
    writeFileSync(
      file,
      JSON.stringify({
        v: 1,
        baseHeadHash: "x",
        hiddenDim: 2,
        labels: ATTENTION_LABELS,
        rows: [
          { path: "ok.jpg", slice: "adaption", truth: "focused", hidden: [1, 2] },
          { path: "short.jpg", slice: "adaption", truth: "focused", hidden: [1] },
          { path: "bad-slice.jpg", slice: "elsewhere", truth: "focused", hidden: [1, 2] },
          { path: "bad-truth.jpg", slice: "proxy", truth: "at_desk", hidden: [1, 2] },
        ],
      }),
    );
    expect(loadAttentionAnchors(file)?.anchors.rows.map((row) => row.path)).toEqual(["ok.jpg"]);
  });

  it("the head hash is sha256 of the file's bytes, first 16", () => {
    expect(attentionHeadHash()).toBe(sha16(readFileSync(attentionHeadFile())));
    expect(attentionHeadHash()).toHaveLength(16);
  });
});

describe("what may enter a committed anchor pack", () => {
  it("nothing derived from the CC BY-NC-SA bucket", () => {
    expect(isNonCommercialPath("nc/office/frame_0001.jpg")).toBe(true);
    expect(isNonCommercialPath("nc")).toBe(true);
    expect(isNonCommercialPath("eval/at_desk/nc-lookalike.jpg")).toBe(false);
    expect(isNonCommercialPath("train/away/ncsomething.jpg")).toBe(false);
  });

  it("and the two stock populations stay separable", () => {
    expect(anchorSlice({ path: "attention-proxies/hard_negative_down/x.jpg" })).toBe("proxy");
    expect(anchorSlice({ path: "eval/at_desk/main_at_desk_f1f031b4c4fb.jpg" })).toBe("adaption");
  });
});

describe("the directory itself", () => {
  it("creates nothing it was not asked to create", () => {
    const dir = join(scratch(), "nested");
    mkdirSync(dir);
    readCorrections(dir);
    correctionPool([], "hash0000");
    expect(existsSync(personalHeadPath(dir))).toBe(false);
    expect(existsSync(refitReportPath(dir))).toBe(false);
  });
});
