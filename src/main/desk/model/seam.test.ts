import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DeskModel } from "@shared/types";
import { analyzeDeskFrame } from "../analyze";
import { deskRoot } from "../assets";
import { ScriptedFrameSource } from "../camera";
import { decodeImageBuffer } from "../frame";
import { DeskMonitor } from "../monitor";
import type { RgbFrame } from "../types";
import { createDeskModel, deskModelFactory, resolveDeskModelId } from "./factory";
import { StubDeskModel } from "./stub";
import {
  ATTENTION_HEAD_LABELS,
  attentionHeadPredict,
  parseDeskHeadWeights,
  YourModel,
} from "./your-model";

/** A head that ignores its input and always answers `phone`. */
function constantPhoneHead(featureDim: number): string {
  return JSON.stringify({
    version: 2,
    featureDim,
    labels: [...ATTENTION_HEAD_LABELS],
    mean: new Array(featureDim).fill(0),
    std: new Array(featureDim).fill(1),
    layers: [{ w: [0, 1, 2].map(() => new Array(featureDim).fill(0)), b: [0, 0, 6] }],
  });
}

function loadFaceFrame(): RgbFrame {
  const buffer = readFileSync(join(deskRoot(), "fixtures", "face.jpg"));
  return decodeImageBuffer(buffer);
}

describe("DeskModel seam", () => {
  it("stub never returns at_desk or away", async () => {
    const stub = new StubDeskModel();
    await stub.init();
    const result = await stub.infer(loadFaceFrame());
    expect(result.label).toBe("uncertain");
    expect(result.confidence).toBe(0);
  });

  it("factory maps ids and defaults to blazeface", () => {
    expect(createDeskModel("stub")).toBeInstanceOf(StubDeskModel);
    expect(createDeskModel("custom")).toBeInstanceOf(YourModel);
    expect(createDeskModel().id).toBe("blazeface");
    expect(createDeskModel("blazeface").id).toBe("blazeface");
    expect(deskModelFactory.create("custom").id).toBe("custom");
    expect(resolveDeskModelId("nope")).toBe("blazeface");
  });

  it("analyze + monitor with stub stay uncertain without throwing", async () => {
    const model = createDeskModel("stub");
    await model.init();
    const frame = loadFaceFrame();
    const analysis = await analyzeDeskFrame({
      frame,
      model,
      ts: 10,
      webcamEnabled: true,
    });
    expect(analysis.snapshot.label).toBe("uncertain");
    expect(analysis.snapshot.confidence).toBe(0);

    const source = new ScriptedFrameSource([frame, frame]);
    const monitor = new DeskMonitor({
      source,
      model,
      intervalMs: 5,
      enabled: true,
      now: () => 7,
    });
    await source.start();
    const first = await monitor.step();
    const second = await monitor.step();
    monitor.stop();
    expect(first.label).toBe("uncertain");
    expect(second.label).toBe("uncertain");
  });

  it("custom YourModel keeps the id and returns a valid, bounded output", async () => {
    const model = createDeskModel("custom");
    await model.init();
    expect(model.id).toBe("custom");
    const result = await model.infer(loadFaceFrame());
    expect(["at_desk", "away", "uncertain"]).toContain(result.label);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("custom YourModel without a weights file degrades to safe uncertain", async () => {
    const model = new YourModel(join(deskRoot(), "model", "weights", "does-not-exist.json"));
    await model.init();
    const result = await model.infer(loadFaceFrame());
    expect(result.label).toBe("uncertain");
    expect(result.confidence).toBe(0);
  });

  it("head weights only parse against their own label set", () => {
    const json = JSON.stringify({
      version: 2,
      featureDim: 2,
      labels: [...ATTENTION_HEAD_LABELS],
      mean: [0, 0],
      std: [1, 1],
      layers: [{ w: [[1, 0], [0, 1], [-1, -1]], b: [0, 0, 0] }],
    });
    expect(parseDeskHeadWeights(json)).toBeNull();
    const weights = parseDeskHeadWeights(json, ATTENTION_HEAD_LABELS);
    expect(weights).not.toBeNull();
    if (!weights) return;
    expect(attentionHeadPredict(weights, [5, 0]).label).toBe("focused");
    expect(attentionHeadPredict(weights, [0, 5]).label).toBe("unfocused");
    expect(attentionHeadPredict(weights, [-5, -5]).label).toBe("phone");
  });

  it("custom YourModel reports attention alongside at_desk, and none without a head", async () => {
    const dir = mkdtempSync(join(tmpdir(), "focusplug-attention-"));
    try {
      const withHead = new YourModel(undefined, join(dir, "attention-head.json"));
      writeFileSync(join(dir, "attention-head.json"), constantPhoneHead(2025));
      await withHead.init();
      const frame = loadFaceFrame();
      const result = await withHead.infer(frame);
      expect(result.label).toBe("at_desk");
      expect(result.attention?.label).toBe("phone");
      expect(result.attention?.confidence).toBeGreaterThan(0.9);

      const withoutHead = new YourModel(undefined, join(dir, "missing.json"));
      await withoutHead.init();
      expect((await withoutHead.infer(frame)).attention).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // Two full feature extractions on CPU; slow under a parallel test run.
  }, 60_000);

  it("analyze drops attention unless the label is at_desk", async () => {
    const fake = (label: "at_desk" | "away"): DeskModel => ({
      id: "fake",
      init: async () => undefined,
      infer: async () => ({ label, confidence: 0.9, attention: { label: "phone", confidence: 0.8 } }),
    });
    const frame = loadFaceFrame();
    const atDesk = await analyzeDeskFrame({ frame, model: fake("at_desk"), ts: 1, webcamEnabled: true });
    expect(atDesk.snapshot.attention).toEqual({ label: "phone", confidence: 0.8 });
    const away = await analyzeDeskFrame({ frame, model: fake("away"), ts: 1, webcamEnabled: true });
    expect(away.snapshot.attention).toBeUndefined();
  });
});
