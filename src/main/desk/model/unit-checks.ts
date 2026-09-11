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

async function alwaysValidOutput(name: string, model: DeskModel): Promise<UnitCheckResult> {
  await model.init();
  const seen: Array<{ label: string; confidence: number }> = [];
  for (const frame of frames()) {
    const result = await model.infer(frame);
    seen.push({ label: result.label, confidence: result.confidence });
    const validLabel =
      result.label === "at_desk" || result.label === "away" || result.label === "uncertain";
    if (
      !validLabel ||
      !Number.isFinite(result.confidence) ||
      result.confidence < 0 ||
      result.confidence > 1
    ) {
      return {
        name,
        pass: false,
        detail: JSON.stringify({ width: frame.width, result }),
      };
    }
  }
  return { name, pass: true, detail: JSON.stringify(seen) };
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
  results.push(await alwaysValidOutput("your-model output is a bounded DeskLabel", custom));

  const missingWeights = new YourModel(
    join(deskRoot(), "model", "weights", "does-not-exist.json"),
  );
  results.push(
    await neverPresentOrAway(
      "your-model without weights stays uncertain (safe default)",
      missingWeights,
    ),
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
    "your-model.ts does not duplicate the detector or call the cloud",
    !/@tensorflow-models\/blazeface|https?:\/\//i.test(yourModelSrc),
    "custom model must reuse the shared adapter (no direct blazeface import) and stay on-device",
  );

  return results;
}
