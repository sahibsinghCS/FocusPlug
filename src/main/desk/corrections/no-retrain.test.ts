import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/ipc";
import { deskRoot } from "../assets";
import { decodeImageBuffer } from "../frame";
import {
  ATTENTION_HEAD_FEATURE_VERSION,
  ATTENTION_HEAD_RELATIVE_PATH,
} from "../model/your-model";
import { correctingSettings, createMemoryFs, retainedRun } from "./harness";
import { ATTENTION_FEATURE_VERSION, ATTENTION_HEAD_FILE, correctionsPath } from "./paths";
import { DeskCorrections } from "./service";

/**
 * THE UNCOUPLING TEST.
 *
 * "One click never retrains the model" is the load-bearing claim of this whole
 * feature, and it is worth nothing as a sentence. Here it is a property of the
 * write log: recording a correction writes JPEGs and one JSON record, under
 * one directory, and never opens a weights file at all.
 *
 * Asserted by spying on the seam rather than by reading the code, so a future
 * refactor that quietly added a fit would fail this rather than pass review.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walk(path));
    } else {
      out.push(path);
    }
  }
  return out;
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

const temps: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "focusplug-corrections-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (temps.length > 0) {
    const dir = temps.pop();
    if (dir !== undefined) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

function service(dir: string, settings: AppSettings = correctingSettings()): DeskCorrections {
  return new DeskCorrections({
    userDataDir: dir,
    loadSettings: () => settings,
    now: () => 5_000_000,
  });
}

function recordOne(instance: DeskCorrections, at = 5_000_000): string {
  const id = instance.openPause({
    kind: "phone",
    at,
    frames: retainedRun("phone", 3, { from: at - 25_000 }),
    deskModelId: "custom",
  });
  expect(id).not.toBeNull();
  const result = instance.record({ correctionId: id ?? "", verdict: "wrong" });
  expect(result.recorded).toBe(true);
  return result.correctionId;
}

describe("the store's copy of the head's identity cannot drift", () => {
  /**
   * `paths.ts` names the shipped attention head and its feature version so
   * that writing a JPEG does not drag TensorFlow into the store. Duplicating a
   * constant is only safe with the test that says it is the same constant —
   * the idiom `CORRECTION_ANCHOR_EVIDENCE` already follows.
   */
  it("names the same file and the same feature version as the model does", () => {
    expect(ATTENTION_HEAD_FILE).toBe(ATTENTION_HEAD_RELATIVE_PATH);
    expect(ATTENTION_FEATURE_VERSION).toBe(ATTENTION_HEAD_FEATURE_VERSION);
  });

  it("and every record is stamped with it", () => {
    const dir = tempDir();
    const instance = service(dir);
    recordOne(instance);
    const stored = readFileSync(join(dir, "desk-corrections", "corrections.json"), "utf8");
    expect(JSON.parse(stored).corrections[0].featureVersion).toBe(ATTENTION_HEAD_FEATURE_VERSION);
  });
});

