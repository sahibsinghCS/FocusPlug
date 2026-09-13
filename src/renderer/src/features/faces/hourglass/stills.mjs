import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { resolveChrome } from "../../../../../../scripts/lib/chrome.mjs";

const BASE = process.env.SESSION_STILLS_BASE ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/hourglass/evidence");
const PREFIX = process.argv[3] ?? "after";

const SCENES = [
  { name: "idle", path: "/#/?face=hourglass&freeze=1" },
  { name: "live", path: "/#/?scene=live&face=hourglass&freeze=1" },
  { name: "mid", path: "/#/?scene=live&face=hourglass&progress=0.62&freeze=1" },
  { name: "late", path: "/#/?scene=live&face=hourglass&progress=0.88&freeze=1" },
  { name: "done", path: "/#/?scene=live&face=hourglass&progress=1&freeze=1" },
];

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: resolveChrome(),
  headless: "new",
  args: [
    "--no-sandbox",
    "--disable-gpu",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    "--window-size=1280,800",
  ],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

try {
  for (const scene of SCENES) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.localStorage.clear();
    });
    await page.goto(`${BASE}${scene.path}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("[data-face='hourglass']", { timeout: 15_000 });
    await new Promise((resolveWait) => setTimeout(resolveWait, 900));
    const full = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: full, type: "png" });
    const host = await page.$("[data-face='hourglass']");
    if (host) {
      const crop = resolve(OUT, `${PREFIX}-${scene.name}-host.png`);
      await host.screenshot({ path: crop, type: "png" });
      console.log(crop);
    }
    console.log(full);

    await page.addStyleTag({
      content: `
        .fp-skip, aside, header, .fp-titlebar, .fp-face-host-bar { display: none !important; }
        #fp-main .fp-page > *:not(.fp-face-host) { display: none !important; }
        html, body, #root { margin: 0 !important; height: 100% !important; background: #05060a !important; }
        #root > div, #fp-main, .fp-page {
          margin: 0 !important;
          padding: 0 !important;
          height: 100% !important;
          overflow: hidden !important;
          background: #05060a !important;
        }
        .fp-face-host {
          height: 100vh !important;
          min-height: 100vh !important;
          max-height: none !important;
          border: none !important;
          border-radius: 0 !important;
        }
        .fp-face-stage, [data-face='hourglass'] { height: 100% !important; width: 100% !important; }
      `,
    });
    await new Promise((resolveWait) => setTimeout(resolveWait, 400));
    const hero = resolve(OUT, `${PREFIX}-${scene.name}-hero-1280x800.png`);
    await page.screenshot({ path: hero, type: "png" });
    console.log(hero);
    await page.close();
  }
} finally {
  await browser.close();
}
