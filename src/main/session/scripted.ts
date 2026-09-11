import type { DeskMonitor, WindowMonitor } from "../../shared/ipc.ts";
import type { DeskSnapshot, FocusSnapshot } from "../../shared/types.ts";

/** Injectable foreground source for the session gauntlet (does not rewrite window/). */
export class ScriptedWindowMonitor implements WindowMonitor {
  private callback: ((snap: FocusSnapshot) => void) | null = null;
  last: FocusSnapshot | null = null;

  start(cb: (snap: FocusSnapshot) => void): void {
    this.callback = cb;
    if (this.last !== null) {
      cb(this.last);
    }
  }

  stop(): void {
    this.callback = null;
  }

  emit(snap: FocusSnapshot): void {
    this.last = snap;
    this.callback?.(snap);
  }
}

/** Injectable desk source for the session gauntlet (does not rewrite desk/). */
export class ScriptedDeskMonitor implements DeskMonitor {
  private callback: ((snap: DeskSnapshot) => void) | null = null;
  last: DeskSnapshot | null = null;
  enabled = true;

  start(cb: (snap: DeskSnapshot) => void): void {
    this.callback = cb;
    if (this.last !== null) {
      cb(this.last);
    }
  }

  stop(): void {
    this.callback = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (this.last === null) {
      return;
    }
    const next: DeskSnapshot = {
      ...this.last,
      webcamEnabled: enabled,
    };
    this.emit(next);
  }

  emit(snap: DeskSnapshot): void {
    const next: DeskSnapshot = {
      ...snap,
      webcamEnabled: this.enabled ? snap.webcamEnabled : false,
    };
    this.last = next;
    this.callback?.(next);
  }
}

/** Fallback when the live desk module cannot be loaded. */
export class IdleDeskMonitor implements DeskMonitor {
  private callback: ((snap: DeskSnapshot) => void) | null = null;
  private enabled = false;

  start(cb: (snap: DeskSnapshot) => void): void {
    this.callback = cb;
    cb(this.snapshot());
  }

  stop(): void {
    this.callback = null;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.callback?.(this.snapshot());
  }

  private snapshot(): DeskSnapshot {
    return {
      ts: Date.now(),
      label: "uncertain",
      confidence: 0,
      webcamEnabled: this.enabled,
    };
  }
}

export class ControllableClock {
  ms: number;

  constructor(startMs = 1_000_000) {
    this.ms = startMs;
  }

  now = (): number => this.ms;

  advance(ms: number): void {
    this.ms += ms;
  }
}
