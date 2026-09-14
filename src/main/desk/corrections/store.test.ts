import { describe, expect, it } from "vitest";
import { CORRECTION_CAP_GROUPS } from "@shared/correction/constants";
import { isJpeg } from "../frame";
import {
  awaySnapshot,
  createMemoryFs,
  phoneSnapshot,
  retainedRun,
  seedFrameFile,
  seedIndex,
  testFrame,
} from "./harness";
import type { HeldCapture } from "./capture";
import {
  correctionDirPath,
  correctionFilePath,
  correctionThumbRelative,
  correctionsIndexPath,
  correctionsPath,
} from "./paths";
import { CorrectionsStore, reviveCorrections } from "./store";

const DIR = "/data";

function capture(overrides: Partial<HeldCapture> = {}): HeldCapture {
  const frames = retainedRun("phone", 3);
  return {
    id: "dc-0001",
    at: 1_000_000,
    kind: "phone",
    modelLabel: "phone",
    modelConfidence: 0.94,
    deskModelId: "custom",
    expiresAt: 1_600_000,
    capped: false,
    frames,
    ...overrides,
  };
}

function makeStore(): { store: CorrectionsStore; fs: ReturnType<typeof createMemoryFs> } {
  const fs = createMemoryFs();
  return { store: new CorrectionsStore({ userDataDir: DIR, fs }), fs };
}

describe("CorrectionsStore.record", () => {
  it("writes one JPEG per frame plus a thumbnail, and one JSON record", () => {
    const { store, fs } = makeStore();
    const correction = store.record({
      capture: capture(),
      verdict: "wrong",
      day: "2026-03-12",
      baseHeadHash: "9f2c1ab4e7d05613",
      featureVersion: 2,
      retraction: null,
    });

    expect(correction.id).toBe("dc-0001");
    expect(correction.frames).toHaveLength(3);
    expect(correction.frames.map((frame) => frame.file)).toEqual([
      "frames/dc-0001/frame-0001.jpg",
      "frames/dc-0001/frame-0002.jpg",
      "frames/dc-0001/frame-0003.jpg",
    ]);
    for (const frame of correction.frames) {
      const bytes = fs.files.get(correctionFilePath(DIR, frame.file));
      expect(bytes).toBeDefined();
      expect(isJpeg(bytes as Uint8Array)).toBe(true);
      expect(frame.bytes).toBe((bytes as Uint8Array).length);
    }
    expect(fs.files.has(correctionFilePath(DIR, correctionThumbRelative("dc-0001")))).toBe(true);
    expect(fs.json.get(correctionsIndexPath(DIR))).toMatchObject({
      v: 1,
      lifetimeCorrections: 1,
    });
  });

  it("resolves the label from the kind x verdict table, never from the caller", () => {
    const { store } = makeStore();
    const wrong = store.record({
      capture: capture(),
      verdict: "wrong",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });
    expect(wrong.label).toBe("focused");
    expect(wrong.head).toBe("attention");

    const right = store.record({
      capture: capture({ kind: "away", frames: retainedRun("away", 3) }),
      verdict: "right",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });
    expect(right.label).toBe("away");
    expect(right.head).toBe("presence");
  });

  it("keeps the model's own call on each frame, not the pause's", () => {
    const { store } = makeStore();
    const frames = retainedRun("phone", 3);
    frames[1] = { ...frames[1]!, snapshot: phoneSnapshot(frames[1]!.at, 0.55) };
    const correction = store.record({
      capture: capture({ frames }),
      verdict: "right",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });
    expect(correction.frames.map((frame) => frame.predicted)).toEqual(["phone", "phone", "phone"]);
    expect(correction.frames[1]?.confidence).toBeCloseTo(0.55, 5);
  });

  it("reads an away pause off the PRESENCE head, not the attention head", () => {
    const { store } = makeStore();
    const at = 1_000_000;
    const correction = store.record({
      capture: capture({
        kind: "away",
        frames: [{ at, frame: testFrame(1), snapshot: awaySnapshot(at, 0.88) }],
      }),
      verdict: "wrong",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });
    expect(correction.frames[0]?.predicted).toBe("away");
    expect(correction.frames[0]?.confidence).toBeCloseTo(0.88, 5);
  });

  it("alternates split odd-train / even-eval, exactly as clipSplit does", () => {
    const { store } = makeStore();
    const splits: string[] = [];
    for (let i = 0; i < 4; i += 1) {
      splits.push(
        store.record({
          capture: capture(),
          verdict: "wrong",
          day: "2026-03-12",
          baseHeadHash: "h",
          featureVersion: 2,
          retraction: null,
        }).split,
      );
    }
    expect(splits).toEqual(["train", "eval", "train", "eval"]);
  });

  it("caches no activations at write time — the JPEG is the source of truth", () => {
    const { store } = makeStore();
    const correction = store.record({
      capture: capture(),
      verdict: "wrong",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });
    expect(correction.frames.every((frame) => frame.hidden === null)).toBe(true);
    expect(correction.frames.every((frame) => frame.hiddenFor === null)).toBe(true);
  });
});

