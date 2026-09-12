import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeDataUrl, decodeImageBuffer } from "./frame";
import type { FrameSource, RgbFrame } from "./types";

const CAMERA_HTML = `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>FocusPlug desk camera</title>
  </head>
  <body>
    <video id="v" autoplay muted playsinline></video>
    <canvas id="c"></canvas>
    <script>
      const video = document.getElementById("v");
      const canvas = document.getElementById("c");
      const ctx = canvas.getContext("2d");
      let stream = null;
      window.focusplugStartCam = async (deviceId) => {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
        const size = { width: { ideal: 640 }, height: { ideal: 480 } };
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: deviceId ? { ...size, deviceId: { exact: deviceId } } : { ...size, facingMode: "user" },
        });
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        return track ? track.label : "";
      };
      window.focusplugListCams = async () =>
        (await navigator.mediaDevices.enumerateDevices())
          .filter((device) => device.kind === "videoinput")
          .map((device) => ({ deviceId: device.deviceId, label: device.label }));
      window.focusplugGrabFrame = () => {
        if (!video || video.readyState < 2 || video.videoWidth < 2) return null;
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0);
        return canvas.toDataURL("image/jpeg", 0.8);
      };
      window.focusplugStopCam = () => {
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
          stream = null;
        }
        video.srcObject = null;
      };
    </script>
  </body>
</html>`;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface CameraInput {
  deviceId: string;
  label: string;
}

/**
 * Virtual cameras stream a placeholder when nothing feeds them — DroidCam with
 * no phone connected is a black frame — and presence then reads `uncertain`
 * forever. They often enumerate before the built-in webcam.
 */
const VIRTUAL_CAMERA =
  /droidcam|\bobs\b|virtual|manycam|xsplit|snap camera|nvidia broadcast|mmhmm|camo|epoccam|iriun/i;

/**
 * Which camera to reopen on, or null to keep the one already open.
 * `preferred` (FOCUSPLUG_CAMERA) is a label substring and always wins; otherwise
 * a virtual default is swapped for the first real camera, if there is one.
 */
export function pickCameraDeviceId(
  inputs: readonly CameraInput[],
  openedLabel: string,
  preferred?: string,
): string | null {
  const wanted = preferred?.trim().toLowerCase();
  if (wanted) {
    const match = inputs.find((input) => input.label.toLowerCase().includes(wanted));
    return match && match.label !== openedLabel ? match.deviceId : null;
  }
  if (!VIRTUAL_CAMERA.test(openedLabel)) {
    return null;
  }
  const real = inputs.find((input) => input.label.length > 0 && !VIRTUAL_CAMERA.test(input.label));
  return real ? real.deviceId : null;
}

export class NullFrameSource implements FrameSource {
  async start(): Promise<void> {
    return;
  }
  async stop(): Promise<void> {
    return;
  }
  async grab(): Promise<RgbFrame | null> {
    return null;
  }
}

export class ScriptedFrameSource implements FrameSource {
  private index = 0;

  constructor(private readonly frames: Array<RgbFrame | null>) {}

  async start(): Promise<void> {
    this.index = 0;
  }

  async stop(): Promise<void> {
    return;
  }

  async grab(): Promise<RgbFrame | null> {
    if (this.frames.length === 0) {
      return null;
    }
    const frame = this.frames[Math.min(this.index, this.frames.length - 1)] ?? null;
    this.index += 1;
    return frame;
  }
}

class ElectronCameraSource implements FrameSource {
  private window: Electron.BrowserWindow | null = null;
  private pageDir: string | null = null;
  private started = false;

  /**
   * getUserMedia only exists in a secure context. A `data:` URL is an opaque
   * origin (`window.origin === "null"`, `isSecureContext === false`), where
   * `navigator.mediaDevices` is undefined — so the camera never started and
   * Desk AI reported `uncertain` forever. `file://` is potentially trustworthy,
   * so the page gets `mediaDevices` there.
   */
  private writePage(): string {
    const dir = mkdtempSync(join(tmpdir(), "focusplug-cam-"));
    this.pageDir = dir;
    const file = join(dir, "camera.html");
    writeFileSync(file, CAMERA_HTML, "utf8");
    return file;
  }

