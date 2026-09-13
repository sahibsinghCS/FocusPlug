import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { DeskSnapshot, FocusSnapshot } from "@shared/ipc";
import type { DeskReading } from "./desk/detector";
import { DemoPipeline, type DemoFrame } from "./pipeline";

/**
 * Mode 2 — the optional live run. Same `DemoPipeline`, same shared core, same
 * policy reducer; only the sensor changes. The foreground window is pinned to
 * the assignment (there is no Win32 window monitor in a browser tab) and the
 * DESK signal comes from the judge's own webcam through the shipped BlazeFace
 * graph, so covering the lens or leaving the chair really does flip Decision
 * to AWAY and really does start the policy engine's fuse.
 *
 * Everything degrades quietly: no `getUserMedia` (file://, insecure origin,
 * no camera), a denied permission, or a model that will not initialise all
 * end in a status the panel explains, and Mode 1 is untouched.
 */

export type LiveStatus =
  | "idle"
  | "starting"
  | "running"
  | "denied"
  | "unsupported"
  | "failed";

export interface LiveSession {
  status: LiveStatus;
  message: string | null;
  frames: DemoFrame[];
  reading: DeskReading | null;
  /** Wall-clock seconds since the live session started. */
  elapsedSec: number;
  videoRef: RefObject<HTMLVideoElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  start: () => void;
  stop: () => void;
  /** Demo Kill: advance the injected clock past the rest of a burning fuse. */
  skipFuse: (seconds: number) => void;
}

/** The assignment window, held in focus for the whole live run. */
const LIVE_FOCUS: Omit<FocusSnapshot, "ts"> = {
  processName: "chrome",
  windowTitle: "Unit 4 essay — Google Docs",
  matchedAllow: true,
  matchedBlock: false,
};

const UNKNOWN_DESK: Omit<DeskSnapshot, "ts"> = {
  label: "uncertain",
  confidence: 0,
  webcamEnabled: true,
};

/** Inference cadence — comfortably faster than the 1 Hz frame close. */
const READ_INTERVAL_MS = 420;
const MAX_LIVE_FRAMES = 600;

