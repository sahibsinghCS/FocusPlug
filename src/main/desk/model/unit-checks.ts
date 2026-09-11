import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeskFrame, DeskModel } from "@shared/types";
import { deskRoot } from "../assets";
import type { UnitCheckResult } from "../unit-checks";
import { createDeskModel, deskModelFactory, resolveDeskModelId } from "./factory";
import { StubDeskModel } from "./stub";
import { YourModel } from "./your-model";

function rgbFrame(width = 64, height = 48, fill = 80): DeskFrame {
  return {
    width,
    height,
    data: new Uint8Array(width * height * 3).fill(fill),
  };
}

function frames(): DeskFrame[] {
  return [rgbFrame(), rgbFrame(320, 240, 200), rgbFrame(640, 480, 255)];
}

async function neverPresentOrAway(
  name: string,
  model: DeskModel,
): Promise<UnitCheckResult> {
  await model.init();
  const seen: Array<{ label: string; confidence: number }> = [];
  for (const frame of frames()) {
    const result = await model.infer(frame);
    seen.push({ label: result.label, confidence: result.confidence });
    if (result.label === "at_desk" || result.label === "away") {
      return {
        name,
        pass: false,
        detail: JSON.stringify({ width: frame.width, result }),
      };
    }
  }
  const allUncertainZero = seen.every(
    (item) => item.label === "uncertain" && item.confidence === 0,
  );
  return {
    name,
    pass: allUncertainZero,
    detail: JSON.stringify(seen),
  };
}

export async function runModelSeamUnitChecks(): Promise<UnitCheckResult[]> {
  const results: UnitCheckResult[] = [];

  function check(name: string, pass: boolean, detail: string): void {
    results.push({ name, pass, detail });
  }

  const stub = new StubDeskModel();
  check("stub id is stub", stub.id === "stub", stub.id);
  results.push(await neverPresentOrAway("stub never returns at_desk/away", stub));

  const viaFactory = createDeskModel("stub");
  check("factory stub id is stub", viaFactory.id === "stub", viaFactory.id);
  results.push(await neverPresentOrAway("factory stub never returns at_desk/away", viaFactory));

  const custom = new YourModel();
  check("your-model id is custom", custom.id === "custom", custom.id);
  results.push(
    await neverPresentOrAway("unimplemented your-model stays uncertain (safe default)", custom),
  );

  check("factory custom id is custom", createDeskModel("custom").id === "custom", createDeskModel("custom").id);
  check("factory default is blazeface", createDeskModel().id === "blazeface", createDeskModel().id);
  check(
    "factory blazeface id is blazeface",
    createDeskModel("blazeface").id === "blazeface",
    createDeskModel("blazeface").id,
  );
  check(
    "DeskModelFactory.create matches createDeskModel",
    deskModelFactory.create("stub").id === "stub" &&
      deskModelFactory.create("custom").id === "custom" &&
      deskModelFactory.create("blazeface").id === "blazeface",
    "factory seam",
  );
  check(
    "unknown settings id falls back to blazeface",
    resolveDeskModelId("nope") === "blazeface" && resolveDeskModelId(undefined) === "blazeface",
    resolveDeskModelId("nope"),
  );

  const yourModelSrc = readFileSync(join(deskRoot(), "model", "your-model.ts"), "utf8");
  check(
    "your-model.ts does not import tensorflow or blazeface",
    !/tensorflow|blazeface/i.test(yourModelSrc),
    "Timmy's file must stay a pure DeskModel.infer implementation",
  );

  return results;
}
