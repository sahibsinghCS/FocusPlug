import puppeteer from "puppeteer-core";
import { resolveChrome } from "./lib/chrome.mjs";
import { startPreview } from "./lib/preview-server.mjs";

/**
 * Clicks the session surface end to end against mock IPC and fails loudly if a
 * control has become decorative.
 *
 *   npm run smoke:session-actions
 *
 * What it covers, and why each one is here:
 *   - `#/` with no session renders the PLAN (hold-to-lock), not a console.
 *   - Holding the switch for real enters LOCK MODE, and `Console` there reaches
 *     the live console with the session still armed — the shipped path, with no
 *     `?scene=` seeding, because a console only a mock can reach is not shipped.
 *   - `?scene=live` renders the live console, decision hero reading ON TASK.
 *   - Demo Kill reports what it killed, so the button is wired to IPC.
 *   - Stop session hands the route back to the plan.
 *   - The frozen fuse overlay names BOTH consequences (apps and plugs) and its
 *     skip-wait button dismisses it.
 *   - A pre-armed clock renders the `10s → 5s` chip, so the forecast reaches
 *     the session surface and not only its own panel.
 * A console error or an uncaught page error on any of those pages fails the run.
 *
 * Every scene gets a FRESH page: the app reads `?scene=` once at mount, so
 * navigating by hash on a live page would silently keep the previous scene.
 */

const wait = (ms) => new Promise((done) => setTimeout(done, ms));

async function clickNamed(page, needle) {
  const clicked = await page.evaluate((text) => {
    const match = [...document.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").includes(text),
    );
    if (!match) {
      return false;
    }
    match.click();
    return true;
  }, needle);
  if (!clicked) {
    throw new Error(`Button not found: ${needle}`);
  }
}

/**
 * The hold switch is a gesture, not a click: it commits after HOLD_MS of a held
 * pointer, so a `click()` does nothing at all. Driving it for real is the point
 * — this is the only way into a session in the shipped app.
 */
async function holdSwitch(page, needle) {
  const found = await page.evaluate((text) => {
    const match = [...document.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").includes(text),
    );
    if (!match) {
      return false;
    }
    // The plan scrolls; the switch lives at the bottom of it, and a pointer
    // cannot press what is below the fold.
    match.scrollIntoView({ block: "center" });
    return true;
  }, needle);
  if (!found) {
    throw new Error(`Hold switch not found: ${needle}`);
  }
  await wait(200);
  const box = await page.evaluate((text) => {
    const match = [...document.querySelectorAll("button")].find((button) =>
      (button.textContent ?? "").replace(/\s+/g, " ").includes(text),
    );
    if (!match) {
      return null;
    }
    const rect = match.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  }, needle);
  if (!box) {
    throw new Error(`Hold switch vanished: ${needle}`);
  }
  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  // Past HOLD_MS (620) with room to spare, then release like a hand does.
  await wait(900);
  await page.mouse.up();
  await wait(120);
}

async function hasButton(page, needle) {
  return page.evaluate(
    (text) =>
      [...document.querySelectorAll("button")].some((button) =>
        (button.textContent ?? "").replace(/\s+/g, " ").includes(text),
      ),
    needle,
  );
}

// puppeteer-core ships no browser and nothing else starts the preview server,
// so this script owns both. Chrome is resolved first: a missing browser should
// fail before Vite is spawned. Set SESSION_STILLS_BASE to drive a server you
// started yourself (`npm run preview:renderer`), and CHROME_PATH if Chrome is
// not on a standard path for this OS.
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
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

const failures = [];
let current = null;

