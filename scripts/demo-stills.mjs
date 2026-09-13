import { createServer } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import puppeteer from "puppeteer-core";

/**
 * The browser demo's gauntlet: run headless Chromium against the BUILT output
 * (`dist/demo`, produced by `npm run demo:build`) — not the dev server — and
 * fail loudly on anything a judge would hit.
 *
 * What it enforces, beyond capturing the stills:
 *   1. Zero off-origin requests. The page must reach no CDN, no font host, no
 *      model server. Every request is intercepted and anything that is not a
 *      same-origin file (or a data:/blob: URI) aborts the run.
 *   2. No console errors or unhandled page errors on any scene.
 *   3. The scripted beats really render — each scene asserts text that can
 *      only appear if the model and the policy engine produced it.
 *   4. No horizontal scrolling at 1280 px or at 900 px, and no element whose
 *      own overflow rules hide part of its text at either width.
 *   5. The calibration readout — `logit → σ(a·z+b) → risk`, the one model
 *      internal this page promises is legible — renders end to end AND inside
 *      the 800 px fold in every scene that shows the panel. It used to do
 *      neither: the term-group strip squeezed it to an ellipsis at every
 *      width, and the still that shows risk climbing cut it off entirely.
 *   6. The same bundle boots from `file://` (double-clicked index.html), which
 *      is the difference between "works on my static host" and "works".
 *
 * Usage: node scripts/demo-stills.mjs [outDir] [prefix]
 */

const DIST = resolve("dist/demo");
const OUT = resolve(process.argv[2] ?? "demo/evidence");
const PREFIX = process.argv[3] ?? "demo";

const SCENES = [
  {
    name: "initial",
    query: "?t=3&freeze=1",
    expect: ["ON TASK", "Focus Forecast", "warming up", "Simulated inputs · real model · real policy"],
    forbid: ["Pre-armed"],
    calibration: true,
  },
  {
    name: "mid-rise",
    query: "?t=37&freeze=1",
    expect: [
      "Why now",
      "Feature attributions · 24 inputs",
      "Term groups",
      "drift risk · next 30 s",
      "logit",
      "→ risk",
    ],
    calibration: true,
  },
  {
    name: "nudge",
    query: "?t=40&freeze=1",
    expect: ["Focus Forecast · nudge", "pre-tab-out pattern", "Elevated"],
    calibration: true,
  },
  {
    name: "prearm",
    query: "?t=59&freeze=1",
    expect: ["Pre-armed", "FUSE 10s → 5s", "pre-armed · forecast"],
    calibration: true,
  },
  {
    // The countdown overlay is full-bleed here, so the panel behind it is not
    // what the judge is reading — only the receipt is.
    name: "kill-receipt",
    query: "?t=69&freeze=1",
    expect: ["Killing blocked apps in", "Forecast pre-armed", "DISTRACTED"],
  },
  {
    name: "unlocked",
    query: "?t=76&freeze=1",
    expect: ["ON TASK", "called it", "unlock · back on task"],
    forbid: ["Killing blocked apps in"],
    calibration: true,
  },
];

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".bin": "application/octet-stream",
};

const failures = [];

function fail(message) {
  failures.push(message);
  console.error(`FAIL  ${message}`);
}

function ok(message) {
  console.log(`ok    ${message}`);
}

/** Minimal static host for dist/demo — proves the build works when served. */
async function startServer() {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const file = resolve(DIST, relative);
    if (!file.startsWith(DIST + sep) && file !== join(DIST, "index.html")) {
      res.writeHead(403).end("forbidden");
      return;
    }
    readFile(file)
      .then((body) => {
        res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
        res.end(body);
      })
      .catch(() => {
        res.writeHead(404).end("not found");
      });
  });
  await new Promise((done) => server.listen(0, "127.0.0.1", done));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function newPage(browser, origin, label) {
  const page = await browser.newPage();
  const problems = { console: [], network: [] };
  page.on("console", (message) => {
    if (message.type() === "error") {
      problems.console.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    problems.console.push(String(error));
  });
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    const local =
      url.startsWith(origin) ||
      url.startsWith("data:") ||
      url.startsWith("blob:") ||
      url.startsWith("about:");
    if (!local) {
      problems.network.push(`${label}: ${request.method()} ${url}`);
      void request.abort();
      return;
    }
    void request.continue();
  });
  return { page, problems };
}

