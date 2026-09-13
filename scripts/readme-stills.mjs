/**
 * Regenerates the five stills the README and demo script embed.
 *
 *   npm run preview:renderer      # terminal 1 (127.0.0.1:5173)
 *   npm run stills:readme         # terminal 2
 *
 * Scenes are the seeded mock-IPC states from src/renderer/src/lib/urlScene.ts,
 * so this renders the real UI without a live session. The lock-mode shots throw
 * the hold switch the same way a pointer does. Replace these with live captures
 * from the take when you film (docs/DEMO-SCRIPT.md).
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

/** Multi-round so the ribbon and a break exist to photograph. */
const ROUNDED_PLAN = { shape: "sprint", focusMin: 15, breakMin: 3, rounds: 6 };
/** Short, so `settleMs` gets the aircraft a visible way along its route. */
const SHORT_PLAN = { shape: "custom", focusMin: 5, breakMin: 10, rounds: 1 };

/** `lock` throws the hold switch; `skip` then advances into the break. */
const SHOTS = [
  { file: "01-session-panel.png", path: "/#/?scene=live" },
  {
    file: "02-lock-flight.png",
    path: "/#/?scene=live",
    plan: SHORT_PLAN,
    lock: true,
    // A still of a flight that has not left yet sells nothing; let it fly.
    settleMs: 75_000,
  },
  { file: "03-kill-overlay.png", path: "/#/?scene=distracted&countdown=8&freeze=1" },
  { file: "04-lock-hourglass.png", path: "/#/?scene=live", face: "hourglass", lock: true },
  { file: "05-session-log.png", path: "/#/log?scene=golden" },
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

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Hold-to-lock is a gesture, not a click — press and keep holding past 620ms. */
async function throwSwitch(page) {
  const found = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) =>
      (node.textContent ?? "").includes("Hold to lock"),
    );
    if (!button) {
      return false;
    }
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    return true;
  });
  if (!found) {
    throw new Error("Hold to lock switch not found on the session plan");
  }
  await wait(900);
}

async function skipPhase(page) {
  const found = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((node) =>
      /^Skip /.test((node.textContent ?? "").trim()),
    );
    button?.click();
    return Boolean(button);
  });
  if (!found) {
    throw new Error("Skip control not found in lock mode");
  }
  await wait(500);
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
    await page.evaluateOnNewDocument(
      (plan, face) => {
        window.localStorage.clear();
        if (plan) {
          window.localStorage.setItem("focusplug.plan.v1", JSON.stringify(plan));
        }
        if (face) {
          window.localStorage.setItem("focusplug.face.v1", face);
        }
      },
      shot.plan ?? null,
      shot.face ?? null,
    );
    await page.goto(`${BASE}${shot.path}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("#root", { timeout: 15_000 });
    await wait(700);

    if (shot.lock) {
      await throwSwitch(page);
    }
    for (let index = 0; index < (shot.skip ?? 0); index += 1) {
      await skipPhase(page);
    }
    if (shot.settleMs) {
      console.log(`  … flying for ${Math.round(shot.settleMs / 1000)}s`);
      await wait(shot.settleMs);
    }

    const file = resolve(OUT, shot.file);
    await page.screenshot({ path: file, type: "png" });
    console.log(file);
    await page.close();
  }
} finally {
  await browser.close();
}
