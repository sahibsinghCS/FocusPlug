/**
 * Regenerates the five stills the README and demo script embed.
 *
 *   npm run preview:renderer      # terminal 1 (127.0.0.1:5173)
 *   npm run stills:readme         # terminal 2
 *
 * Scenes are the seeded mock-IPC states from src/renderer/src/lib/urlScene.ts,
 * so this renders the real console chrome without a live session. Replace these
 * with live captures from the take when you film (docs/DEMO-SCRIPT.md).
 */
import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";

const BASE = process.env.README_STILLS_BASE ?? "http://127.0.0.1:5173";
const OUT = resolve(process.argv[2] ?? "docs/screenshots");
const VIEWPORT = { width: 1280, height: 800, deviceScaleFactor: 1 };

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/local/bin/google-chrome",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

/** `clipTo` takes the region around the first element whose text matches. */
const SHOTS = [
  { file: "01-on-task.png", path: "/#/?scene=live" },
  { file: "02-kill-overlay.png", path: "/#/?scene=distracted&countdown=8&freeze=1" },
  { file: "03-desk-away.png", path: "/#/?scene=away" },
  { file: "04-session-log.png", path: "/#/log?scene=golden" },
  { file: "05-demo-kill.png", path: "/#/?scene=live", clipTo: "Demo Kill" },
];

function findChrome() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `No Chrome/Edge found. Set CHROME_PATH. Tried:\n  ${CHROME_CANDIDATES.join("\n  ")}`,
    );
  }
  return found;
}

/** Padded box around the control, clamped to the viewport. */
async function clipFor(page, text) {
  const handle = await page.$(`::-p-text(${text})`);
  if (!handle) {
    console.warn(`  ! no element matching "${text}" — capturing the full page`);
    return undefined;
  }
  const box = await handle.boundingBox();
  await handle.dispose();
  if (!box) {
    return undefined;
  }
  // Tuned so the crop lands on the action card (elapsed / fuse / Stop / Demo
  // Kill and the line explaining what Demo Kill cuts), not its neighbour.
  const padX = 170;
  const padY = 150;
  const x = Math.max(0, box.x - padX);
  const y = Math.max(0, box.y - padY);
  return {
    x,
    y,
    width: Math.min(VIEWPORT.width - x, box.width + padX * 2),
    height: Math.min(VIEWPORT.height - y, box.height + padY * 2),
  };
}

await mkdir(OUT, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: findChrome(),
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1280,800"],
  defaultViewport: VIEWPORT,
});

try {
  for (const shot of SHOTS) {
    // A fresh page per scene: the app reads the scene once at mount, so a
    // hash-only change on a live page keeps the previous scene.
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.localStorage.clear();
    });
    await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("#root", { timeout: 15_000 });
    await new Promise((done) => setTimeout(done, 700));

    const file = resolve(OUT, shot.file);
    const clip = shot.clipTo ? await clipFor(page, shot.clipTo) : undefined;
    await page.screenshot({ path: file, type: "png", ...(clip ? { clip } : {}) });
    console.log(`${file}${clip ? " (clipped)" : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
}
