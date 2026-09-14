import { describe, expect, it } from "vitest";
import {
  CORRECTION_RING_FRAMES,
  CORRECTION_RING_SPACING_MS,
} from "@shared/correction/constants";
import type { DeskSnapshot } from "@shared/types";
import { FrameRing, type RetainedFrame } from "./frameRing";
import type { RgbFrame } from "./types";

function frame(value: number): RgbFrame {
  return { width: 2, height: 1, data: new Uint8Array([value, value, value, value, value, value]) };
}

function snapshot(ts: number): DeskSnapshot {
  return { ts, label: "at_desk", confidence: 0.9, webcamEnabled: true };
}

function retained(at: number): RetainedFrame {
  return { at, frame: frame(at % 251), snapshot: snapshot(at) };
}

describe("FrameRing", () => {
  it("refuses frames closer together than the spacing — 250 ms apart is one photograph", () => {
    const ring = new FrameRing();
    expect(ring.push(retained(0))).toBe(true);
    expect(ring.push(retained(250))).toBe(false);
    expect(ring.push(retained(500))).toBe(false);
    expect(ring.push(retained(CORRECTION_RING_SPACING_MS - 1))).toBe(false);
    expect(ring.push(retained(CORRECTION_RING_SPACING_MS))).toBe(true);
    expect(ring.size).toBe(2);
  });

  it("is bounded: the oldest slot goes, never the newest", () => {
    const ring = new FrameRing();
    for (let i = 0; i <= CORRECTION_RING_FRAMES + 3; i += 1) {
      expect(ring.push(retained(i * CORRECTION_RING_SPACING_MS))).toBe(true);
    }
    expect(ring.size).toBe(CORRECTION_RING_FRAMES);
    const all = ring.all();
    expect(all[all.length - 1]?.at).toBe((CORRECTION_RING_FRAMES + 3) * CORRECTION_RING_SPACING_MS);
    expect(all[0]?.at).toBe(4 * CORRECTION_RING_SPACING_MS);
  });

  it("six slots at five seconds covers the longest run that can pause (30 s)", () => {
    expect((CORRECTION_RING_FRAMES - 1) * CORRECTION_RING_SPACING_MS).toBeGreaterThanOrEqual(25_000);
    const ring = new FrameRing();
    for (let i = 0; i < CORRECTION_RING_FRAMES; i += 1) {
      ring.push(retained(i * CORRECTION_RING_SPACING_MS));
    }
    const now = (CORRECTION_RING_FRAMES - 1) * CORRECTION_RING_SPACING_MS;
    expect(ring.peek(now - 30_000)).toHaveLength(CORRECTION_RING_FRAMES);
  });

  it("peeks only the window asked for, oldest first", () => {
    const ring = new FrameRing();
    for (let i = 0; i < 4; i += 1) {
      ring.push(retained(i * 10_000));
    }
    const inside = ring.peek(20_000);
    expect(inside.map((entry) => entry.at)).toEqual([20_000, 30_000]);
  });

  it("hands back a copy, so a selection survives clear() — the pause ordering", () => {
    const ring = new FrameRing();
    ring.push(retained(0));
    ring.push(retained(CORRECTION_RING_SPACING_MS));
    const held = ring.peek(0);
    ring.clear();
    expect(ring.size).toBe(0);
    expect(held).toHaveLength(2);
    expect(held[0]?.frame.data).toBeInstanceOf(Uint8Array);
  });

  it("refuses a non-finite or backwards timestamp rather than reordering itself", () => {
    const ring = new FrameRing();
    ring.push(retained(100_000));
    expect(ring.push({ ...retained(0), at: Number.NaN })).toBe(false);
    expect(ring.push(retained(0))).toBe(false);
    expect(ring.size).toBe(1);
  });
});
