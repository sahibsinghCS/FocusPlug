import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { resolveChrome } from "./lib/chrome.mjs";
import { startPreview } from "./lib/preview-server.mjs";

const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/flight/evidence");
const PREFIX = process.argv[3] ?? "after";

const DAY = "2026-09-12T16:00:00.000Z";
const HOP = "dep=DUB&arr=EDI";
const LONG = "dep=JFK&arr=LHR";
const SIT = 50;

const SCENES = [
  {
    name: "close-cruise-50m",
    path: `/face.html?${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1`,
  },
  {
    name: "route-cruise-50m",
    path: `/face.html?${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1&map=route`,
  },
  {
    name: "close-climb-50m",
    path: `/face.html?${HOP}&progress=0.04&estimateMinutes=${SIT}&now=${DAY}&freeze=1`,
  },
  {
    name: "close-descent-50m",
    path: `/face.html?${HOP}&progress=0.93&estimateMinutes=${SIT}&now=${DAY}&freeze=1`,
  },
  {
    name: "close-complete-50m",
    path: `/face.html?${HOP}&remaining=0&estimateMinutes=${SIT}&now=${DAY}&complete=1&freeze=1`,
  },
  {
    name: "sticker-cruise",
    path: `/face.html?variant=sticker&${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1`,
  },
  {
    name: "close-picker",
    path: `/face.html?${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1&picker=dep`,
  },
  {
    name: "jfk-lhr-close-50m",
    path: `/face.html?${LONG}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1`,
  },
  {
    name: "host-setup-flight",
    path: `/#/?scene=live&face=flight&${HOP}&progress=0.46&estimateMinutes=${SIT}&now=${DAY}&freeze=1`,
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
    await page.waitForSelector("[data-face='flight']", { timeout: 20_000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
    const tag = scene.prefix ?? PREFIX;
    const file = resolve(OUT, `${tag}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(file);
    await page.close();
  }

  const lock = await browser.newPage();
  await lock.goto(`${BASE}/#/?scene=live&face=flight`, {
    waitUntil: "networkidle0",
    timeout: 45_000,
  });
  await lock.waitForSelector("button", { timeout: 20_000 });
  await lock.evaluate(() => document.fonts.ready);
  const hold = await lock.evaluateHandle(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const found = buttons.find((b) => /hold to lock/i.test(b.textContent ?? "")) ?? null;
    found?.scrollIntoView({ block: "center" });
    return found;
  });
  await new Promise((r) => setTimeout(r, 250));
  const holdEl = hold.asElement();
  if (holdEl) {
    const box = await holdEl.boundingBox();
    if (box) {
      await lock.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await lock.mouse.down();
      await new Promise((r) => setTimeout(r, 800));
      await lock.mouse.up();
    }
  }
  await lock.waitForSelector("[data-face='flight'] canvas, .fp-lock-stage [data-face='flight']", {
    timeout: 12_000,
  }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 700));
  const lockFile = resolve(OUT, `${PREFIX}-lock-close-1280x800.png`);
  await lock.screenshot({ path: lockFile, type: "png" });
  console.log(lockFile);

  const whole = await lock.$("button");
  await lock.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find((b) => /whole map/i.test(b.textContent ?? ""));
    target?.click();
  });
  await new Promise((r) => setTimeout(r, 400));
  const lockRoute = resolve(OUT, `${PREFIX}-lock-route-1280x800.png`);
  await lock.screenshot({ path: lockRoute, type: "png" });
  console.log(lockRoute);
  void whole;
  await lock.close();
} finally {
  await browser.close();
  await preview.stop();
}
