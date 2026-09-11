import type { WindowMonitor } from "../../shared/ipc.ts";
import type { FocusSnapshot } from "../../shared/types.ts";
import { createListsStore, type ListsJsonStore } from "../store/index.ts";
import {
  EmptyForegroundReader,
  type ForegroundReader,
} from "./foreground.ts";
import { FocusWindowMonitor } from "./monitor.ts";
import { Win32ForegroundReader } from "./win32.ts";

export { entryMatches, findMatchingEntry, normalizeMatcher, processBasename } from "./match.ts";
export { buildFocusSnapshot } from "./snapshot.ts";
export {
  EmptyForegroundReader,
  SimulatedForegroundReader,
  type ForegroundReader,
  type ForegroundWindow,
} from "./foreground.ts";
export { parseForegroundPayload, Win32ForegroundReader } from "./win32.ts";
export {
  FocusWindowMonitor,
  DEFAULT_POLL_INTERVAL_MS,
  type FocusWindowMonitorOptions,
} from "./monitor.ts";

export function createPlatformForegroundReader(): ForegroundReader {
  if (process.platform === "win32") {
    return new Win32ForegroundReader();
  }
  return new EmptyForegroundReader();
}

export interface CreateWindowMonitorOptions {
  userDataDir: string;
  intervalMs?: number;
  reader?: ForegroundReader;
}

export interface CreatedWindowMonitor {
  monitor: FocusWindowMonitor;
  store: ListsJsonStore;
}

/**
 * Store-backed {@link WindowMonitor}. Session-wiring should pass Electron
 * `app.getPath("userData")` and `monitor.start(cb)` (this stream does not own main bootstrap).
 */
export function createWindowMonitor(
  options: CreateWindowMonitorOptions,
): CreatedWindowMonitor {
  const store = createListsStore(options.userDataDir);
  const monitor = new FocusWindowMonitor({
    reader: options.reader ?? createPlatformForegroundReader(),
    loadAllowlist: () => store.loadAllowlist(),
    loadBlocklist: () => store.loadBlocklist(),
    intervalMs: options.intervalMs,
  });
  return { monitor, store };
}

export type { WindowMonitor, FocusSnapshot };
