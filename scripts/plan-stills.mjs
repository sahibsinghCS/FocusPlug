import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import puppeteer from "puppeteer-core";
import { resolveChrome } from "./lib/chrome.mjs";
import { startPreview } from "./lib/preview-server.mjs";

/**
 * Stills of the Focus Plan surfaces.
 *
 *   npm run plan:stills [outDir] [prefix]
 *
 * Every scene is a seeded mock-IPC state from
 * src/renderer/src/features/focusplan/scenes.ts, which reads the SAME named
 * ledgers in src/shared/plan/fixtures.ts that the estimator's unit tests read.
 * A screenshot and a unit test therefore cannot be looking at two different
 * sets of numbers, which is the only reason a still is evidence of anything.
 *
 * `plan-cold` is the one that matters. It is a fresh install with zero
 * history, and it is the artifact that proves rung 0 of the cold-start ladder
 * is a real recommendation with real reasoning rather than an empty state.
 * The script FAILS if that card is not on the page, so the claim cannot rot
 * into a screenshot of a blank panel.
 *
 * Not photographed here: the mid-session revision line on the nudge overlay.
 * It needs a live focus block — `liveRoundFor` returns null without one — and
 * a URL scene cannot start the renderer's run clock, so driving it would mean
 * replaying the hold gesture the way scripts/readme-stills.mjs does. It is
 * asserted by test instead: `revisionFor` in
 * src/renderer/src/features/focusplan/model.test.ts and `reviseBreak` in
 * src/shared/plan/revise.test.ts, including the guard that keeps it silent
 * while a fuse is burning.
 */

const OUT = resolve(process.argv[2] ?? "src/renderer/src/features/focusplan/evidence");
const PREFIX = process.argv[3] ?? "plan";

const SCENES = [
  // Fresh install, zero history: the pomodoro default, said to be the default.
  { name: "cold", path: "/#/?scene=plan-cold", expect: "Focus plan" },
  // Holds of 19, 22 and 20 -> a Kaplan-Meier median of 20.
  { name: "measured", path: "/#/?scene=plan-measured", expect: "Focus plan" },
  // A window carrying rounds the estimator threw away, with their reasons.
  { name: "mixed", path: "/#/?scene=plan-mixed", expect: "Focus plan" },
  // The debrief for a round that drifted, and for one that ran clean.
  { name: "debrief-drifted", path: "/#/?scene=debrief-drifted", expect: "Round debrief" },
  { name: "debrief-clean", path: "/#/?scene=debrief-clean", expect: "Round debrief" },
  // Twenty rounds over ten evenings and no improvement: the trend is refused
  // by `below-noise`, and the caption has to say so rather than claim the
  // student is short of history.
  { name: "debrief-flat", path: "/#/?scene=debrief-flat", expect: "Round debrief" },
];

await mkdir(OUT, { recursive: true });

// puppeteer-core ships no browser and nothing else starts the preview server,
// so this script owns both. Chrome is resolved first: a missing browser should
// fail before Vite is spawned. Set PLAN_STILLS_BASE to screenshot a server you
// started yourself (`npm run preview:renderer`), and CHROME_PATH if Chrome is
// not on a standard path for this OS.
const CHROME = resolveChrome();
const preview = await startPreview({
  config: "scripts/renderer-preview.vite.ts",
  port: 5173,
  base: process.env.PLAN_STILLS_BASE,
});
const BASE = preview.origin;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

const failures = [];

try {
  for (const scene of SCENES) {
    // A fresh page per scene: the app reads the scene once at mount, so a
    // hash-only change on a live page keeps the previous scene. Clearing
    // localStorage also resets the saved Dial, which the plan card compares
    // itself against.
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      window.localStorage.clear();
    });
    await page.goto(`${BASE}${scene.path}`, { waitUntil: "networkidle0", timeout: 30_000 });
    await page.waitForSelector("#root", { timeout: 15_000 });
    await new Promise((wait) => setTimeout(wait, scene.settleMs ?? 700));

    // The point of the check: a card that rendered nothing is the exact
    // failure this feature claims cannot happen, and a green screenshot run
    // would otherwise hide it.
    const found = await page.$(`[aria-label="${scene.expect}"]`);
    if (found === null) {
      failures.push(`${scene.name}: no [aria-label="${scene.expect}"] on the page`);
      console.error(`FAIL  ${scene.name}: expected "${scene.expect}" and it is not there`);
    } else {
      console.log(`ok    ${scene.name}: "${scene.expect}" rendered`);
    }

    const file = resolve(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(`still ${file}`);
    await page.close();
  }
} finally {
  await browser.close();
  await preview.stop();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} scene(s) rendered nothing:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("\nAll Focus Plan stills rendered a real card.");
