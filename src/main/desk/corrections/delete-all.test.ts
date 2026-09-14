import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ATTENTION_HIDDEN_DIM, ATTENTION_LABELS } from "@shared/correction/refit";
import { deskRoot } from "../assets";
import { decodeImageBuffer } from "../frame";
import {
  applyPersonalAttentionHead,
  clearSharedDeskModel,
  getSharedDeskModel,
} from "../model/factory";
import {
  ATTENTION_HEAD_RELATIVE_PATH,
  attentionHeadHash,
  getPersonalAttentionHeadFile,
  type YourModel,
} from "../model/your-model";
import { correctingSettings } from "./harness";
import { personalAttentionHeadPath } from "./paths";
import { DeskCorrections } from "./service";

/**
 * *Delete all* against the model that is actually running.
 *
 * The rest of the delete coverage (`corrections.test.ts`, `store.test.ts`)
 * asserts on the DISK: the frame tree, the index, the personal head and the
 * refit report are unlinked. That is only half of removing a head. `YourModel`
 * reads its weights once in `init()` and keeps them for the lifetime of the
 * instance, and `factory.ts` keeps that instance in a module-level cache that
 * outlives a session — so a head can be gone from disk and still be taking
 * every reading, while Settings, re-reading the now-missing file, truthfully
 * reports *shipped*. Running one head and claiming the other is the exact
 * failure `personalHeadFits` says the correction loop exists to stop, and the
 * privacy action is the last place it may happen.
 *
 * So this file uses the REAL factory, the REAL `YourModel` and the REAL
 * `DeskCorrections` over a real temp directory, and asserts on a real
 * inference — not on `unlink` having been called.
 *
 * `docs/CORRECTION-LOOP.md § 3`.
 */

const SHIPPED_HEAD = join(deskRoot(), ATTENTION_HEAD_RELATIVE_PATH);

/**
 * A personal head shaped exactly as the gate would install one — same base
 * hash, same labels, a real 3×16 output layer — that ignores its input and
 * always answers `focused`. Constant on purpose: the shipped head calls the
 * `face.jpg` fixture `phone`, so which layer is wearing the model is visible
 * in the READING and not only in a debug string.
 */
function writeConstantFocusedHead(userDataDir: string): string {
  const file = personalAttentionHeadPath(userDataDir);
  mkdirSync(join(userDataDir, "desk-corrections"), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      v: 1,
      baseHeadHash: attentionHeadHash(SHIPPED_HEAD),
      labels: [...ATTENTION_LABELS],
      output: {
        w: ATTENTION_LABELS.map(() => new Array<number>(ATTENTION_HIDDEN_DIM).fill(0)),
        // focused, unfocused, phone — softmax over [6, 0, 0] is ~99% focused.
        b: [6, 0, 0],
      },
      fittedAt: 1_700_000_000_000,
    }),
  );
  return file;
}

function faceFrame() {
  return decodeImageBuffer(readFileSync(join(deskRoot(), "fixtures", "face.jpg")));
}

async function readAttention(): Promise<{ head: unknown; label: string | undefined }> {
  const model = (await getSharedDeskModel("custom")) as YourModel;
  const result = await model.infer(faceFrame());
  return {
    head: (result.debug as Record<string, unknown>).attentionHead,
    label: result.attention?.label,
  };
}

describe("Delete all takes the head out of the running model, not only off the disk", () => {
  let dir = "";

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "focusplug-delete-all-"));
  });

  afterEach(() => {
    // Both globals this file touches are module-level: the head pointer in
    // `your-model.ts` and the instance cache in `factory.ts`.
    applyPersonalAttentionHead(null);
    clearSharedDeskModel();
    rmSync(dir, { recursive: true, force: true });
  });

  it("THE HEADLINE: the very next reading is the shipped head's, and Settings agrees", async () => {
    const headFile = writeConstantFocusedHead(dir);
    const settings = correctingSettings();
    const corrections = new DeskCorrections({
      userDataDir: dir,
      loadSettings: () => settings,
      applyPersonalHead: applyPersonalAttentionHead,
    });

    // The head is on, and it is the head — not the shipped one — deciding.
    const before = await readAttention();
    expect(before.head).toBe("personal");
    expect(before.label).toBe("focused");
    expect(corrections.getState().activeHead).toBe("personal");

    const state = corrections.clear();

    expect(existsSync(headFile)).toBe(false);
    // What Settings renders…
    expect(state.activeHead).toBe("shipped");
    // …and what the enforcement path actually runs. These may never disagree.
    const after = await readAttention();
    expect(after.head).toBe("shipped");
    expect(after.label).toBe("phone");

    // Dropped, not disabled: the pointer still names where a future refit
    // would write, so *Delete all* has not quietly switched the feature off.
    expect(getPersonalAttentionHeadFile()).toBe(headFile);
  });

  it("a head deleted while nothing is running is still gone from the next reading", async () => {
    writeConstantFocusedHead(dir);
    const settings = correctingSettings();
    const corrections = new DeskCorrections({
      userDataDir: dir,
      loadSettings: () => settings,
      applyPersonalHead: applyPersonalAttentionHead,
    });

    // No model has been built yet — `clear()` must not depend on one existing.
    expect(() => corrections.clear()).not.toThrow();
    expect((await readAttention()).head).toBe("shipped");
  });

  it("an ordinary settings sync still costs nothing — the fast path stays fast", async () => {
    writeConstantFocusedHead(dir);
    const settings = correctingSettings();
    const corrections = new DeskCorrections({
      userDataDir: dir,
      loadSettings: () => settings,
      applyPersonalHead: applyPersonalAttentionHead,
    });

    const first = await getSharedDeskModel("custom");
    // `syncCorrectionCapture()` runs this on every settings save and on every
    // desk enable/disable. Nothing moved, so nothing may be re-read: the
    // enforcement path must not pay a weights load per save.
    corrections.syncPersonalHead();
    corrections.syncPersonalHead();
    expect(await getSharedDeskModel("custom")).toBe(first);

    // …and the head that is switched OFF by preference still drops the cache,
    // because that one really does move the pointer.
    const off = new DeskCorrections({
      userDataDir: dir,
      loadSettings: () => correctingSettings({ personalAttentionHeadEnabled: false }),
      applyPersonalHead: applyPersonalAttentionHead,
    });
    off.syncPersonalHead();
    expect(await getSharedDeskModel("custom")).not.toBe(first);
  });
});
