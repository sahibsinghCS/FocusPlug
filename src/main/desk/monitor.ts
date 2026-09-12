import type { DeskMonitor as DeskMonitorContract } from "@shared/ipc";
import type { DeskModel, DeskModelId, DeskSnapshot } from "@shared/types";
import { analyzeDeskFrame } from "./analyze";
import { createDefaultFrameSource } from "./camera";
import {
  DEFAULT_DESK_MODEL_ID,
  getSharedDeskModel,
  resolveDeskModelId,
} from "./model/factory";
import type { FrameSource } from "./types";

export const DEFAULT_DESK_INTERVAL_MS = 250;

/** Multiplier on `intervalMs` for retry backoff after model/camera failures. */
const ERROR_BACKOFF_MULTIPLIER = 8;

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : String(error);
}

export interface DeskMonitorOptions {
  enabled?: boolean;
  intervalMs?: number;
  source?: FrameSource;
  model?: DeskModel;
  modelId?: DeskModelId;
  now?: () => number;
}

export class DeskMonitor implements DeskMonitorContract {
  private enabled: boolean;
  private readonly intervalMs: number;
  private readonly now: () => number;
  private source: FrameSource | null;
  private readonly injectedSource: FrameSource | undefined;
  private readonly injectedModel: DeskModel | undefined;
  private modelId: DeskModelId;
  private model: DeskModel | null = null;
  private callback: ((snap: DeskSnapshot) => void) | null = null;
  private running = false;
  private loopGen = 0;
  private sourceStarted = false;
  private sourceRetryAt = 0;
  private sourceStartEpoch = 0;

  constructor(options: DeskMonitorOptions = {}) {
    this.enabled = options.enabled ?? true;
    this.intervalMs = options.intervalMs ?? DEFAULT_DESK_INTERVAL_MS;
    this.now = options.now ?? Date.now;
    this.injectedSource = options.source;
    this.injectedModel = options.model;
    this.modelId = resolveDeskModelId(options.modelId);
    this.source = options.source ?? null;
    this.model = options.model ?? null;
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
    // Enabling never starts the camera here: ensureReady() is the single
    // owner of source.start(), so the loop's next tick (≤ intervalMs away)
    // picks it up instead of racing a second start against the loop's own.
    if (!enabled && this.sourceStarted) {
      this.sourceStarted = false;
      void this.source.stop();
    }
  }

  /** Swap the factory model (ignored when a model instance was injected). */
  setModelId(id: DeskModelId): void {
    const next = resolveDeskModelId(id);
    if (this.modelId === next) {
      return;
    }
    this.modelId = next;
    if (!this.injectedModel) {
      this.model = null;
    }
  }

  /** One capture + classify cycle. Used by the live loop and the gauntlet. */
  async step(): Promise<DeskSnapshot> {
    await this.ensureReady();
    const model = this.model;
    if (!model) {
      throw new Error("Desk model is not ready");
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
      model,
      ts: this.now(),
      webcamEnabled: this.enabled,
    });
    this.callback?.(analysis.snapshot);
    return analysis.snapshot;
  }

  private async runLoop(gen: number): Promise<void> {
    while (this.running && this.loopGen === gen) {
      try {
        await this.step();
      } catch (error) {
        // Model/source init failed: emit a safe uncertain snapshot and retry
        // with backoff instead of letting the loop die on the rejection.
        console.error("Desk monitor step failed:", errorMessage(error));
        this.callback?.({
          ts: this.now(),
          label: "uncertain",
          confidence: 0,
          webcamEnabled: this.enabled,
        });
        await delay(this.intervalMs * ERROR_BACKOFF_MULTIPLIER);
        continue;
      }
      await delay(this.intervalMs);
    }
  }

  private async ensureReady(): Promise<void> {
    if (!this.model) {
      this.model = this.injectedModel ?? (await getSharedDeskModel(this.modelId));
    }
    if (!this.source) {
      this.source = this.injectedSource ?? (await createDefaultFrameSource());
    }
    if (this.enabled && !this.sourceStarted && this.now() >= this.sourceRetryAt) {
      const gen = this.loopGen;
      const epoch = ++this.sourceStartEpoch;
      try {
        await this.source.start();
      } catch (error) {
        console.error("Desk camera start failed:", errorMessage(error));
        this.sourceRetryAt = this.now() + this.intervalMs * ERROR_BACKOFF_MULTIPLIER;
        return;
      }
      // A newer start claimed the shared source while this warm-up was in
      // flight (stop + restart mid-warm-up): its continuation owns the
      // stop/started decision — a stale stop here would kill the new
      // session's camera while sourceStarted stays true, blinding desk AI.
      if (this.sourceStartEpoch !== epoch) {
        return;
      }
      // Stopped or disabled during camera warm-up: shut the camera back down
      // instead of leaving the webcam captured with no loop to stop it.
      if (this.loopGen !== gen || !this.enabled) {
        void this.source.stop();
        return;
      }
      this.sourceStarted = true;
    }
  }
}

export function createDeskMonitor(options: DeskMonitorOptions = {}): DeskMonitor {
  return new DeskMonitor({
    ...options,
    modelId: resolveDeskModelId(options.modelId ?? DEFAULT_DESK_MODEL_ID),
  });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
