import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { resolveChrome } from "../../../../../scripts/lib/chrome.mjs";
import { startPreview } from "../../../../../scripts/lib/preview-server.mjs";

/**
 * Stills of the correction loop.
 *
 *   node src/renderer/src/features/corrections/stills.mjs [outDir] [prefix]
 *
 * The review list is the one that matters. This feature's central claim is
 * that a student's own webcam photographs stay on their machine, are listed
 * where they can see them, and are deletable in one action — and a claim like
 * that is worth exactly as much as the screen that keeps it. So the script
 * FAILS if the card is not on the page, if the privacy sentence is not next to
 * it, or if the delete control is missing. A green screenshot run of a blank
 * panel would be worse than no screenshot at all.
 *
 * Every scene is a seeded mock-IPC state from `scenes.ts`, which is the same
 * file `model.test.ts` and `scenes.test.ts` read. A still and a unit test
 * therefore cannot be looking at two different sets of numbers.
 *
 * The paused screen is driven rather than seeded: a URL scene cannot start the
 * renderer's run clock, so the script throws the hold switch and then fires a
 * pause-carrying nudge through the mock's own `__focusplugNudge` hook — the
 * same wire main uses, `correctionId` and all.
 */

const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/corrections/evidence");
const PREFIX = process.argv[3] ?? "corrections";

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

/** Settings scenes: seeded state, no gesture needed. */
const SETTINGS_SCENES = [
  // THE artifact: their photographs, the byte count, the folder button and the
  // one-action delete, with the never-uploaded sentence beside them.
  { name: "list", scene: "corrections-list", expect: ["Your corrections", "never uploaded"] },
  // Nothing stored, and it says why rather than showing a blank box.
  { name: "empty", scene: "corrections-empty", expect: ["Your corrections", "writes nothing"] },
  // A personal head that beat the gate — with the shipped head's score beside it.
  {
    name: "head-personal",
    scene: "corrections-personal",
    expect: ["Attention head — personal", "61.9%", "62.6%"],
  },
  // And the state this feature is most likely to be in: refit discarded, gate
  // named, corrections kept, shipped head still running.
  {
    name: "head-failed",
    scene: "corrections-failed",
    expect: ["Attention head — shipped", "regressed-pooled", "nothing was deleted"],
  },
];

/** Lock scenes: the verdict row, which needs a running clock and a pause. */
const LOCK_SCENES = [
  {
    name: "paused-phone",
    kind: "phone",
    expect: ["Paused — phone", "Was that right?", "I was working", "You were right"],
  },
  {
    name: "paused-away",
    kind: "away",
    expect: ["Paused — you left the desk", "Was that right?", "I was working"],
  },
];

/**
 * The loop is unreachable on a default install: only `deskModelId: "custom"`
 * can pause, and only a pause can produce a correction. So the still has to
 * put the preview on the trained model first — which is itself the point being
 * photographed, and the reason the chips are absent from every other screen.
 */
const CUSTOM_MODEL = { deskModelId: "custom", deskCorrectionsEnabled: true };

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

async function textOf(page) {
  return page.evaluate(() => document.body.innerText);
}

await mkdir(OUT, { recursive: true });

const CHROME = resolveChrome();
const preview = await startPreview({
  config: "scripts/renderer-preview.vite.ts",
  port: 5173,
  base: process.env.CORRECTIONS_STILLS_BASE,
});
const BASE = preview.origin;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1280,900"],
  defaultViewport: { width: 1280, height: 900, deviceScaleFactor: 1 },
});

const failures = [];

async function shoot(page, name, expect, selector) {
  // Case-insensitive: the paused header is uppercased in CSS, and a still that
  // failed over `text-transform` would teach the next reader to loosen the
  // check that matters rather than the one that does not.
  const text = (await textOf(page)).toLowerCase();
  for (const raw of expect) {
    const phrase = raw.toLowerCase();
    if (phrase.length > 0 && !text.includes(phrase)) {
      failures.push(`${name}: "${raw}" is not on the page`);
      console.error(`FAIL  ${name}: expected "${raw}" and it is not there`);
    }
  }
  const file = resolve(OUT, `${PREFIX}-${name}.png`);
  const target = selector === undefined ? null : await page.$(selector);
  if (selector !== undefined && target === null) {
    failures.push(`${name}: ${selector} is not on the page`);
    console.error(`FAIL  ${name}: ${selector} is not on the page`);
  }
  if (target === null) {
    await page.screenshot({ path: file, type: "png", fullPage: true });
  } else {
    // Grow the viewport to the card before clipping to it: puppeteer captures
    // an element by scrolling it into view, and the review list is
    // deliberately longer than a screen.
    const box = await target.boundingBox();
    if (box !== null) {
      await page.setViewport({
        width: 1280,
        height: Math.min(4000, Math.ceil(box.height) + 120),
        deviceScaleFactor: 1,
      });
      await wait(250);
    }
    await target.screenshot({ path: file, type: "png" });
  }
  console.log(`still ${file}`);
}

try {
  for (const scene of SETTINGS_SCENES) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => window.localStorage.clear());
    await page.goto(`${BASE}/#/settings?scene=${scene.scene}`, {
      waitUntil: "networkidle0",
      timeout: 30_000,
    });
    await page.waitForSelector("#root", { timeout: 15_000 });
    await wait(700);
    // The gate table is the disclosure; open it so the still shows it.
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (node) => (node.textContent ?? "").trim() === "Why this?",
      );
      button?.click();
    });
    await wait(200);
    // The card itself, not the whole settings page: the artifact is the review
    // list, and a still that buried it under six other sections would prove
    // nothing about it.
    await shoot(page, scene.name, scene.expect, "[data-corrections-card]");
    await page.close();
  }

  for (const scene of LOCK_SCENES) {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument((settings) => {
      window.localStorage.clear();
      window.localStorage.setItem("focusplug.mock.settings", JSON.stringify(settings));
    }, CUSTOM_MODEL);
    // No session scene: the shell has to be on SetupPage for the hold switch
    // to exist, and the run clock has to be the renderer's own.
    await page.goto(`${BASE}/#/`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("#root", { timeout: 15_000 });
    await throwSwitch(page);
    await page.evaluate((kind) => {
      window.__focusplugNudge?.(kind, undefined, true);
    }, scene.kind);
    await wait(600);
    // The nudge overlay sits in front of the paused screen and auto-dismisses
    // after 12 s. Its single `Got it` is the whole point of the contrast being
    // photographed: the overlay's control vanishes on a timer, the verdict
    // chips behind it do not.
    await page.evaluate(() => {
      const button = [...document.querySelectorAll("button")].find(
        (node) => (node.textContent ?? "").trim().toLowerCase() === "got it",
      );
      button?.click();
    });
    await wait(400);
    await shoot(page, scene.name, scene.expect);
    await page.close();
  }
} finally {
  await browser.close();
  await preview.stop();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} still(s) did not render what they claim:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("\nEvery correction still rendered a real screen.");