/** Fresh page, clean storage, console/page errors collected for the whole run. */
async function open(path) {
  if (current !== null) {
    await current.close();
  }
  const page = await browser.newPage();
  current = page;
  await page.evaluateOnNewDocument(() => {
    window.localStorage.clear();
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      failures.push(`console error on ${path}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    failures.push(`page error on ${path}: ${String(error)}`);
  });
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.waitForSelector("#root", { timeout: 15_000 });
  return page;
}

try {
  // 1. No session: the route is the plan, and the hold switch is the only way in.
  let page = await open("/#/");
  await page.waitForSelector("#fp-dial-length", { timeout: 10_000 });
  if (!(await hasButton(page, "Hold to lock"))) {
    throw new Error("Plan is missing the hold-to-lock switch");
  }
  if ((await page.$("#fp-session-decision")) !== null) {
    throw new Error("Idle route rendered the live console instead of the plan");
  }

  // 2. The shipped path, with nothing seeded: hold the switch, land in lock
  //    mode, and step out to the live console without ending the session.
  //    Enforcement is armed for the whole of it. This is the one scene that
  //    does not go through `?scene=`, and it is the one that proves the console
  //    is reachable in the app rather than only in a seeded mock.
  await holdSwitch(page, "Hold to lock");
  await page.waitForSelector("#fp-lock", { timeout: 10_000 });
  if (!(await hasButton(page, "Hold to end"))) {
    throw new Error("Hold-to-lock did not enter lock mode");
  }
  if ((await page.$("#fp-session-decision")) !== null) {
    throw new Error("Lock mode rendered the console; it is meant to be the face alone");
  }
  await clickNamed(page, "Console");
  await page.waitForSelector("#fp-session-decision", { timeout: 10_000 });
  for (const label of ["Focus Forecast", "Live sensors", "Enforcement timeline"]) {
    if ((await page.$(`[aria-label='${label}']`)) === null) {
      throw new Error(`Live console is missing ${label}`);
    }
  }
  if ((await page.$("#fp-lock")) !== null) {
    throw new Error("Console still has the lock face over it");
  }
  // Live, not locked: the session is still armed and the nav is back.
  const stillLive = await page.$eval("#fp-session-decision", (node) => node.textContent);
  if (stillLive !== "ON TASK") {
    throw new Error(`Console dropped the live session, decision reads ${stillLive}`);
  }
  if (await hasButton(page, "Stop session")) {
    throw new Error("Console offered Stop session while the plan owns the session");
  }
  // And back into the face, with the session untouched.
  await clickNamed(page, "Back to lock mode");
  await page.waitForSelector("#fp-lock", { timeout: 10_000 });
  await holdSwitch(page, "Hold to end");
  await page.waitForFunction(() => document.querySelector("#fp-lock") === null, {
    timeout: 10_000,
  });

  // 3. Live session: the console, with the verdict in the largest type on it.
  page = await open("/#/?scene=live");
  await page.waitForSelector("#fp-session-decision", { timeout: 15_000 });
  const decision = await page.$eval("#fp-session-decision", (node) => node.textContent);
  if (decision !== "ON TASK") {
    throw new Error(`Expected ON TASK, got ${decision}`);
  }

  // 4. Demo Kill is wired: it reports its targets back through mock IPC.
  await clickNamed(page, "Demo Kill");
  await page.waitForFunction(() => /Last kill:/i.test(document.body.innerText), {
    timeout: 10_000,
  });

  // 5. Stopping hands the route back to the plan.
  await clickNamed(page, "Stop session");
  await page.waitForFunction(() => document.querySelector("#fp-session-decision") === null, {
    timeout: 10_000,
  });
  if (!(await hasButton(page, "Hold to lock"))) {
    throw new Error("Stopping the session did not return to the plan");
  }

  // 6. The fuse overlay names both consequences and can be skipped.
  page = await open("/#/?scene=distracted&countdown=8&freeze=1");
  await page.waitForSelector("[role='alertdialog']", { timeout: 10_000 });
  const overlay = await page.$eval("[role='alertdialog']", (node) => node.innerText);
  if (!/Killing blocked apps in/i.test(overlay)) {
    throw new Error("Overlay missing its countdown title");
  }
  if (!/Blocked apps will be force-quit/i.test(overlay)) {
    throw new Error("Overlay missing app-kill consequence");
  }
  if (!/plugs will be cut|No plugs armed/i.test(overlay)) {
    throw new Error("Overlay missing plug-cut consequence");
  }
  await clickNamed(page, "Demo Kill — skip wait");
  await page.waitForFunction(() => document.querySelector("[role='alertdialog']") === null, {
    timeout: 10_000,
  });

  // 7. The forecast reaches the clock: replay second 52 is a live pre-arm, and
  //    the plate must show the shortened fuse, not only the risk meter.
  page = await open("/#/?scene=live&freeze=1&fct=52");
  await page.waitForSelector("#fp-session-decision", { timeout: 15_000 });
  // Case-insensitive: the clock plate renders its chip in small caps, so
  // innerText comes back as "10S → 5S".
  await page.waitForFunction(
    () => {
      const text = document.body.innerText;
      return /\d+\s*s\s*→\s*\d+\s*s/i.test(text) && /pre-armed/i.test(text);
    },
    { timeout: 15_000 },
  );
  // Let any late console error from that frame land before we judge the run.
  await wait(300);

  if (failures.length > 0) {
    throw new Error(`Errors during the run:\n  ${failures.join("\n  ")}`);
  }

  console.log(
    "session actions smoke: plan → hold-to-lock → lock mode → console → live console → demo kill → stop → fuse overlay → pre-arm OK",
  );
} finally {
  await browser.close();
  await preview.stop();
}
