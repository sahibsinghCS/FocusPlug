import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { resolveChrome } from "../../../../../../scripts/lib/chrome.mjs";

const BASE = process.env.CANDLE_STILLS_BASE ?? "http://127.0.0.1:5179";
const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/candle/evidence");
const PREFIX = process.argv[3] ?? "after";
const CHROME = resolveChrome();

const SCENES = [
  { name: "start-004", path: "/?scene=start&progress=0.04&still=1" },
  { name: "mid-050", path: "/?scene=mid&progress=0.5&still=1" },
  { name: "end-092", path: "/?scene=end&progress=0.92&still=1" },
  { name: "stakes-kills", path: "/?scene=stakes&progress=0.5&kills=3&still=1" },
];

await mkdir(OUT, { recursive: true });

for (const scene of SCENES) {
  const file = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
  const profile = resolve("/tmp/candle-chrome-stills", scene.name);
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
      "--virtual-time-budget=2500",
      `${BASE}${scene.path}`,
    ],
    20_000,
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
