import type { WindowMonitor } from "../../shared/ipc.ts";
import type { AppEntry, FocusSnapshot } from "../../shared/types.ts";
import type { ForegroundReader } from "./foreground.ts";
import { buildFocusSnapshot } from "./snapshot.ts";

export const DEFAULT_POLL_INTERVAL_MS = 250;

export interface FocusWindowMonitorOptions {
  reader: ForegroundReader;
  loadAllowlist: () => AppEntry[] | Promise<AppEntry[]>;
  loadBlocklist: () => AppEntry[] | Promise<AppEntry[]>;
  intervalMs?: number;
}

export class FocusWindowMonitor implements WindowMonitor {
  private readonly reader: ForegroundReader;
  private readonly loadAllowlist: () => AppEntry[] | Promise<AppEntry[]>;
  private readonly loadBlocklist: () => AppEntry[] | Promise<AppEntry[]>;
  private readonly intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cb: ((snap: FocusSnapshot) => void) | null = null;
  private running = false;
  private ticking = false;
  lastSnapshot: FocusSnapshot | null = null;

  constructor(options: FocusWindowMonitorOptions) {
    this.reader = options.reader;
    this.loadAllowlist = options.loadAllowlist;
    this.loadBlocklist = options.loadBlocklist;
    this.intervalMs = options.intervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  }

  start(cb: (snap: FocusSnapshot) => void): void {
    this.stop();
    this.cb = cb;
    this.running = true;
    this.reader.start?.();
    void this.tick();
    this.timer = setInterval(() => {
      void this.tick();
    }, this.intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.cb = null;
    this.ticking = false;
    this.reader.stop?.();
  }

  private async tick(): Promise<void> {
    if (!this.running || this.ticking) {
      return;
    }
    this.ticking = true;
    try {
      const [fg, allowlist, blocklist] = await Promise.all([
        this.reader.read(),
        this.loadAllowlist(),
        this.loadBlocklist(),
      ]);
      if (!this.running) {
        return;
      }
      const snapshot = buildFocusSnapshot({
        processName: fg?.processName ?? "",
        windowTitle: fg?.windowTitle ?? "",
        allowlist,
        blocklist,
      });
      this.lastSnapshot = snapshot;
      this.cb?.(snapshot);
    } finally {
      this.ticking = false;
    }
  }
}
