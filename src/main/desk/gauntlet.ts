import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { analyzeDeskFrame } from "./analyze";
import { deskRoot } from "./assets";
import { ScriptedFrameSource } from "./camera";
import { AT_DESK_MIN_PROB } from "./classify";
import { decodeImageBuffer } from "./frame";
import type { DeskModel } from "@shared/types";
import { createDeskModel } from "./model/factory";
import { runModelSeamUnitChecks } from "./model/unit-checks";
import type { RunnableDeskModel } from "./model/types";
import { DeskMonitor } from "./monitor";
import { runClassifyUnitChecks } from "./unit-checks";
import type { DeskAnalysis, RgbFrame } from "./types";

interface FixtureResult {
  id: string;
  path: string;
  repeats: DeskAnalysis[];
}

interface Assertion {
  name: string;
  pass: boolean;
  detail: string;
}

interface GauntletReport {
  ranAt: string;
  model: string;
  backend: string;
  unitChecks: ReturnType<typeof runClassifyUnitChecks>;
  fixtures: Array<{
    id: string;
    path: string;
    labels: string[];
    confidences: number[];
    faceCounts: number[];
    maxProbabilities: number[];
    meanLuma: number;
    snapshot: FixtureResult["repeats"][0]["snapshot"] | null;
    debug: FixtureResult["repeats"][0]["debug"] | null;
  }>;
  sequence: Array<{
    id: string;
    label: string;
    confidence: number;
    webcamEnabled: boolean;
    faceCount?: number;
  }>;
  assertions: Assertion[];
  verdict: "PASS" | "FAIL";
}

function loadFixture(name: string): { id: string; path: string; frame: RgbFrame } {
  const path = join(deskRoot(), "fixtures", name);
  const buffer = readFileSync(path);
  return { id: name.replace(/\.[^.]+$/, ""), path, frame: decodeImageBuffer(buffer) };
}

function assert(assertions: Assertion[], name: string, pass: boolean, detail: string): void {
  assertions.push({ name, pass, detail });
}

