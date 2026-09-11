import puppeteer from "puppeteer-core";

const BASE = process.env.SESSION_STILLS_BASE ?? "http://127.0.0.1:5173";

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

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH ?? "/usr/local/bin/google-chrome",
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--window-size=1280,800"],
  defaultViewport: { width: 1280, height: 800, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  window.localStorage.clear();
});

try {
  await page.goto(`${BASE}/#/`, { waitUntil: "networkidle0", timeout: 30_000 });
  await page.waitForSelector("#fp-session-decision", { timeout: 15_000 });
  const idle = await page.$eval("#fp-session-decision", (node) => node.textContent);
  if (idle !== "IDLE") {
    throw new Error(`Expected IDLE, got ${idle}`);
  }

  await clickNamed(page, "Start session");
  await page.waitForFunction(
    () => document.querySelector("#fp-session-decision")?.textContent === "ON TASK",
    { timeout: 10_000 },
  );

  await clickNamed(page, "Stop session");
  await page.waitForFunction(
    () => document.querySelector("#fp-session-decision")?.textContent === "IDLE",
    { timeout: 10_000 },
  );

  await clickNamed(page, "Demo Kill");
  await page.waitForFunction(() => /Last kill:/i.test(document.body.innerText), {
    timeout: 10_000,
  });

  await page.goto(`${BASE}/?scene=distracted&countdown=8&freeze=1`, {
    waitUntil: "networkidle0",
    timeout: 30_000,
  });
  await page.waitForSelector("[role='alertdialog']", { timeout: 10_000 });
  const overlay = await page.$eval("[role='alertdialog']", (node) => node.innerText);
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

  console.log("session actions smoke: start/stop/demo-kill/overlay OK");
} finally {
  await browser.close();
}
