import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { resolveChrome } from "../../../../../scripts/lib/chrome.mjs";
import { startPreview } from "../../../../../scripts/lib/preview-server.mjs";

/**
 * Focus Forecast evidence stills — the faces-stills pattern against the
 * forecast:preview server (scripts/forecast-preview.vite.ts, port 5180).
 * Every scene is a deterministic frozen replay frame (?t=<sec>&freeze=1).
 */

const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/forecast/evidence");
const PREFIX = process.argv[3] ?? "after";

/**
 * Chronological, and every second is read off the events buildForecastReplay
 * actually emits with the SHIPPED weights — nudge 41, pre-arm 47, clear 61,
 * nudge 91, pre-arm 97, hit 113. A new head moves them, so re-check with
 * `npm run forecast:preview` after a trainer round rather than trusting these.
 */
const SCENES = [
  { name: "warmup", path: "?t=8&freeze=1" }, // ready:false, warming up
  { name: "calm", path: "?t=26&freeze=1" }, // band calm, risk ~0
  { name: "nudge-toast", path: "?t=44&freeze=1" }, // nudged at 41, toast still up
  { name: "prearm", path: "?t=52&freeze=1" }, // pre-armed at 47, fuse 10 → 5
  { name: "stood-down", path: "?t=63&freeze=1" }, // cleared at 61, unconfirmed
  { name: "elevated", path: "?t=93&freeze=1" }, // nudged again at 91, not yet pre-armed
  { name: "receipt-overlay", path: "?t=115&freeze=1" }, // fuse burning, HIT receipt
];

await mkdir(OUT, { recursive: true });

// This script owns its server: puppeteer-core ships no browser and nothing
// else starts forecast:preview. Chrome resolves first so a missing browser
// fails before Vite is spawned. FORECAST_STILLS_BASE screenshots a server you
// started yourself; CHROME_PATH names a browser off the standard paths.
const CHROME = resolveChrome();
const ENV_BASE = process.env.FORECAST_STILLS_BASE;
const preview = await startPreview({
  config: "scripts/forecast-preview.vite.ts",
  port: 5180,
  base: ENV_BASE,
});
const BASE = ENV_BASE ?? `${preview.origin}/src/features/forecast/`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
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
  await preview.stop();
}