async function main(): Promise<void> {
  const assertions: Assertion[] = [];
  const unitChecks = [...runClassifyUnitChecks(), ...(await runModelSeamUnitChecks())];
  for (const check of unitChecks) {
    assert(assertions, `unit: ${check.name}`, check.pass, check.detail);
  }

  const model = createDeskModel("blazeface");
  await model.init();

  const names = ["face.jpg", "covered.jpg", "empty.jpg", "noise.jpg"];
  const fixtures: FixtureResult[] = [];
  for (const name of names) {
    const loaded = loadFixture(name);
    const repeats: DeskAnalysis[] = [];
    for (let i = 0; i < 3; i += 1) {
      repeats.push(
        await analyzeDeskFrame({
          frame: loaded.frame,
          model,
          ts: 1_000 + i,
          webcamEnabled: true,
        }),
      );
    }
    fixtures.push({ id: loaded.id, path: loaded.path, repeats });
  }

  const byId = new Map(fixtures.map((fixture) => [fixture.id, fixture]));

  for (const fixture of fixtures) {
    const labels = new Set(fixture.repeats.map((item) => item.snapshot.label));
    const confs = fixture.repeats.map((item) => item.snapshot.confidence);
    const maxP = fixture.repeats.map((item) => item.debug.maxProbability);
    assert(
      assertions,
      `${fixture.id} is deterministic across 3 runs`,
      labels.size === 1 && confs.every((c) => c === confs[0]) && maxP.every((p) => p === maxP[0]),
      JSON.stringify({ labels: [...labels], confs, maxP }),
    );
  }

  const face = byId.get("face");
  const covered = byId.get("covered");
  const empty = byId.get("empty");
  const noise = byId.get("noise");
  const faceSnap = face?.repeats[0];
  const coveredSnap = covered?.repeats[0];
  const emptySnap = empty?.repeats[0];
  const noiseSnap = noise?.repeats[0];

  assert(
    assertions,
    "facing camera → at_desk with real model confidence ≥ 0.6",
    !!faceSnap &&
      faceSnap.snapshot.label === "at_desk" &&
      faceSnap.snapshot.confidence >= AT_DESK_MIN_PROB &&
      faceSnap.debug.faceCount >= 1 &&
      faceSnap.debug.maxProbability >= AT_DESK_MIN_PROB &&
      Math.abs(faceSnap.snapshot.confidence - faceSnap.debug.maxProbability) < 1e-6,
    JSON.stringify(faceSnap ?? null),
  );

  for (const [name, result] of [
    ["covered camera", coveredSnap],
    ["empty / leave-frame", emptySnap],
    ["noise / no person", noiseSnap],
  ] as const) {
    assert(
      assertions,
      `${name} ≠ at_desk (away or uncertain)`,
      !!result && result.snapshot.label !== "at_desk" && result.debug.usableFaceCount === 0,
      JSON.stringify(result ?? null),
    );
  }

  const sequenceFrames: Array<{ id: string; frame: RgbFrame | null; enabled: boolean }> = [
    { id: "face", frame: face?.repeats ? loadFixture("face.jpg").frame : null, enabled: true },
    { id: "face", frame: face ? loadFixture("face.jpg").frame : null, enabled: true },
    { id: "covered", frame: covered ? loadFixture("covered.jpg").frame : null, enabled: true },
    { id: "covered", frame: covered ? loadFixture("covered.jpg").frame : null, enabled: true },
    { id: "empty", frame: empty ? loadFixture("empty.jpg").frame : null, enabled: true },
    { id: "face", frame: face ? loadFixture("face.jpg").frame : null, enabled: true },
    { id: "cam-off", frame: face ? loadFixture("face.jpg").frame : null, enabled: false },
  ];

  const scripted = new ScriptedFrameSource(sequenceFrames.map((item) => item.frame));
  const monitor = new DeskMonitor({
    source: scripted,
    model,
    intervalMs: 10,
    enabled: true,
    now: () => 42,
  });
  const sequence: GauntletReport["sequence"] = [];
  await scripted.start();
  for (const item of sequenceFrames) {
    monitor.setEnabled(item.enabled);
    const snap = await monitor.step();
    sequence.push({
      id: item.id,
      label: snap.label,
      confidence: snap.confidence,
      webcamEnabled: snap.webcamEnabled,
    });
  }
  monitor.stop();

  const afterCover = sequence[2];
  const afterCover2 = sequence[3];
  const afterEmpty = sequence[4];
  const returnFace = sequence[5];
  const camOff = sequence[6];
  const firstFace = sequence[0];

  assert(
    assertions,
    "sequence starts at_desk when facing camera",
    firstFace?.label === "at_desk" && (firstFace.confidence ?? 0) >= AT_DESK_MIN_PROB,
    JSON.stringify(firstFace ?? null),
  );
  assert(
    assertions,
    "covering camera after at_desk is not stuck at_desk",
    afterCover?.label !== "at_desk" && afterCover2?.label !== "at_desk",
    JSON.stringify({ afterCover, afterCover2 }),
  );
  assert(
    assertions,
    "leaving frame after at_desk is not stuck at_desk",
    afterEmpty?.label !== "at_desk",
    JSON.stringify(afterEmpty ?? null),
  );
  assert(
    assertions,
    "return to camera is at_desk again",
    returnFace?.label === "at_desk",
    JSON.stringify(returnFace ?? null),
  );
  assert(
    assertions,
    "setEnabled(false) yields webcamEnabled=false and not at_desk",
    camOff?.webcamEnabled === false && camOff.label !== "at_desk",
    JSON.stringify(camOff ?? null),
  );

  const stubModel = createDeskModel("stub");
  const stubOnFace = await analyzeDeskFrame({
    frame: face ? loadFixture("face.jpg").frame : null,
    model: stubModel,
    ts: 2_000,
    webcamEnabled: true,
  });
  assert(
    assertions,
    "factory stub on face fixture is uncertain (never at_desk/away)",
    stubOnFace.snapshot.label === "uncertain" &&
      stubOnFace.snapshot.confidence === 0 &&
      stubOnFace.snapshot.label !== "at_desk" &&
      stubOnFace.snapshot.label !== "away",
    JSON.stringify(stubOnFace.snapshot),
  );

  const stubSource = new ScriptedFrameSource([
    face ? loadFixture("face.jpg").frame : null,
    covered ? loadFixture("covered.jpg").frame : null,
  ]);
  const stubMonitor = new DeskMonitor({
    source: stubSource,
    model: stubModel,
    intervalMs: 10,
    enabled: true,
    now: () => 99,
  });
  await stubSource.start();
  const stubStep1 = await stubMonitor.step();
  const stubStep2 = await stubMonitor.step();
  stubMonitor.stop();
  assert(
    assertions,
    "stub monitor session stays uncertain without crashing",
    stubStep1.label === "uncertain" &&
      stubStep1.confidence === 0 &&
      stubStep2.label === "uncertain" &&
      stubStep2.confidence === 0,
    JSON.stringify({ stubStep1, stubStep2 }),
  );

  const customModel = createDeskModel("custom");
  const customOnFace = await analyzeDeskFrame({
    frame: face ? loadFixture("face.jpg").frame : null,
    model: customModel,
    ts: 3_000,
    webcamEnabled: true,
  });
  assert(
    assertions,
    "unimplemented custom model is uncertain (safe until Timmy implements infer)",
    customOnFace.snapshot.label === "uncertain" && customOnFace.snapshot.confidence === 0,
    JSON.stringify(customOnFace.snapshot),
  );

  const report: GauntletReport = {
    ranAt: new Date().toISOString(),
    model: model.id,
    backend: modelBackend(model),
    unitChecks,
    fixtures: fixtures.map((fixture) => ({
      id: fixture.id,
      path: fixture.path,
      labels: fixture.repeats.map((item) => item.snapshot.label),
      confidences: fixture.repeats.map((item) => item.snapshot.confidence),
      faceCounts: fixture.repeats.map((item) => item.debug.faceCount),
      maxProbabilities: fixture.repeats.map((item) => item.debug.maxProbability),
      meanLuma: fixture.repeats[0]?.debug.meanLuma ?? 0,
      snapshot: fixture.repeats[0]?.snapshot ?? null,
      debug: fixture.repeats[0]?.debug ?? null,
    })),
    sequence,
    assertions,
    verdict: assertions.every((item) => item.pass) ? "PASS" : "FAIL",
  };

  const evidenceDir = join(deskRoot(), "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  const outPath = join(evidenceDir, "gauntlet-run.json");
  writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

  const lines = [
    `model=${report.model} backend=${report.backend} verdict=${report.verdict}`,
    "",
    "FIXTURES",
    "id            label      conf   faces  maxP   luma",
    ...report.fixtures.map((fixture) => {
      const snap = fixture.snapshot;
      const debug = fixture.debug;
      return `${fixture.id.padEnd(14)}${(snap?.label ?? "?").padEnd(11)}${String(snap?.confidence ?? 0).slice(0, 6).padEnd(7)}${String(debug?.faceCount ?? 0).padEnd(7)}${String(debug?.maxProbability ?? 0).slice(0, 6).padEnd(7)}${(debug?.meanLuma ?? 0).toFixed(1)}`;
    }),
    "",
    "SEQUENCE (face, face, covered, covered, empty, face, cam-off)",
    ...sequence.map(
      (item, index) =>
        `${String(index).padStart(2, "0")} ${item.id.padEnd(10)} ${item.label.padEnd(11)} conf=${item.confidence} cam=${item.webcamEnabled}`,
    ),
    "",
    "ASSERTIONS",
    ...assertions.map((item) => `${item.pass ? "PASS" : "FAIL"}  ${item.name}`),
    "",
    `wrote ${outPath}`,
  ];
  console.log(lines.join("\n"));

  if (report.verdict !== "PASS") {
    const failed = assertions.filter((item) => !item.pass);
    console.error(`Gauntlet FAIL (${failed.length} assertion(s))`);
    process.exitCode = 1;
  }
}

function modelBackend(model: DeskModel): string {
  const extra = model as RunnableDeskModel;
  if (typeof extra.backend === "function") {
    return extra.backend();
  }
  return "n/a";
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