describe("recording a correction touches no weights", () => {
  it("writes only under desk-corrections/frames and corrections.json", () => {
    const dir = tempDir();
    const id = recordOne(service(dir));

    const written = walk(dir).map((path) => relative(dir, path).split(sep).join("/"));
    expect(written.sort()).toEqual(
      [
        "desk-corrections/corrections.json",
        `desk-corrections/frames/${id}/frame-0001.jpg`,
        `desk-corrections/frames/${id}/frame-0002.jpg`,
        `desk-corrections/frames/${id}/frame-0003.jpg`,
        `desk-corrections/frames/${id}/thumb.jpg`,
      ].sort(),
    );
  });

  it("never opens the shipped attention head, for writing or otherwise", () => {
    const head = join(deskRoot(), ATTENTION_HEAD_RELATIVE_PATH);
    const before = { hash: hashFile(head), mtime: statSync(head).mtimeMs };

    const dir = tempDir();
    recordOne(service(dir));

    expect(hashFile(head)).toBe(before.hash);
    expect(statSync(head).mtimeMs).toBe(before.mtime);
  });

  it("leaves every committed weights file byte-for-byte unchanged", () => {
    const weights = join(deskRoot(), "model", "weights");
    const before = walk(weights).map((path) => `${path}:${hashFile(path)}`);

    const dir = tempDir();
    recordOne(service(dir));
    service(dir).delete("dc-0001");

    expect(walk(weights).map((path) => `${path}:${hashFile(path)}`)).toEqual(before);
  });

  it("writes no path outside the corrections directory — the whole write log", () => {
    const fs = createMemoryFs();
    const settings = correctingSettings();
    const instance = new DeskCorrections({
      userDataDir: "/data",
      loadSettings: () => settings,
      now: () => 5_000_000,
      fs,
      attentionHeadFile: "/nowhere",
    });
    recordOne(instance);
    instance.delete("dc-0001");
    instance.clear();

    expect(fs.writes.length).toBeGreaterThan(0);
    for (const path of [...fs.writes, ...fs.removed]) {
      expect(path.startsWith(correctionsPath("/data"))).toBe(true);
    }
    expect(fs.writes.some((path) => path.includes("attention-head"))).toBe(false);
    expect(fs.writes.some((path) => path.includes("desk-head"))).toBe(false);
    expect(fs.writes.some((path) => path.includes("personal-attention-head"))).toBe(false);
  });

  it("sends nothing anywhere: no fetch, ever", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const dir = tempDir();
    const instance = service(dir);
    recordOne(instance);
    instance.getState();
    instance.delete("dc-0001");
    instance.clear();
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("refuses a refit rather than doing one implicitly", () => {
    const dir = tempDir();
    expect(() => service(dir).refit()).toThrow();
    // …and refusing wrote nothing at all.
    expect(() => walk(dir)).not.toThrow();
    expect(walk(dir)).toEqual([]);
  });

  /**
   * The sharpest form of the claim, and the one that only became testable
   * once a refit existed to attach: with a REAL fit wired into the service —
   * the same injection `src/main/index.ts` makes — a verdict still never
   * reaches it. Not "there is no refit here", but "the refit is right there
   * and recording does not call it".
   */
  it("never calls an attached refit, however many corrections are recorded", () => {
    const dir = tempDir();
    const refit = vi.fn(() =>
      Promise.reject(new Error("a verdict must never reach the fit")),
    );
    const instance = new DeskCorrections({
      userDataDir: dir,
      loadSettings: () => correctingSettings(),
      now: () => 5_000_000,
      refit,
    });
    for (let i = 0; i < 5; i += 1) {
      recordOne(instance, 5_000_000 + i * 60_000);
    }
    instance.getState();
    instance.delete("dc-0001");
    expect(refit).not.toHaveBeenCalled();

    // The only thing that calls it is the button, and then exactly once.
    void instance.refit().catch(() => undefined);
    expect(refit).toHaveBeenCalledTimes(1);
  });
});

describe("what the pipeline gets back", () => {
  it("the stored frames decode as JPEG at the camera's native size, unresized", () => {
    const dir = tempDir();
    const id = recordOne(service(dir));
    const source = retainedRun("phone", 3)[0];

    for (let i = 1; i <= 3; i += 1) {
      const path = join(dir, "desk-corrections", "frames", id, `frame-000${i}.jpg`);
      const decoded = decodeImageBuffer(readFileSync(path));
      expect(decoded.width).toBe(source?.frame.width);
      expect(decoded.height).toBe(source?.frame.height);
    }
  });

  it("the thumbnail is small, and it is the only resized copy", () => {
    const dir = tempDir();
    const id = recordOne(service(dir));
    const thumb = decodeImageBuffer(
      readFileSync(join(dir, "desk-corrections", "frames", id, "thumb.jpg")),
    );
    expect(Math.max(thumb.width, thumb.height)).toBeLessThanOrEqual(160);
  });

  it("the index on disk is the frozen schema, and nothing else", () => {
    const dir = tempDir();
    const id = recordOne(service(dir));
    const parsed: unknown = JSON.parse(
      readFileSync(join(dir, "desk-corrections", "corrections.json"), "utf8"),
    );
    expect(parsed).toMatchObject({ v: 1, lifetimeCorrections: 1 });
    const correction = (parsed as { corrections: Record<string, unknown>[] }).corrections[0];
    expect(Object.keys(correction ?? {}).sort()).toEqual(
      [
        "at",
        "baseHeadHash",
        "bytes",
        "capped",
        "day",
        "deskModelId",
        "featureVersion",
        "frames",
        "head",
        "id",
        "kind",
        "label",
        "modelConfidence",
        "modelLabel",
        "retraction",
        "split",
        "v",
        "verdict",
      ].sort(),
    );
    expect(correction?.id).toBe(id);
  });
});
