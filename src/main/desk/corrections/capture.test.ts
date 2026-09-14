import { describe, expect, it } from "vitest";
import { CORRECTION_ANSWER_WINDOW_MS } from "@shared/correction/constants";
import { PendingCaptureHolder, framePrediction, selectCorrectionFrames } from "./capture";
import { awaySnapshot, phoneSnapshot, retainedRun } from "./harness";

describe("selectCorrectionFrames", () => {
  it("takes the first, the middle and the last of the window", () => {
    const frames = retainedRun("phone", 6, { from: 0, stepMs: 5_000 });
    const picked = selectCorrectionFrames(frames);
    expect(picked.map((frame) => frame.at)).toEqual([0, 15_000, 25_000]);
  });

  it("takes everything when fewer than three are held — one frame is valid", () => {
    expect(selectCorrectionFrames(retainedRun("phone", 1))).toHaveLength(1);
    expect(selectCorrectionFrames(retainedRun("phone", 2))).toHaveLength(2);
    expect(selectCorrectionFrames([])).toEqual([]);
  });

  it("keeps the frame closest to the pause when only one is asked for", () => {
    const frames = retainedRun("phone", 5, { from: 0, stepMs: 5_000 });
    expect(selectCorrectionFrames(frames, 1).map((frame) => frame.at)).toEqual([20_000]);
    expect(selectCorrectionFrames([], 1)).toEqual([]);
  });

  it("never returns the same frame twice", () => {
    for (let count = 1; count <= 8; count += 1) {
      const picked = selectCorrectionFrames(retainedRun("phone", count));
      expect(new Set(picked.map((frame) => frame.at)).size).toBe(picked.length);
    }
  });
});

describe("framePrediction", () => {
  it("reads a phone pause off the attention head", () => {
    expect(framePrediction(phoneSnapshot(0, 0.91), "phone")).toEqual({
      predicted: "phone",
      confidence: 0.91,
    });
  });

  it("reads an away pause off the presence head", () => {
    expect(framePrediction(awaySnapshot(0, 0.77), "away")).toEqual({
      predicted: "away",
      confidence: 0.77,
    });
  });

  it("falls back to presence when a phone pause has no attention reading", () => {
    const snapshot = { ts: 0, label: "at_desk" as const, confidence: 0.5, webcamEnabled: true };
    expect(framePrediction(snapshot, "phone")).toEqual({ predicted: "at_desk", confidence: 0.5 });
  });
});

describe("PendingCaptureHolder", () => {
  const open = (holder: PendingCaptureHolder, at: number, count = 3): unknown =>
    holder.open({
      id: `dc-${at}`,
      at,
      kind: "phone",
      deskModelId: "custom",
      capped: false,
      frames: retainedRun("phone", count, { from: at - 25_000 }),
    });

  it("holds nothing, and offers nothing, when the ring was empty", () => {
    const holder = new PendingCaptureHolder();
    const held = holder.open({
      id: "dc-0001",
      at: 100,
      kind: "phone",
      deskModelId: "custom",
      capped: false,
      frames: [],
    });
    expect(held).toBeNull();
    expect(holder.wire(100)).toBeNull();
  });

  it("reports the model's call at the pause instant — the last frame in the run", () => {
    const holder = new PendingCaptureHolder();
    open(holder, 100_000);
    const wire = holder.wire(100_000);
    expect(wire?.modelLabel).toBe("phone");
    // retainedRun raises confidence by 0.01 per frame; the last is 0.92.
    expect(wire?.modelConfidence).toBeCloseTo(0.92, 5);
    expect(wire?.frames).toBe(3);
  });

  it("lapses after the answer window, and frees the bytes with the offer", () => {
    const holder = new PendingCaptureHolder();
    open(holder, 0);
    expect(holder.wire(CORRECTION_ANSWER_WINDOW_MS - 1)).not.toBeNull();
    expect(holder.wire(CORRECTION_ANSWER_WINDOW_MS)).toBeNull();
    // Gone for good: an earlier clock does not resurrect it.
    expect(holder.wire(0)).toBeNull();
  });

  it("a verdict after the window records nothing", () => {
    const holder = new PendingCaptureHolder();
    open(holder, 0);
    expect(holder.take("dc-0", CORRECTION_ANSWER_WINDOW_MS + 1)).toBeNull();
  });

  it("a second pause supersedes the first — one pending capture at a time", () => {
    const holder = new PendingCaptureHolder();
    open(holder, 10_000);
    open(holder, 20_000);
    expect(holder.wire(20_000)?.id).toBe("dc-20000");
    // The superseded pause can no longer be answered.
    expect(holder.take("dc-10000", 20_000)).toBeNull();
    expect(holder.take("dc-20000", 20_000)).not.toBeNull();
  });

  it("a pause with no frames supersedes the previous offer rather than leaving it up", () => {
    const holder = new PendingCaptureHolder();
    open(holder, 10_000);
    holder.open({
      id: "dc-later",
      at: 20_000,
      kind: "away",
      deskModelId: "custom",
      capped: false,
      frames: [],
    });
    expect(holder.wire(20_000)).toBeNull();
  });

  it("a verdict naming a different pause records nothing", () => {
    const holder = new PendingCaptureHolder();
    open(holder, 10_000);
    expect(holder.take("dc-somewhere-else", 10_000)).toBeNull();
    // …and the real one is still there, unconsumed.
    expect(holder.take("dc-10000", 10_000)).not.toBeNull();
  });

  it("taking consumes: a second verdict on the same pause records nothing", () => {
    const holder = new PendingCaptureHolder();
    open(holder, 10_000);
    expect(holder.take("dc-10000", 10_000)).not.toBeNull();
    expect(holder.take("dc-10000", 10_000)).toBeNull();
  });

  it("dismissing frees it — silence is not a label", () => {
    const holder = new PendingCaptureHolder();
    open(holder, 10_000);
    holder.drop("dismissed");
    expect(holder.wire(10_000)).toBeNull();
  });

  it("reports every drop with its reason, so nothing is freed silently", () => {
    const drops: string[] = [];
    const holder = new PendingCaptureHolder({
      onDrop: (_capture, reason) => drops.push(reason),
    });
    open(holder, 0);
    open(holder, 10_000);
    holder.wire(CORRECTION_ANSWER_WINDOW_MS + 10_000);
    open(holder, 100_000);
    holder.take("dc-100000", 100_000);
    open(holder, 200_000);
    holder.drop("dismissed");
    expect(drops).toEqual(["superseded", "expired", "answered", "dismissed"]);
  });

  it("carries the cap through to the wire, so the screen can say photos are skipped", () => {
    const holder = new PendingCaptureHolder();
    holder.open({
      id: "dc-0001",
      at: 0,
      kind: "phone",
      deskModelId: "custom",
      capped: true,
      frames: retainedRun("phone", 3),
    });
    const wire = holder.wire(0);
    expect(wire?.capped).toBe(true);
    // The chips still work: three frames are held, the record just will not
    // keep the photos.
    expect(wire?.frames).toBe(3);
  });
});
