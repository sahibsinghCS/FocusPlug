import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./camera.ts", import.meta.url)),
  "utf8",
);

/**
 * getUserMedia is only defined in a secure context. The camera page used to be
 * loaded from a `data:` URL, which is an opaque origin — verified on Electron
 * 39: `isSecureContext === false`, `window.origin === "null"`, and
 * `navigator.mediaDevices === undefined`. So `focusplugStartCam()` threw,
 * Desk AI reported `uncertain` forever, and with strictMode the decision could
 * never reach ON_TASK. Loaded from a file the same page reports
 * `isSecureContext === true` and `typeof navigator.mediaDevices === "object"`.
 *
 * Source-level guard: the real assertion (secure context) only exists inside a
 * live Chromium, which neither vitest nor node:test provides.
 */
describe("ElectronCameraSource page load", () => {
  it("does not load the camera page from a data: URL", () => {
    const dataUrlLoad = /loadURL\(\s*[`"']data:/u.test(source);
    expect(dataUrlLoad).toBe(false);
  });

  it("loads the camera page from a file, which is a secure context", () => {
    expect(source).toMatch(/loadFile\(/u);
  });

  it("destroys the camera window when start fails, so retries cannot leak one", () => {
    // start() assigns this.window before awaiting, so a throw after that point
    // strands a hidden window and its renderer process on every retry.
    const classStart = source.indexOf("class ElectronCameraSource");
    expect(classStart).toBeGreaterThan(-1);
    const startAt = source.indexOf("async start()", classStart);
    const startBody = source.slice(startAt, source.indexOf("async stop()", startAt));
    expect(startBody).toMatch(/catch\s*\(error\)\s*\{[\s\S]*?await this\.stop\(\)/u);
  });
});