describe("CorrectionsStore at the cap", () => {
  function fillToCap(store: CorrectionsStore): void {
    for (let i = 0; i < CORRECTION_CAP_GROUPS; i += 1) {
      store.record({
        capture: capture({ frames: retainedRun("phone", 1) }),
        verdict: "wrong",
        day: "2026-03-12",
        baseHeadHash: "h",
        featureVersion: 2,
        retraction: null,
      });
    }
  }

  it("stops storing photos and says so, and deletes nothing", () => {
    const { store, fs } = makeStore();
    fillToCap(store);
    expect(store.atCap()).toBe(true);
    const before = fs.files.size;
    const removedBefore = fs.removed.length;

    const capped = store.record({
      capture: capture(),
      verdict: "wrong",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });

    expect(capped.capped).toBe(true);
    expect(capped.frames).toEqual([]);
    expect(capped.bytes).toBe(0);
    // The record exists — the behavioural half is never rationed.
    expect(store.find(capped.id)).not.toBeNull();
    // And not one of the student's existing images was thrown away for it.
    expect(fs.files.size).toBe(before);
    expect(fs.removed.length).toBe(removedBefore);
  });
});

describe("CorrectionsStore delete", () => {
  it("removes the frame directory and the record together", () => {
    const { store, fs } = makeStore();
    const correction = store.record({
      capture: capture(),
      verdict: "wrong",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });
    expect(store.remove(correction.id)).toBe(true);
    expect(fs.removed).toContain(correctionDirPath(DIR, correction.id));
    expect(store.find(correction.id)).toBeNull();
    expect(store.corrections()).toHaveLength(0);
    // Lifetime is lifetime: one correction WAS made.
    expect(store.lifetimeCorrections()).toBe(1);
  });

  it("refuses an unknown id without touching anything", () => {
    const { store, fs } = makeStore();
    expect(store.remove("dc-9999")).toBe(false);
    expect(fs.removed).toEqual([]);
  });

  it("clear() takes the whole directory — index, frames, personal head, report", () => {
    const { store, fs } = makeStore();
    store.record({
      capture: capture(),
      verdict: "wrong",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });
    fs.json.set(`${correctionsPath(DIR)}/personal-attention-head.json`, { v: 1 });
    fs.json.set(`${correctionsPath(DIR)}/refit-report.json`, { v: 1 });

    store.clear();

    expect(fs.removed).toContain(correctionsPath(DIR));
    expect(fs.json.has(`${correctionsPath(DIR)}/personal-attention-head.json`)).toBe(false);
    expect(fs.json.has(`${correctionsPath(DIR)}/refit-report.json`)).toBe(false);
    expect(fs.json.has(correctionsIndexPath(DIR))).toBe(false);
    expect(store.corrections()).toEqual([]);
    expect(store.lifetimeCorrections()).toBe(0);
    expect(store.bytes()).toBe(0);
  });
});

describe("CorrectionsStore.list", () => {
  it("is newest first, carries a thumbnail, and names why a row is excluded", () => {
    const { store } = makeStore();
    store.record({
      capture: capture(),
      verdict: "wrong",
      day: "2026-03-12",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });
    store.record({
      capture: capture({ kind: "away", at: 2_000_000, frames: retainedRun("away", 2) }),
      verdict: "wrong",
      day: "2026-03-13",
      baseHeadHash: "h",
      featureVersion: 2,
      retraction: null,
    });

    const items = store.list();
    expect(items.map((item) => item.id)).toEqual(["dc-0002", "dc-0001"]);
    expect(items[0]?.excludedBecause).toBe("presence evidence — not used to retrain");
    expect(items[1]?.excludedBecause).toBeNull();
    expect(items[0]?.thumbnail?.startsWith("data:image/jpeg;base64,")).toBe(true);
    expect(items[0]?.bytes).toBeGreaterThan(0);
  });
});

