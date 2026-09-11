export interface ForegroundWindow {
  processName: string;
  windowTitle: string;
  pid?: number;
}

export interface ForegroundReader {
  read(): ForegroundWindow | null | Promise<ForegroundWindow | null>;
  start?(): void | Promise<void>;
  stop?(): void;
}

/** In-memory reader for tests and the gauntlet probe. */
export class SimulatedForegroundReader implements ForegroundReader {
  private current: ForegroundWindow | null = null;

  constructor(initial?: ForegroundWindow | null) {
    this.current = initial ?? null;
  }

  set(window: ForegroundWindow | null): void {
    this.current = window;
  }

  read(): ForegroundWindow | null {
    return this.current;
  }
}

/** Used on non-Windows hosts: still emits snapshots, with empty focus. */
export class EmptyForegroundReader implements ForegroundReader {
  read(): ForegroundWindow {
    return { processName: "", windowTitle: "" };
  }
}
