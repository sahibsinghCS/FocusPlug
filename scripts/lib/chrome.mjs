import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

/**
 * Resolve a Chrome/Chromium executable for the headless stills and gauntlet
 * scripts.
 *
 * The repo depends on `puppeteer-core`, which by design never downloads a
 * browser, so every one of these scripts needs a browser that is already
 * installed. A hardcoded container path is not a fallback — it resolves on
 * exactly one machine and fails opaquely everywhere else — so this walks the
 * standard install locations for the host OS and, if none of them exist,
 * fails with the one line that fixes it.
 *
 *   CHROME_PATH=/path/to/chrome npm run demo:verify
 */

/** Explicit overrides, in the order the scripts historically honoured them. */
const ENV_KEYS = ["PUPPETEER_EXECUTABLE_PATH", "CHROME_PATH"];

/** Executable names to look for on PATH after the well-known paths miss. */
const PATH_NAMES =
  process.platform === "win32"
    ? ["chrome.exe", "msedge.exe"]
    : [
        "google-chrome-stable",
        "google-chrome",
        "chromium-browser",
        "chromium",
        "microsoft-edge-stable",
      ];

function windowsCandidates() {
  const roots = [
    process.env["PROGRAMFILES"],
    process.env["PROGRAMFILES(X86)"],
    process.env["LOCALAPPDATA"],
  ].filter((root) => typeof root === "string" && root.length > 0);
  const suffixes = [
    "Google\\Chrome\\Application\\chrome.exe",
    "Chromium\\Application\\chrome.exe",
    "Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return roots.flatMap((root) => suffixes.map((suffix) => join(root, suffix)));
}

function wellKnownCandidates() {
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  if (process.platform === "win32") {
    return windowsCandidates();
  }
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/local/bin/google-chrome",
    "/opt/google/chrome/chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/local/bin/chromium",
    "/snap/bin/chromium",
    // Playwright/CI images keep a browser here; last, never first.
    "/opt/pw-browsers/chromium",
  ];
}

function pathCandidates() {
  const dirs = (process.env["PATH"] ?? "").split(delimiter).filter(Boolean);
  return dirs.flatMap((dir) => PATH_NAMES.map((name) => join(dir, name)));
}

function isExecutable(candidate) {
  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {string} absolute path to a Chrome/Chromium executable.
 * @throws {Error} with the CHROME_PATH remedy when nothing resolves.
 */
export function resolveChrome() {
  for (const key of ENV_KEYS) {
    const override = process.env[key];
    if (typeof override === "string" && override.length > 0) {
      if (!isExecutable(override)) {
        throw new Error(
          `${key}=${override} is not an executable file. Point it at a Chrome/Chromium binary.`,
        );
      }
      return override;
    }
  }

  const searched = [...wellKnownCandidates(), ...pathCandidates()];
  for (const candidate of searched) {
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    [
      "No Chrome/Chromium found. These scripts drive a real browser and the repo's",
      "`puppeteer-core` dependency deliberately does not ship one.",
      "Install Chrome or Chromium, or point this run at the browser you have:",
      "",
      "  CHROME_PATH=/path/to/chrome npm run <script>",
      "",
      `Looked in ${searched.length} standard locations for this platform (${process.platform}).`,
    ].join("\n"),
  );
}
