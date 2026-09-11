/**
 * Smart-plug gauntlet (no LAN / no Electron required).
 *
 *   npx tsx --tsconfig tsconfig.node.json src/main/plugs/gauntlet.ts
 *
 * Bar: mock off→on round-trip; protect rejects study-PC; unknown id errors cleanly.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PlugController } from "./controller.ts";
import { MemoryPlugStore } from "./memoryStore.ts";
import { MockPlugHost } from "./mock.ts";
import { PlugProtectError } from "./protect.ts";
import type { PlugDevice } from "./types.ts";

const evidencePath = join(dirname(fileURLToPath(import.meta.url)), "evidence", "gauntlet-run.json");

interface Step {
  name: string;
  ok: boolean;
  detail: string;
}

async function main(): Promise<void> {
  const steps: Step[] = [];
  const host = new MockPlugHost().seed("lamp", true);
  const lamp: PlugDevice = {
    id: "lamp",
    name: "Fun lamp",
    protocol: "mock",
    address: "mock",
    isStudyPc: false,
    enabled: true,
  };
  const study: PlugDevice = {
    id: "study",
    name: "study-pc",
    protocol: "mock",
    address: "mock",
    isStudyPc: false,
    enabled: true,
  };
  const controller = new PlugController({
    store: new MemoryPlugStore([lamp, study]),
    hosts: { mock: host },
  });

  const off = await controller.off(["lamp"]);
  const offOk =
    off[0]?.online === true && off[0].powerOn === false && host.getPower("lamp") === false;
  steps.push({
    name: "mock-off",
    ok: offOk,
    detail: JSON.stringify(off),
  });

  const on = await controller.on(["lamp"]);
  const onOk = on[0]?.online === true && on[0].powerOn === true && host.getPower("lamp") === true;
  steps.push({
    name: "mock-on",
    ok: onOk,
    detail: JSON.stringify(on),
  });

  let protectOk = false;
  let protectDetail = "";
  try {
    await controller.off(["study"]);
    protectDetail = "study-pc off() did not throw";
  } catch (error) {
    protectOk = error instanceof PlugProtectError && error.message.toLowerCase().includes("study");
    protectDetail = error instanceof Error ? error.message : String(error);
  }
  steps.push({ name: "protect-study-pc", ok: protectOk, detail: protectDetail });

  let unknownOk = false;
  let unknownDetail = "";
  try {
    await controller.off(["missing"]);
    unknownDetail = "unknown id did not throw";
  } catch (error) {
    unknownOk = error instanceof Error && /unknown plug id: missing/i.test(error.message);
    unknownDetail = error instanceof Error ? error.message : String(error);
  }
  steps.push({ name: "unknown-id", ok: unknownOk, detail: unknownDetail });

  const empty = new PlugController({
    store: new MemoryPlugStore(),
    hosts: { mock: new MockPlugHost() },
  });
  steps.push({
    name: "zero-plugs-boot",
    ok: (await empty.list()).length === 0,
    detail: `count=${(await empty.list()).length}`,
  });

  const passed = steps.every((step) => step.ok);
  const report = {
    bar: "Mock off→on; protect rejects study-PC; unknown id errors cleanly; zero-plug boot",
    passed,
    ts: Date.now(),
    steps,
  };
  mkdirSync(dirname(evidencePath), { recursive: true });
  writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${passed ? "WIN" : "LOSE"} ${JSON.stringify(report, null, 2)}\n`);
  if (!passed) {
    process.exitCode = 1;
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