export function useLiveSession(): LiveSession {
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [frames, setFrames] = useState<DemoFrame[]>([]);
  const [reading, setReading] = useState<DeskReading | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<{ read: DetectorRead; dispose: () => void } | null>(null);
  const pipelineRef = useRef<DemoPipeline | null>(null);
  const readingRef = useRef<DeskReading | null>(null);
  const skewRef = useRef(0);
  const startRef = useRef(0);
  const timersRef = useRef<number[]>([]);
  const busyRef = useRef(false);
  /**
   * Bumped by every teardown. `start()` awaits a permission prompt and a model
   * load, so it captures this and bails if the judge stopped the camera — or
   * left the page — while it was waiting.
   */
  const runRef = useRef(0);

  const teardown = useCallback(() => {
    runRef.current += 1;
    for (const id of timersRef.current) {
      window.clearInterval(id);
    }
    timersRef.current = [];
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    const video = videoRef.current;
    if (video) {
      video.srcObject = null;
    }
    detectorRef.current?.dispose();
    detectorRef.current = null;
    pipelineRef.current = null;
    readingRef.current = null;
    busyRef.current = false;
    skewRef.current = 0;
  }, []);

  useEffect(() => teardown, [teardown]);

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
    setMessage(null);
    setReading(null);
    setFrames([]);
    setElapsedSec(0);
  }, [teardown]);

  const start = useCallback(() => {
    if (status === "starting" || status === "running") {
      return;
    }
    setFrames([]);
    setReading(null);
    setElapsedSec(0);
    setStatus("starting");
    setMessage("Requesting camera…");
    const run = runRef.current;
    const stale = (): boolean => runRef.current !== run;

    void (async () => {
      const media = navigator.mediaDevices;
      if (!media || typeof media.getUserMedia !== "function") {
        setStatus("unsupported");
        setMessage(
          "This browser will not expose a camera here. getUserMedia needs a secure context — serve the demo over http://localhost or https:// (a file:// page cannot ask). The scripted run above is unaffected.",
        );
        return;
      }

      let stream: MediaStream;
      try {
        stream = await media.getUserMedia({
          video: { width: { ideal: 320 }, height: { ideal: 240 } },
          audio: false,
        });
      } catch (error) {
        const name = error instanceof DOMException ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          setStatus("denied");
          setMessage(
            "Camera permission declined — nothing was captured. The scripted run above is the whole demo; this mode only swaps the desk sensor for your webcam.",
          );
          return;
        }
        if (
          name === "NotFoundError" ||
          name === "NotReadableError" ||
          name === "OverconstrainedError"
        ) {
          setStatus("unsupported");
          setMessage(
            `No usable camera on this machine (${name}). The scripted run above is unaffected — it is the whole demo.`,
          );
          return;
        }
        setStatus("failed");
        setMessage(
          `Camera unavailable (${name || "unknown error"}). The scripted run above is unaffected.`,
        );
        return;
      }
      if (stale()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((track) => track.stop());
        setStatus("failed");
        setMessage("Video element was not mounted.");
        return;
      }
      video.srcObject = stream;
      try {
        await video.play();
      } catch {
        // Autoplay can reject while the element is still laying out; the
        // muted+playsinline element recovers on its own.
      }

      setMessage("Loading the bundled BlazeFace graph…");
      let read: DetectorRead;
      let dispose: () => void;
      try {
        const { DemoDeskDetector } = await import("./desk/detector");
        const detector = new DemoDeskDetector();
        await detector.init();
        read = (v, c, ts) => detector.read(v, c, ts);
        dispose = () => detector.dispose();
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        setStatus("failed");
        setMessage(
          `Desk model failed to initialise (${
            error instanceof Error ? error.message : "unknown error"
          }). The scripted run above is unaffected.`,
        );
        return;
      }
      if (stale()) {
        dispose();
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      detectorRef.current = { read, dispose };

      const pipeline = new DemoPipeline();
      const startTs = Date.now();
      pipeline.reset(startTs);
      pipelineRef.current = pipeline;
      startRef.current = startTs;
      skewRef.current = 0;

      const readTimer = window.setInterval(() => {
        void (async () => {
          if (busyRef.current) {
            return;
          }
          const detector = detectorRef.current;
          const canvas = canvasRef.current;
          const element = videoRef.current;
          if (!detector || !canvas || !element) {
            return;
          }
          busyRef.current = true;
          try {
            const next = await detector.read(element, canvas, Date.now() + skewRef.current);
            if (next) {
              readingRef.current = next;
              setReading(next);
            }
          } catch {
            // A dropped frame is not a failure — the next tick retries.
          } finally {
            busyRef.current = false;
          }
        })();
      }, READ_INTERVAL_MS);

      const tickTimer = window.setInterval(() => {
        const active = pipelineRef.current;
        if (!active) {
          return;
        }
        const ts = Date.now() + skewRef.current;
        const desk: DeskSnapshot = readingRef.current
          ? { ...readingRef.current.snapshot, ts }
          : { ...UNKNOWN_DESK, ts };
        const frame = active.step({
          ts,
          focus: [{ ts, ...LIVE_FOCUS }],
          desk,
        });
        setFrames((previous) => [...previous, frame].slice(-MAX_LIVE_FRAMES));
        setElapsedSec(Math.max(0, Math.round((ts - startRef.current) / 1000)));
      }, 1000);

      timersRef.current = [readTimer, tickTimer];
      setStatus("running");
      setMessage(null);
    })();
  }, [status]);

  const skipFuse = useCallback((seconds: number) => {
    skewRef.current += Math.max(0, seconds) * 1000;
  }, []);

  return {
    status,
    message,
    frames,
    reading,
    elapsedSec,
    videoRef,
    canvasRef,
    start,
    stop,
    skipFuse,
  };
}

type DetectorRead = (
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ts: number,
) => Promise<DeskReading | null>;
