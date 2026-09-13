import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { resolveChrome } from "../../../../../../scripts/lib/chrome.mjs";

const BASE = process.env.CANDLE_HOST_STILLS_BASE ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/candle/evidence");
const PREFIX = process.argv[3] ?? "host";
const CHROME = resolveChrome();

const SCENES = [
  {
    name: "start",
    path: "/#/?scene=live&face=candle&progress=0.04&freeze=1",
  },
  {
    name: "mid",
    path: "/#/?scene=live&face=candle&progress=0.5&freeze=1",
  },
  {
    name: "end",
    path: "/#/?scene=live&face=candle&progress=0.92&freeze=1",
  },
  {
    name: "bar",
    path: "/#/?face=bar&solo=1&faceScene=artifact&freeze=1",
  },
];

await mkdir(OUT, { recursive: true });

for (const scene of SCENES) {
  const file = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
  const profile = resolve("/tmp/candle-chrome-host-stills", scene.name);
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
