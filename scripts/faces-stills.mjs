import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.SESSION_STILLS_BASE ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/faces/evidence");
const PREFIX = process.argv[3] ?? "after";

const SCENES = [
  { name: "idle-readout", path: "/#/?face=readout" },
  { name: "live-readout", path: "/#/?scene=live&face=readout" },
  { name: "live-hourglass", path: "/#/?scene=live&face=hourglass" },
  { name: "mid-hourglass", path: "/#/?scene=live&face=hourglass&progress=0.62" },
  { name: "idle-hourglass", path: "/#/?face=hourglass" },
  { name: "live-flight", path: "/#/?scene=live&face=flight" },
  { name: "settings", path: "/#/settings" },
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
    await page.evaluateOnNewDocument(() => {
      window.localStorage.clear();
    });
    await page.goto(`${BASE}${scene.path}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("#root", { timeout: 15_000 });
    await new Promise((resolveWait) => setTimeout(resolveWait, 700));
    const file = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
}
