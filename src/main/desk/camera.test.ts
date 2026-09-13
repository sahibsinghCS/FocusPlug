import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElectronCameraSource, parseDshowVideoDevices } from "./camera";

const fake = vi.hoisted(() => {
  // 1x1 PNG so the post-start grab probe succeeds immediately.
  const PNG_1X1_DATA_URL =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const state = { startCamError: null as string | null };
  class FakeWebContents {
    setBackgroundThrottling(_throttle: boolean): void {
      return;
    }
    async executeJavaScript(code: string): Promise<unknown> {
      if (code.includes("focusplugStartCam")) {
        // Simulate a slow getUserMedia so concurrent starts overlap.
        await new Promise((resolve) => setTimeout(resolve, 20));
        if (state.startCamError) {
          throw new Error(state.startCamError);
        }
        return "Integrated Webcam";
      }
      if (code.includes("focusplugListCams")) {
        return [{ deviceId: "cam-0", label: "Integrated Webcam" }];
      }
      if (code.includes("focusplugGrabFrame")) {
        return PNG_1X1_DATA_URL;
      }
      return null;
    }
  }
  class FakeBrowserWindow {
    static created: FakeBrowserWindow[] = [];
    destroyed = false;
    webContents = new FakeWebContents();
    constructor() {
      FakeBrowserWindow.created.push(this);
    }
    async loadFile(_file: string): Promise<void> {
      return;
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    destroy(): void {
      this.destroyed = true;
    }
  }
  return { FakeBrowserWindow, state };
});

vi.mock("electron", () => ({
  BrowserWindow: fake.FakeBrowserWindow,
  app: { isReady: () => true },
  session: {
    fromPartition: () => ({
      setPermissionRequestHandler: () => {
        return;
      },
    }),
  },
}));

describe("ElectronCameraSource", () => {
  beforeEach(() => {
    fake.FakeBrowserWindow.created.length = 0;
    fake.state.startCamError = null;
  });

  it("destroys the hidden window when camera acquisition fails, so retries do not leak", async () => {
    fake.state.startCamError = "NotFoundError: Requested device not found";
    const source = new ElectronCameraSource();
    await expect(source.start()).rejects.toThrow("NotFoundError");
    // DeskMonitor retries start() on the next tick — must not orphan windows.
    await expect(source.start()).rejects.toThrow("NotFoundError");
    expect(fake.FakeBrowserWindow.created).toHaveLength(2);
    expect(fake.FakeBrowserWindow.created.every((win) => win.destroyed)).toBe(true);
  });

  it("concurrent start() calls share one warm-up instead of leaking a second camera window", async () => {
    const source = new ElectronCameraSource();
    // Both callers race in while getUserMedia is still pending — only one
    // hidden window may exist, or the untracked one holds the webcam forever.
    await Promise.all([source.start(), source.start()]);
    expect(fake.FakeBrowserWindow.created).toHaveLength(1);
    await source.stop();
    expect(fake.FakeBrowserWindow.created.every((win) => win.destroyed)).toBe(true);
  });
});

const source = readFileSync(fileURLToPath(new URL("./camera.ts", import.meta.url)), "utf8");

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
    // The warm-up assigns this.window before awaiting, so a throw after that
    // point strands a hidden window and its renderer process on every retry.
    const classStart = source.indexOf("class ElectronCameraSource");
    expect(classStart).toBeGreaterThan(-1);
    const startAt = source.indexOf("async start()", classStart);
    const startBody = source.slice(startAt, source.indexOf("async stop()", startAt));
    expect(startBody).toMatch(/catch\s*\(error\)\s*\{[\s\S]*?await this\.stop\(\)/u);
  });
});

describe("parseDshowVideoDevices", () => {
  it("reads devices from the sectioned listing and skips audio/alternative names", () => {
    const listing = [
      '[dshow @ 0x1] DirectShow video devices (some may be both video and audio devices)',
      '[dshow @ 0x1]  "Logitech HD Pro Webcam C920"',
      '[dshow @ 0x1]     Alternative name "@device_pnp_usb#vid_046d"',
      '[dshow @ 0x1] DirectShow audio devices',
      '[dshow @ 0x1]  "Microphone (C920)"',
    ].join("\n");
    expect(parseDshowVideoDevices(listing)).toEqual(["Logitech HD Pro Webcam C920"]);
  });

  it("reads devices from the tagged listing", () => {
    const listing = [
      '[dshow @ 0x1] "Integrated Webcam" (video)',
      '[dshow @ 0x1]   Alternative name "@device_pnp_usb#vid_0c45"',
      '[dshow @ 0x1] "Microphone Array" (audio)',
    ].join("\n");
    expect(parseDshowVideoDevices(listing)).toEqual(["Integrated Webcam"]);
  });

  it("returns an empty list when no video device is present", () => {
    expect(parseDshowVideoDevices("")).toEqual([]);
    expect(parseDshowVideoDevices('[dshow @ 0x1] "Microphone Array" (audio)')).toEqual([]);
  });
});