/**
 * `innerText` is uppercased by the console's `text-transform` rules and
 * `textContent` drops block boundaries, so scenes are matched against both.
 */
function readText(page) {
  return page.evaluate(() => {
    const body = document.body;
    return `${body.innerText}\n${body.textContent ?? ""}`;
  });
}

/**
 * Everything on the page whose own overflow rules are hiding part of its text.
 * A `truncate` that fits is invisible here; one that is actually eating
 * characters is reported with what it needed and what it had. The line this
 * page exists to prove — `logit … → risk 0.57` — was living inside one of
 * these, so "it has a title attribute" is not a defence: nobody hovers a
 * screenshot.
 */
function readClipped(page) {
  return page.evaluate(() => {
    const clipped = [];
    for (const node of document.querySelectorAll("*")) {
      if (node.children.length > 0) {
        continue;
      }
      const text = (node.textContent ?? "").trim();
      if (text === "" || node.clientWidth === 0) {
        continue;
      }
      const style = getComputedStyle(node);
      const hidesOverflow =
        style.textOverflow === "ellipsis" ||
        style.overflow === "hidden" ||
        style.overflowX === "hidden";
      if (!hidesOverflow) {
        continue;
      }
      if (node.scrollWidth > node.clientWidth + 1) {
        clipped.push(`"${text.slice(0, 48)}" needs ${node.scrollWidth}px, has ${node.clientWidth}px`);
      }
    }
    return clipped;
  });
}

/**
 * The calibration readout, measured rather than eyeballed: the whole string
 * has to be rendered (not ellipsed) and the whole box has to be inside the
 * 800 px frame the stills are captured at.
 */
function readCalibration(page) {
  return page.evaluate(() => {
    const line = document.querySelector('p[title^="logit "]');
    if (line === null) {
      return null;
    }
    const box = line.getBoundingClientRect();
    return {
      text: (line.textContent ?? "").trim(),
      whole: line.scrollWidth <= line.clientWidth + 1,
      top: Math.round(box.top),
      bottom: Math.round(box.bottom),
      withinFold: box.top >= 0 && box.bottom <= window.innerHeight,
    };
  });
}

async function settle(page) {
  await page.waitForSelector("#root", { timeout: 20_000 });
  await page.waitForFunction(
    () => (document.querySelector("#root")?.childElementCount ?? 0) > 0,
    { timeout: 20_000 },
  );
  await page.evaluate(() => document.fonts.ready);
  await new Promise((done) => setTimeout(done, 700));
}

await mkdir(OUT, { recursive: true });

const { server, origin } = await startServer();
console.log(`serving ${DIST} at ${origin}`);

const EXECUTABLE =
  process.env.PUPPETEER_EXECUTABLE_PATH ??
  process.env.CHROME_PATH ??
  "/opt/pw-browsers/chromium";

const BASE_ARGS = [
  "--no-sandbox",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--window-size=1280,800",
];

function launch(extraArgs = []) {
  return puppeteer.launch({
    executablePath: EXECUTABLE,
    headless: "new",
    args: [...BASE_ARGS, ...extraArgs],
    defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
  });
}

const browser = await launch();

