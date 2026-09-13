import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { resolveChrome } from "./lib/chrome.mjs";
import { startPreview } from "./lib/preview-server.mjs";

const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/flight/evidence");
const PREFIX = process.argv[3] ?? "after";

const DAY = "2026-09-12T16:00:00.000Z";
const NIGHT = "2026-09-12T02:00:00.000Z";

const HOURS = 420;

const SCENES = [
  {
    name: "sticker-cruise-16z",
    prefix: "before",
    path: `/face.html?variant=sticker&progress=0.46&estimateMinutes=${HOURS}&now=${DAY}&freeze=1&idle=0.35`,
  },
  {
    name: "cruise-16z",
    path: `/face.html?progress=0.46&estimateMinutes=${HOURS}&now=${DAY}&freeze=1&idle=0.35`,
  },
  {
    name: "cruise-02z",
    path: `/face.html?progress=0.46&estimateMinutes=${HOURS}&now=${NIGHT}&freeze=1&idle=0.55`,
  },
  {
    name: "climb-16z",
    path: `/face.html?progress=0.04&estimateMinutes=${HOURS}&now=${DAY}&freeze=1&idle=0.15`,
  },
  {
    name: "descent-16z",
    path: `/face.html?progress=0.93&estimateMinutes=${HOURS}&now=${DAY}&freeze=1&idle=0.2`,
  },
  {
    name: "complete-16z",
    path: `/face.html?remaining=0&estimateMinutes=${HOURS}&now=${DAY}&complete=1&freeze=1&idle=0`,
  },
  {
    name: "host-cruise-16z",
    path: `/#/?scene=live&face=flight&progress=0.46&estimateMinutes=${HOURS}&now=${DAY}&freeze=1`,
  },
];

await mkdir(OUT, { recursive: true });

// puppeteer-core ships no browser and nothing else starts the preview server,
// so this script owns both. Chrome is resolved first: a missing browser should
// fail before Vite is spawned. Set FLIGHT_STILLS_BASE to screenshot a server
// you started yourself (`npm run renderer:preview`), and CHROME_PATH if
// Chrome is not on a standard path for this OS.
const CHROME = resolveChrome();
const preview = await startPreview({
  config: "scripts/renderer-preview.vite.ts",
  port: 5173,
  base: process.env.FLIGHT_STILLS_BASE,
});
const BASE = preview.origin;

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
    await page.goto(`${BASE}${scene.path}`, { waitUntil: "networkidle0", timeout: 45_000 });
    await page.waitForSelector("canvas[data-phase], [data-face='flight'] canvas", {
      timeout: 20_000,
    });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((resolveWait) => setTimeout(resolveWait, 800));
    const tag = scene.prefix ?? PREFIX;
    const file = resolve(OUT, `${tag}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
  await preview.stop();
}
