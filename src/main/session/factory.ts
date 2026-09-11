import { PolicyEngine } from "../../shared/policy/index.ts";
import type { DeskMonitor, ProcessKiller, WindowMonitor } from "../../shared/ipc.ts";
import type { ProcessHost } from "../kill/types.ts";
import { createProcessKiller } from "../kill/index.ts";
import { createFocusPlugStore, createListsStore, type ListsJsonStore } from "../store/index.ts";
import type { FrameSource } from "../desk/types.ts";
import type { ForegroundReader } from "../window/foreground.ts";
import { createWindowMonitor } from "../window/index.ts";
import { IdleDeskMonitor } from "./scripted.ts";
import { SessionRuntime, type SessionPush, type SessionStore } from "./runtime.ts";
import { flattenEnabledMatchers } from "./targets.ts";

export interface CreateSessionRuntimeOptions {
  userDataDir: string;
  store?: SessionStore;
  listsStore?: ListsJsonStore;
  windowMonitor?: WindowMonitor;
  deskMonitor?: DeskMonitor;
  killer?: ProcessKiller;
  processHost?: ProcessHost;
  policy?: PolicyEngine;
  now?: () => number;
  push?: SessionPush;
  tickIntervalMs?: number;
  foregroundReader?: ForegroundReader;
  deskFrameSource?: FrameSource;
  focusIntervalMs?: number;
}

/**
 * Production (and harness) wiring. Injected monitors skip live window/desk modules.
 */
export async function createSessionRuntime(
  options: CreateSessionRuntimeOptions,
): Promise<SessionRuntime> {
  let listsStore = options.listsStore;
  let windowMonitor = options.windowMonitor;

  if (!windowMonitor) {
    const created = createWindowMonitor({
      userDataDir: options.userDataDir,
      reader: options.foregroundReader,
      intervalMs: options.focusIntervalMs,
    });
    windowMonitor = created.monitor;
    listsStore = listsStore ?? created.store;
  }

  listsStore = listsStore ?? createListsStore(options.userDataDir);
  const store = options.store ?? createFocusPlugStore(options.userDataDir, listsStore);

  const killer =
    options.killer ??
    createProcessKiller({
      host: options.processHost,
      getAllowlistMatchers: () => flattenEnabledMatchers(store.loadAllowlist()),
    });

  const settings = store.loadSettings();
  const deskMonitor = options.deskMonitor ?? (await createLiveDeskMonitor(settings.webcamEnabled, options.deskFrameSource));

  return new SessionRuntime({
    store,
    windowMonitor,
    deskMonitor,
    killer,
    policy: options.policy ?? new PolicyEngine(),
    now: options.now,
    push: options.push,
    tickIntervalMs: options.tickIntervalMs,
  });
}

async function createLiveDeskMonitor(
  enabled: boolean,
  source: FrameSource | undefined,
): Promise<DeskMonitor> {
  try {
    const desk = await import("../desk/index.ts");
    return desk.createDeskMonitor({
      enabled,
      source,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Desk monitor unavailable; using idle fallback:", message);
    return new IdleDeskMonitor();
  }
}
