import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeDeskFrame } from "../analyze";
import { deskRoot } from "../assets";
import { ScriptedFrameSource } from "../camera";
import { decodeImageBuffer } from "../frame";
import { DeskMonitor } from "../monitor";
import type { RgbFrame } from "../types";
import { createDeskModel, deskModelFactory, resolveDeskModelId } from "./factory";
import { StubDeskModel } from "./stub";
import { YourModel } from "./your-model";

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

  it("unimplemented YourModel is the custom id and stays uncertain", async () => {
    const model = createDeskModel("custom");
    await model.init();
    expect(model.id).toBe("custom");
    const result = await model.infer(loadFaceFrame());
    expect(result).toEqual({ label: "uncertain", confidence: 0 });
  });
});
