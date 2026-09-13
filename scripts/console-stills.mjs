import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { resolveChrome } from "./lib/chrome.mjs";
import { startPreview } from "./lib/preview-server.mjs";

const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/chrome/evidence");
const PREFIX = process.argv[3] ?? "after";

const SCENES = [
  { name: "session-idle", path: "/#/" },
  { name: "session-live", path: "/#/?scene=live" },
  { name: "session-overlay", path: "/#/?scene=distracted&countdown=8&freeze=1" },
  { name: "allowlist", path: "/#/allowlist" },
  { name: "plugs", path: "/#/plugs?scene=live" },
  { name: "settings", path: "/#/settings" },
  { name: "log-empty", path: "/#/log" },
  { name: "log-golden", path: "/#/log?scene=golden" },
];

await mkdir(OUT, { recursive: true });

// puppeteer-core ships no browser and nothing else starts the preview server,
// so this script owns both. Chrome is resolved first: a missing browser should
// fail before Vite is spawned. Set CONSOLE_STILLS_BASE to screenshot a server
// you started yourself (`npm run renderer:preview`), and CHROME_PATH if
// Chrome is not on a standard path for this OS.
const CHROME = resolveChrome();
const preview = await startPreview({
  config: "scripts/renderer-preview.vite.ts",
  port: 5173,
  base: process.env.CONSOLE_STILLS_BASE,
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
  await preview.stop();
}
