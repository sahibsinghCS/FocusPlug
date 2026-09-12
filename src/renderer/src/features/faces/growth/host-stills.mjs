import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const BASE = process.env.GROWTH_HOST_STILLS_BASE ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/growth/evidence");
const PREFIX = process.argv[3] ?? "host";
const CHROME = process.env.CHROME_PATH ?? "/usr/bin/google-chrome";
const SESSION = "gauntlet-growth-01";

const SCENES = [
  {
    name: "healthy-mid",
    path: `/#/?scene=live&face=growth&progress=0.74&session=${SESSION}`,
  },
  {
    name: "wilted-kills",
    path: `/#/?scene=live&face=growth&progress=0.74&session=${SESSION}&kills=3`,
  },
];

await mkdir(OUT, { recursive: true });

for (const scene of SCENES) {
  const file = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
  const profile = resolve("/tmp/growth-chrome-host-stills", scene.name);
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
