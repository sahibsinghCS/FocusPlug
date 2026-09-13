import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { resolveChrome } from "./lib/chrome.mjs";
import { startPreview } from "./lib/preview-server.mjs";

/**
 * Stills of the session surface: the plan you edit, the live console the app
 * shows once a round is armed, and the fuse overlay.
 *
 *   npm run session:stills [outDir] [prefix]
 *
 * Every scene is a seeded mock-IPC state from src/renderer/src/lib/urlScene.ts,
 * so this is the real UI without a live session. `?scene=live&freeze=1&fct=<n>`
 * additionally fast-forwards the deterministic forecast replay to second <n>
 * and holds it there — that is how the pre-armed clock is photographed without
 * waiting 52 s for the shipped net to get there.
 *
 * Route note: `#/` is one route with two states. Session inactive renders the
 * plan (SetupPage); session active renders the console with the decision hero,
 * the forecast instrument and the timeline (SessionPage). Locking the plan with
 * the hold switch goes full-screen to LockPage instead — that shot lives in
 * scripts/readme-stills.mjs, which owns the hold gesture. In the app the lock
 * bar's `Console` steps back to this console mid-session without ending it;
 * these scenes seed the same state directly so a still needs no gesture.
 */

const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/session/evidence");
const PREFIX = process.argv[3] ?? "session";

const SCENES = [
  // The plan, before anything is armed.
  { name: "setup", path: "/#/" },
  // Live console: decision hero, forecast meter, sensor rail, timeline.
  { name: "on-task", path: "/#/?scene=live", settleMs: 900 },
  // Forecast pre-armed at replay second 52 — amber clock plate, "10s → 5s".
  { name: "prearm", path: "/#/?scene=live&freeze=1&fct=52", settleMs: 2500 },
  { name: "away", path: "/#/?scene=away" },
  { name: "recovered", path: "/#/?scene=recovered" },
  // The fuse, frozen at 8 s so the overlay is legible in a still.
  { name: "overlay", path: "/#/?scene=distracted&countdown=8&freeze=1" },
];

await mkdir(OUT, { recursive: true });

// puppeteer-core ships no browser and nothing else starts the preview server,
// so this script owns both. Chrome is resolved first: a missing browser should
// fail before Vite is spawned. Set SESSION_STILLS_BASE to screenshot a server
// you started yourself (`npm run preview:renderer`), and CHROME_PATH if Chrome
// is not on a standard path for this OS.
const CHROME = resolveChrome();
const preview = await startPreview({
  config: "scripts/renderer-preview.vite.ts",
  port: 5173,
  base: process.env.SESSION_STILLS_BASE,
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
    // A fresh page per scene: the app reads the scene once at mount, so a
    // hash-only change on a live page keeps the previous scene.
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.localStorage.clear();
    });
    await page.goto(`${BASE}${scene.path}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("#root", { timeout: 15_000 });
    await new Promise((resolveWait) => setTimeout(resolveWait, scene.settleMs ?? 600));
    const file = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
  await preview.stop();
}
