import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.FLIGHT_STILLS_BASE ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/flight/evidence");
const PREFIX = process.argv[3] ?? "after";

const DAY = "2026-09-12T16:00:00.000Z";
const NIGHT = "2026-09-12T02:00:00.000Z";

const HOP = "dep=DUB&arr=EDI";
const LONG = "dep=JFK&arr=LHR";
const SIT = 50;

const SCENES = [
  {
    name: "sticker-cruise-16z",
    prefix: "before",
    path: `/face.html?variant=sticker&${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1&idle=0.35`,
  },
  {
    name: "dub-edi-cruise-16z-orbit-a",
    path: `/face.html?${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1&idle=0.35`,
  },
  {
    name: "dub-edi-cruise-16z-orbit-b",
    path: `/face.html?${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1&idle=2.05`,
  },
  {
    name: "dub-edi-cruise-02z",
    path: `/face.html?${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${NIGHT}&freeze=1&idle=0.85`,
  },
  {
    name: "dub-edi-climb-16z",
    path: `/face.html?${HOP}&progress=0.04&estimateMinutes=${SIT}&now=${DAY}&freeze=1&idle=0.2`,
  },
  {
    name: "dub-edi-descent-16z",
    path: `/face.html?${HOP}&progress=0.93&estimateMinutes=${SIT}&now=${DAY}&freeze=1&idle=0.5`,
  },
  {
    name: "dub-edi-complete-16z",
    path: `/face.html?${HOP}&remaining=0&estimateMinutes=${SIT}&now=${DAY}&complete=1&freeze=1&idle=0`,
  },
  {
    name: "dub-edi-picker-16z",
    path: `/face.html?${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1&idle=0.35&picker=dep`,
  },
  {
    name: "jfk-lhr-cruise-16z",
    path: `/face.html?${LONG}&progress=0.46&estimateMinutes=420&now=${DAY}&freeze=1&idle=0.6`,
  },
  {
    name: "host-cruise-16z",
    path: `/#/?scene=live&face=flight&${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1`,
  },
];

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome",
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
    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    const tag = scene.prefix ?? PREFIX;
    const file = resolve(OUT, `${tag}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
}
