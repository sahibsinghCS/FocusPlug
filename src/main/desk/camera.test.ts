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
        return true;
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
    async loadURL(_url: string): Promise<void> {
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
    expect(
      parseDshowVideoDevices('[dshow @ 0x1] "Microphone Array" (audio)'),
    ).toEqual([]);
  });
});
