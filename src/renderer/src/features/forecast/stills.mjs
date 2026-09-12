import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

/**
 * Focus Forecast evidence stills — the faces-stills pattern against the
 * forecast:preview server (scripts/forecast-preview.vite.ts, port 5180).
 * Every scene is a deterministic frozen replay frame (?t=<sec>&freeze=1).
 */

const BASE =
  process.env.FORECAST_STILLS_BASE ?? "http://127.0.0.1:5180/src/features/forecast/";
const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/forecast/evidence");
const PREFIX = process.argv[3] ?? "after";

const SCENES = [
  { name: "warmup", path: "?t=8&freeze=1" },
  { name: "calm", path: "?t=26&freeze=1" },
  { name: "nudge-toast", path: "?t=47&freeze=1" },
  { name: "elevated", path: "?t=98&freeze=1" },
  { name: "prearm", path: "?t=106&freeze=1" },
  { name: "receipt-overlay", path: "?t=115&freeze=1" },
  { name: "stood-down", path: "?t=130&freeze=1" },
];

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath:
    process.env.PUPPETEER_EXECUTABLE_PATH ??
    process.env.CHROME_PATH ??
    "/opt/pw-browsers/chromium",
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--window-size=1280,800",
  ],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

try {
  for (const scene of SCENES) {
    const page = await browser.newPage();
    await page.goto(`${BASE}${scene.path}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("#root", { timeout: 15_000 });
    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    const file = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
}
