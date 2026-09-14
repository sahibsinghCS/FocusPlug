import type { AppSettings } from "@shared/ipc";
import type { PauseKind } from "@shared/nudge";
import type { DeskSnapshot } from "@shared/types";
import { DEFAULT_SETTINGS } from "../../../shared/defaults.ts";
import type { RetainedFrame } from "../frameRing";
import type { RgbFrame } from "../types";
import { correctionFilePath, correctionsIndexPath } from "./paths";
import type { CorrectionsFs } from "./store";

/**
 * Doubles for the correction loop, kept OUT of `src/main/session/harness.ts`
 * on purpose: the session harness is the enforcement path's, and a feature
 * that is allowed to fail must not add fixtures to the one that is not.
 */

/** Settings that make a correction possible: trained head, a pause switch on. */
export function correctingSettings(patch: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    deskModelId: "custom",
    pauseOnAwayEnabled: true,
    pauseOnPhoneEnabled: true,
    deskCorrectionsEnabled: true,
    ...patch,
  };
}

export function testFrame(seed: number, width = 8, height = 6): RgbFrame {
  const data = new Uint8Array(width * height * 3);
  for (let i = 0; i < data.length; i += 1) {
    data[i] = (seed * 37 + i * 11) % 251;
  }
  return { width, height, data };
}

export function phoneSnapshot(ts: number, confidence = 0.94): DeskSnapshot {
  return {
    ts,
    label: "at_desk",
    confidence: 0.96,
    webcamEnabled: true,
    attention: { label: "phone", confidence },
  };
}

export function awaySnapshot(ts: number, confidence = 0.88): DeskSnapshot {
  return { ts, label: "away", confidence, webcamEnabled: true };
}

export function retainedRun(
  kind: PauseKind,
  count: number,
  options: { from?: number; stepMs?: number } = {},
): RetainedFrame[] {
  const from = options.from ?? 1_000_000;
  const stepMs = options.stepMs ?? 5_000;
  const frames: RetainedFrame[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = from + i * stepMs;
    frames.push({
      at,
      frame: testFrame(i + 1),
      snapshot: kind === "away" ? awaySnapshot(at, 0.8 + i / 100) : phoneSnapshot(at, 0.9 + i / 100),
    });
  }
  return frames;
}

export interface MemoryFs extends CorrectionsFs {
  /** Every path written, in order. The uncoupling test asserts on this. */
  readonly writes: string[];
  readonly removed: string[];
  readonly files: Map<string, Uint8Array>;
  json: Map<string, unknown>;
  /** Set to make the next write throw — the failure path. */
  failWrites: string | null;
}

/**
 * An in-memory filesystem with a recorded write log.
 *
 * The uncoupling test asserts on the LOG rather than on the code: "recording a
 * correction never opens the attention head for writing" is only worth
 * something if a future refactor that broke it would fail a test.
 */
export function createMemoryFs(): MemoryFs {
  const files = new Map<string, Uint8Array>();
  const json = new Map<string, unknown>();
  const writes: string[] = [];
  const removed: string[] = [];
  const fs: MemoryFs = {
    writes,
    removed,
    files,
    json,
    failWrites: null,
    existsSync: (path) => files.has(path) || json.has(path),
    mkdirSync: () => undefined,
    writeFileSync: (path, data) => {
      if (fs.failWrites !== null) {
        throw new Error(fs.failWrites);
      }
      writes.push(path);
      files.set(path, Uint8Array.from(data));
    },
    readFileSync: (path) => {
      const value = files.get(path);
      if (value === undefined) {
        throw new Error(`ENOENT: ${path}`);
      }
      return value;
    },
    rmSync: (path) => {
      removed.push(path);
      for (const key of [...files.keys()]) {
        if (key === path || key.startsWith(`${path}/`) || key.startsWith(`${path}\\`)) {
          files.delete(key);
        }
      }
      for (const key of [...json.keys()]) {
        if (key === path || key.startsWith(`${path}/`) || key.startsWith(`${path}\\`)) {
          json.delete(key);
        }
      }
    },
    readJson: (path) => json.get(path) ?? null,
    writeJson: (path, value) => {
      if (fs.failWrites !== null) {
        throw new Error(fs.failWrites);
      }
      writes.push(path);
      json.set(path, JSON.parse(JSON.stringify(value)) as unknown);
    },
  };
  return fs;
}

/** Seed the index a store will revive, without going through `record`. */
export function seedIndex(fs: MemoryFs, dir: string, value: unknown): void {
  fs.json.set(correctionsIndexPath(dir), value);
}

/** Pretend a frame JPEG is on disk, so revive keeps it. */
export function seedFrameFile(fs: MemoryFs, dir: string, relative: string): void {
  fs.files.set(correctionFilePath(dir, relative), new Uint8Array([0xff, 0xd8, 0xff]));
}
