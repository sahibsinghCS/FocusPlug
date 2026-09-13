import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { resolveChrome } from "../../../../../../scripts/lib/chrome.mjs";

const BASE = process.env.GARDEN_STILLS_BASE ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/garden/evidence");
const PREFIX = process.argv[3] ?? "after";
const CHROME = resolveChrome();
const SESSION = "gauntlet-garden-01";

const SCENES = [
  {
    name: "garden-night",
    path: `/#/?scene=live&face=garden&progress=0&session=${SESSION}&freeze=1`,
  },
  {
    name: "garden-dawn",
    path: `/#/?scene=live&face=garden&progress=0.48&session=${SESSION}&freeze=1`,
  },
  {
    name: "garden-day",
    path: `/#/?scene=live&face=garden&progress=1&session=${SESSION}&freeze=1`,
  },
  {
    name: "bar-mid",
    path: "/#/?face=bar&solo=1&faceScene=artifact&progress=0.48&freeze=1",
  },
];

await mkdir(OUT, { recursive: true });

for (const scene of SCENES) {
  const file = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
  const profile = resolve("/tmp/garden-chrome-stills", scene.name);
  await mkdir(profile, { recursive: true });
  await run(
    CHROME,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--hide-scrollbars",
      "--window-size=1280,800",
      `--user-data-dir=${profile}`,
      `--screenshot=${file}`,
      "--virtual-time-budget=3500",
      `${BASE}${scene.path}`,
    ],
    25_000,
  );
  console.log(file);
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`${cmd} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stderr.on("data", (chunk) => {
      err += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise(undefined);
        return;
      }
      reject(new Error(`${cmd} exited ${code}: ${err}`));
    });
  });
}
