import { beforeEach, describe, expect, it, vi } from "vitest";
import { ElectronCameraSource, parseDshowVideoDevices } from "./camera";

const fake = vi.hoisted(() => {
  class FakeWebContents {
    setBackgroundThrottling(_throttle: boolean): void {
      return;
    }
    async executeJavaScript(code: string): Promise<unknown> {
      if (code.includes("focusplugStartCam")) {
        throw new Error("NotFoundError: Requested device not found");
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
  return { FakeBrowserWindow };
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
  });

  it("destroys the hidden window when camera acquisition fails, so retries do not leak", async () => {
    const source = new ElectronCameraSource();
    await expect(source.start()).rejects.toThrow("NotFoundError");
    // DeskMonitor retries start() on the next tick — must not orphan windows.
    await expect(source.start()).rejects.toThrow("NotFoundError");
    expect(fake.FakeBrowserWindow.created).toHaveLength(2);
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