try {
  for (const scene of SCENES) {
    const { page, problems } = await newPage(browser, origin, scene.name);
    await page.goto(`${origin}/index.html${scene.query}`, {
      waitUntil: "networkidle0",
      timeout: 45_000,
    });
    await settle(page);

    const text = await readText(page);
    for (const needle of scene.expect) {
      if (!text.includes(needle)) {
        fail(`${scene.name}: missing copy ${JSON.stringify(needle)}`);
      }
    }
    for (const needle of scene.forbid ?? []) {
      if (text.includes(needle)) {
        fail(`${scene.name}: unexpected copy ${JSON.stringify(needle)}`);
      }
    }

    // Measured at the still's own viewport, before anything is resized.
    if (scene.calibration) {
      const calibration = await readCalibration(page);
      if (calibration === null) {
        fail(`${scene.name}: the calibration readout is not on the page`);
      } else {
        if (!calibration.whole) {
          fail(`${scene.name}: calibration readout is cut off — rendered "${calibration.text}"`);
        }
        if (!/→ risk \d\.\d\d$/.test(calibration.text)) {
          fail(
            `${scene.name}: calibration readout does not end in a risk — "${calibration.text}"`,
          );
        }
        if (!calibration.withinFold) {
          fail(
            `${scene.name}: calibration readout is outside the 800px frame (top ${calibration.top}, bottom ${calibration.bottom})`,
          );
        }
        if (calibration.whole && calibration.withinFold) {
          ok(`${scene.name}: reads "${calibration.text}" in frame`);
        }
      }
    }

    const file = join(OUT, `${PREFIX}-${scene.name}-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(`still ${file}`);

    for (const width of [1280, 900]) {
      await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
      await new Promise((done) => setTimeout(done, 250));
      const overflow = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      if (overflow.scrollWidth > overflow.clientWidth + 1) {
        fail(
          `${scene.name}: horizontal scroll at ${width}px (${overflow.scrollWidth} > ${overflow.clientWidth})`,
        );
      }
      for (const clipped of await readClipped(page)) {
        fail(`${scene.name}: text clipped at ${width}px — ${clipped}`);
      }
    }
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });

    if (problems.network.length > 0) {
      for (const request of problems.network) {
        fail(`off-origin request — ${request}`);
      }
    } else {
      ok(`${scene.name}: no off-origin requests`);
    }
    if (problems.console.length > 0) {
      for (const message of problems.console) {
        fail(`${scene.name}: console error — ${message}`);
      }
    }
    await page.close();
  }

  // Mode 2 must fail soft. This browser has no camera flags, so getUserMedia
  // is refused — the page has to say so and leave Mode 1 intact.
  {
    const { page, problems } = await newPage(browser, origin, "live-denied");
    await page.goto(`${origin}/index.html?mode=live`, {
      waitUntil: "networkidle0",
      timeout: 45_000,
    });
    await settle(page);
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((element) => (element.textContent ?? "").includes("Enable webcam"))
        ?.click();
    });
    await page
      .waitForFunction(
        () => (document.body.textContent ?? "").includes("scripted run above"),
        { timeout: 30_000, polling: 250 },
      )
      .catch(() => fail("live-denied: no explanation after a refused camera"));
    const file = join(OUT, `${PREFIX}-live-denied-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(`still ${file}`);

    // Back to Mode 1: the scripted run must be untouched by the refusal.
    await page.evaluate(() => {
      [...document.querySelectorAll("button")]
        .find((element) => (element.textContent ?? "").trim().startsWith("Scripted run"))
        ?.click();
    });
    await page
      .waitForFunction(
        () => (document.body.textContent ?? "").includes("Focus Forecast"),
        { timeout: 15_000, polling: 250 },
      )
      .catch(() => fail("live-denied: scripted mode did not come back"));
    const deniedText = await readText(page);
    for (const needle of ["Focus Forecast", "drift risk · next 30 s"]) {
      if (!deniedText.includes(needle)) {
        fail(`live-denied: missing copy ${JSON.stringify(needle)}`);
      }
    }
    if (problems.console.length > 0) {
      for (const message of problems.console) {
        fail(`live-denied: console error — ${message}`);
      }
    } else {
      ok("live-denied: refused camera degrades to a message, Mode 1 untouched");
    }
    await page.close();
  }

  // The built page must also run with no server at all.
  {
    const { page, problems } = await newPage(browser, "file://", "file-url");
    const fileUrl = `${pathToFileURL(join(DIST, "index.html")).href}?t=59&freeze=1`;
    await page.goto(fileUrl, { waitUntil: "load", timeout: 45_000 });
    await settle(page);
    const text = await readText(page);
    for (const needle of ["Focus Forecast", "Pre-armed", "FUSE 10s → 5s"]) {
      if (!text.includes(needle)) {
        fail(`file://: missing copy ${JSON.stringify(needle)}`);
      }
    }
    if (problems.console.length > 0) {
      for (const message of problems.console) {
        fail(`file://: console error — ${message}`);
      }
    } else {
      ok("file://: boots clean from a double-clicked index.html");
    }
    const file = join(OUT, `${PREFIX}-file-url-1280x800.png`);
    await page.screenshot({ path: file, type: "png" });
    console.log(`still ${file}`);
    await page.close();
  }
} finally {
  await browser.close();
}

/**
 * Mode 2 end to end, with Chromium's synthetic camera standing in for a judge.
 * The fake device shows a rolling pattern with no face in it, so the shipped
 * `classifyDesk` returns a high-confidence `away` — which is exactly the
 * "judge covers the lens" path: live desk telemetry through the real policy
 * engine, Decision AWAY, a real fuse. Loading the BlazeFace graph here also
 * proves the weights are genuinely bundled: the request interceptor is still
 * armed, so a single fetch to a model host would fail the run.
 */
const liveBrowser = await launch([
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--autoplay-policy=no-user-gesture-required",
]);
try {
  const { page, problems } = await newPage(liveBrowser, origin, "live-desk");
  await page.goto(`${origin}/index.html?mode=live`, {
    waitUntil: "networkidle0",
    timeout: 45_000,
  });
  await settle(page);

  const clicked = await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((element) =>
      (element.textContent ?? "").includes("Enable webcam"),
    );
    button?.click();
    return Boolean(button);
  });
  if (!clicked) {
    fail("live: no Enable webcam button");
  }

  try {
    await page.waitForFunction(
      () => /faces \d/.test(document.body.textContent ?? ""),
      { timeout: 180_000, polling: 250 },
    );
    ok("live: bundled BlazeFace graph initialised and produced a reading");
    // No face in the synthetic frame ⇒ away ⇒ the policy engine arms a fuse.
    await page.waitForFunction(
      () => (document.body.textContent ?? "").includes("Killing blocked apps in"),
      { timeout: 60_000, polling: 250 },
    );
    ok("live: desk absence drove the real policy engine to a countdown");
    const fuseText = await readText(page);
    for (const needle of ["Away", "AWAY", "Killing blocked apps in"]) {
      if (!fuseText.includes(needle)) {
        fail(`live: missing copy ${JSON.stringify(needle)} while the fuse burned`);
      }
    }
    const fuseFile = join(OUT, `${PREFIX}-live-fuse-1280x800.png`);
    await page.screenshot({ path: fuseFile, type: "png" });
    console.log(`still ${fuseFile}`);
    // Chromium's synthetic camera is a rolling pattern, so BlazeFace flickers
    // between "no face" and a low-probability blob — which is a fair test of
    // the policy's own uncertainty rule: `uncertain` cancels a desk-only fuse
    // rather than killing on a maybe. Either a cancel or an elapsed fuse
    // retires the overlay and hands back the panel for a clean still.
    await page.waitForFunction(
      () => !(document.body.textContent ?? "").includes("Killing blocked apps in"),
      { timeout: 90_000, polling: 250 },
    );
    ok("live: the fuse resolved (elapsed or cancelled) and the panel came back");
  } catch (error) {
    fail(`live: ${error instanceof Error ? error.message : String(error)}`);
  }

  const liveText = await readText(page);
  for (const needle of ["MediaPipe BlazeFace", "faces ", "start_countdown"]) {
    if (!liveText.includes(needle)) {
      fail(`live: missing copy ${JSON.stringify(needle)}`);
    }
  }
  if (problems.network.length > 0) {
    for (const request of problems.network) {
      fail(`off-origin request — ${request}`);
    }
  } else {
    ok("live: no off-origin requests (model weights are inlined)");
  }
  if (problems.console.length > 0) {
    for (const message of problems.console) {
      fail(`live: console error — ${message}`);
    }
  }

  const file = join(OUT, `${PREFIX}-live-panel-1280x800.png`);
  await page.screenshot({ path: file, type: "png" });
  console.log(`still ${file}`);
  await page.close();
} finally {
  await liveBrowser.close();
  server.close();
}

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll demo checks passed.");