describe("reviveCorrections", () => {
  const always = (): boolean => true;

  it("starts empty on a wrong version, a non-array, or garbage", () => {
    expect(reviveCorrections(null, always).corrections).toEqual([]);
    expect(reviveCorrections({ v: 2, corrections: [] }, always).corrections).toEqual([]);
    expect(reviveCorrections({ v: 1, corrections: "nope" }, always).corrections).toEqual([]);
    expect(reviveCorrections("not json at all", always).lifetimeCorrections).toBe(0);
  });

  it("drops a record with no id, a bad kind, a bad verdict or a NaN timestamp", () => {
    const file = reviveCorrections(
      {
        v: 1,
        lifetimeCorrections: 9,
        corrections: [
          { id: "", at: 1, kind: "phone", verdict: "wrong", frames: [] },
          { id: "dc-0002", at: 1, kind: "unfocused", verdict: "wrong", frames: [] },
          { id: "dc-0003", at: 1, kind: "phone", verdict: "maybe", frames: [] },
          { id: "dc-0004", at: Number.NaN, kind: "phone", verdict: "wrong", frames: [] },
          { id: "dc-0005", at: 5, kind: "phone", verdict: "right", frames: [] },
        ],
      },
      always,
    );
    expect(file.corrections.map((correction) => correction.id)).toEqual(["dc-0005"]);
    expect(file.lifetimeCorrections).toBe(9);
  });

  it("drops a duplicate id rather than storing two rows under one group", () => {
    const file = reviveCorrections(
      {
        v: 1,
        corrections: [
          { id: "dc-0001", at: 1, kind: "phone", verdict: "wrong", frames: [] },
          { id: "dc-0001", at: 2, kind: "away", verdict: "right", frames: [] },
        ],
      },
      always,
    );
    expect(file.corrections).toHaveLength(1);
    expect(file.corrections[0]?.at).toBe(1);
  });

  it("drops a frame whose JPEG is not on disk, and keeps the record", () => {
    const fs = createMemoryFs();
    seedFrameFile(fs, DIR, "frames/dc-0001/frame-0001.jpg");
    seedIndex(fs, DIR, {
      v: 1,
      lifetimeCorrections: 1,
      corrections: [
        {
          id: "dc-0001",
          at: 10,
          day: "2026-03-12",
          kind: "phone",
          verdict: "wrong",
          frames: [
            { file: "frames/dc-0001/frame-0001.jpg", at: 10, bytes: 3 },
            { file: "frames/dc-0001/frame-0002.jpg", at: 15, bytes: 3 },
          ],
        },
      ],
    });
    const store = new CorrectionsStore({ userDataDir: DIR, fs });
    expect(store.corrections()).toHaveLength(1);
    expect(store.corrections()[0]?.frames.map((frame) => frame.file)).toEqual([
      "frames/dc-0001/frame-0001.jpg",
    ]);
  });

  it("refuses a stored path that tries to escape the corrections directory", () => {
    const file = reviveCorrections(
      {
        v: 1,
        corrections: [
          {
            id: "dc-0001",
            at: 10,
            kind: "phone",
            verdict: "wrong",
            frames: [
              { file: "../../settings.json", at: 10 },
              { file: "/etc/passwd", at: 10 },
              { file: "frames/dc-0001/frame-0001.jpg", at: 10 },
            ],
          },
        ],
      },
      always,
    );
    expect(file.corrections[0]?.frames.map((frame) => frame.file)).toEqual([
      "frames/dc-0001/frame-0001.jpg",
    ]);
  });

  it("recomputes the label from the table, so a hand-edited file cannot lie", () => {
    const file = reviveCorrections(
      {
        v: 1,
        corrections: [
          {
            id: "dc-0001",
            at: 10,
            kind: "away",
            verdict: "wrong",
            // A hand-edited index claiming a presence row trains the head.
            label: "phone",
            head: "attention",
            frames: [],
          },
        ],
      },
      always,
    );
    expect(file.corrections[0]?.label).toBe("at_desk");
    expect(file.corrections[0]?.head).toBe("presence");
  });

  it("drops a cached activation that is not all finite numbers", () => {
    const fs = createMemoryFs();
    seedFrameFile(fs, DIR, "frames/dc-0001/frame-0001.jpg");
    seedIndex(fs, DIR, {
      v: 1,
      corrections: [
        {
          id: "dc-0001",
          at: 10,
          kind: "phone",
          verdict: "wrong",
          frames: [
            {
              file: "frames/dc-0001/frame-0001.jpg",
              at: 10,
              hidden: [1, null, 3],
              hiddenFor: "abc",
            },
          ],
        },
      ],
    });
    const store = new CorrectionsStore({ userDataDir: DIR, fs });
    expect(store.corrections()[0]?.frames[0]?.hidden).toBeNull();
    expect(store.corrections()[0]?.frames[0]?.hiddenFor).toBeNull();
  });

  it("survives an index that throws on read", () => {
    const fs = createMemoryFs();
    fs.readJson = (): unknown => {
      throw new Error("EACCES");
    };
    const store = new CorrectionsStore({ userDataDir: DIR, fs });
    expect(store.corrections()).toEqual([]);
    expect(store.lifetimeCorrections()).toBe(0);
  });

  it("issues the next id past the highest stored one, never reusing a group", () => {
    const fs = createMemoryFs();
    seedIndex(fs, DIR, {
      v: 1,
      lifetimeCorrections: 2,
      corrections: [{ id: "dc-0041", at: 10, kind: "phone", verdict: "wrong", frames: [] }],
    });
    const store = new CorrectionsStore({ userDataDir: DIR, fs });
    expect(store.nextId()).toBe("dc-0042");
  });
});