  private cleanupPage(): void {
    const dir = this.pageDir;
    this.pageDir = null;
    if (dir === null) {
      return;
    }
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    } catch {
      // temp dir, best effort
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }
    const electron = await import("electron");
    const { BrowserWindow, app, session } = electron;
    if (!app.isReady()) {
      throw new Error("Electron app is not ready");
    }
    const camSession = session.fromPartition("persist:focusplug-desk-cam");
    camSession.setPermissionRequestHandler((_wc, permission, callback) => {
      callback(permission === "media");
    });
    const win = new BrowserWindow({
      show: false,
      width: 8,
      height: 8,
      skipTaskbar: true,
      webPreferences: {
        backgroundThrottling: false,
        sandbox: false,
        webSecurity: false,
        session: camSession,
      },
    });
    win.webContents.setBackgroundThrottling(false);
    this.window = win;
    try {
      await win.loadFile(this.writePage());
      await this.openCamera(win);
    } catch (error) {
      // Without this the caller retries and every attempt leaks a hidden
      // window and its renderer process.
      await this.stop();
      throw error;
    }
    this.started = true;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      const probe = await this.grab();
      if (probe) {
        return;
      }
      await delay(200);
    }
  }

  /**
   * Open the default camera, then switch if it is a virtual one. Camera labels
   * are only exposed once a stream has been granted, so this cannot be decided
   * before the first open.
   */
  private async openCamera(win: Electron.BrowserWindow): Promise<void> {
    let label = (await win.webContents.executeJavaScript(
      "window.focusplugStartCam(null)",
    )) as string;
    const inputs = (await win.webContents.executeJavaScript(
      "window.focusplugListCams()",
    )) as CameraInput[];
    const pick = pickCameraDeviceId(inputs, label, process.env["FOCUSPLUG_CAMERA"]);
    if (pick !== null) {
      label = (await win.webContents.executeJavaScript(
        `window.focusplugStartCam(${JSON.stringify(pick)})`,
      )) as string;
    }
    console.info(`Desk camera: ${label || "unnamed device"}`);
  }

  async stop(): Promise<void> {
    this.started = false;
    const win = this.window;
    this.window = null;
    if (!win || win.isDestroyed()) {
      this.cleanupPage();
      return;
    }
    try {
      await win.webContents.executeJavaScript("window.focusplugStopCam()");
    } catch {
      // ignore
    }
    win.destroy();
    this.cleanupPage();
  }

  async grab(): Promise<RgbFrame | null> {
    const win = this.window;
    if (!win || win.isDestroyed()) {
      return null;
    }
    const dataUrl = (await win.webContents.executeJavaScript(
      "window.focusplugGrabFrame()",
    )) as string | null;
    if (!dataUrl) {
      return null;
    }
    return decodeDataUrl(dataUrl);
  }
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("ffmpeg timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve(Buffer.concat(chunks));
      } else {
        reject(new Error(`ffmpeg exited ${code ?? -1}`));
      }
    });
  });
}

class FfmpegCameraSource implements FrameSource {
  private args: string[] | null = null;

  async start(): Promise<void> {
    this.args = await resolveFfmpegInput();
  }

  async stop(): Promise<void> {
    this.args = null;
  }

  async grab(): Promise<RgbFrame | null> {
    if (!this.args) {
      return null;
    }
    try {
      const jpeg = await runFfmpeg(
        ["-hide_banner", "-loglevel", "error", ...this.args, "-frames:v", "1", "-q:v", "5", "-f", "image2", "pipe:1"],
        4000,
      );
      if (jpeg.length < 32) {
        return null;
      }
      return decodeImageBuffer(new Uint8Array(jpeg));
    } catch {
      return null;
    }
  }
}

async function resolveFfmpegInput(): Promise<string[] | null> {
  if (process.platform === "linux" && existsSync("/dev/video0")) {
    return ["-f", "v4l2", "-i", "/dev/video0"];
  }
  if (process.platform === "darwin") {
    return ["-f", "avfoundation", "-framerate", "30", "-i", "0"];
  }
  if (process.platform === "win32") {
    return ["-f", "dshow", "-i", "video=Integrated Camera"];
  }
  return null;
}

export async function createDefaultFrameSource(): Promise<FrameSource> {
  if (process.versions.electron) {
    try {
      const electron = await import("electron");
      if (electron.app.isReady()) {
        return new ElectronCameraSource();
      }
    } catch {
      // fall through to ffmpeg
    }
  }
  const ffmpegArgs = await resolveFfmpegInput();
  if (ffmpegArgs) {
    return new FfmpegCameraSource();
  }
  return new NullFrameSource();
}
