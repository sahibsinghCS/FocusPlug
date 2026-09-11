import type { DeskMonitor as DeskMonitorContract } from "@shared/ipc";
import type { DeskSnapshot } from "@shared/types";
import { analyzeDeskFrame } from "./analyze";
import { createDefaultFrameSource } from "./camera";
import { BlazeFaceDetector, getSharedDetector } from "./detector";
import type { FrameSource } from "./types";

export const DEFAULT_DESK_INTERVAL_MS = 250;

export interface DeskMonitorOptions {
  enabled?: boolean;
  intervalMs?: number;
  source?: FrameSource;
  detector?: BlazeFaceDetector;
  now?: () => number;
}

export class DeskMonitor implements DeskMonitorContract {
  private enabled: boolean;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private source: FrameSource | null;
  private readonly injectedSource: FrameSource | undefined;
  private readonly injectedDetector: BlazeFaceDetector | undefined;
  private detector: BlazeFaceDetector | null = null;
  private callback: ((snap: DeskSnapshot) => void) | null = null;
  private running = false;
  private loopGen = 0;
  private sourceStarted = false;

  constructor(options: DeskMonitorOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.intervalMs = options.intervalMs ?? DEFAULT_DESK_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.injectedSource = options.source;
    this.injectedDetector = options.detector;
    this.source = options.source ?? null;
  }

  start(cb: (snap: DeskSnapshot) => void): void {
    this.callback = cb;
    if (this.running) {
      return;
    }
    this.running = true;
    const gen = ++this.loopGen;
    void this.runLoop(gen);
  }

  stop(): void {
    this.running = false;
    this.loopGen += 1;
    this.callback = null;
    if (this.source && this.sourceStarted) {
      this.sourceStarted = false;
      void this.source.stop();
    }
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) {
      return;
    }
    this.enabled = enabled;
    if (!this.source) {
      return;
    }
    if (enabled && this.running && !this.sourceStarted) {
      void this.source.start().then(() => {
        this.sourceStarted = true;
      });
    }
    if (!enabled && this.sourceStarted) {
      this.sourceStarted = false;
      void this.source.stop();
    }
  }

  /** One capture + classify cycle. Used by the live loop and the gauntlet. */
  async step(): Promise<DeskSnapshot> {
    await this.ensureReady();
    const detector = this.detector;
    if (!detector) {
      throw new Error("Desk detector is not ready");
    }
    let frame = null;
    if (this.enabled && this.source) {
      try {
        frame = await this.source.grab();
      } catch {
        frame = null;
      }
    }
    const analysis = await analyzeDeskFrame({
      frame,
      detector,
      ts: this.now(),
      webcamEnabled: this.enabled,
    });
    this.callback?.(analysis.snapshot);
    return analysis.snapshot;
  }

  private async runLoop(gen: number): Promise<void> {
    await this.ensureReady();
    while (this.running && this.loopGen === gen) {
      await this.step();
      await delay(this.intervalMs);
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.detector) {
      this.detector = this.injectedDetector ?? (await getSharedDetector());
    }
    if (!this.source) {
      this.source = this.injectedSource ?? (await createDefaultFrameSource());
    }
    if (this.enabled && !this.sourceStarted) {
      try {
        await this.source.start();
        this.sourceStarted = true;
      } catch {
        this.sourceStarted = false;
      }
    }
  }
}

export function createDeskMonitor(options: DeskMonitorOptions = {}): DeskMonitor {
  return new DeskMonitor(options);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
