import { PolicyEngine } from "../../shared/policy/index.ts";
import { createDeskMonitor } from "../desk/index.ts";
import { createProcessKiller } from "../kill/index.ts";
import { createPlugController, SettingsPlugStore, type PlugController } from "../plugs/index.ts";
import { createAppStore } from "../store/appStore.ts";
import { createPlatformForegroundReader, FocusWindowMonitor } from "../window/index.ts";
import { SessionController, type SessionControllerOptions } from "./controller.ts";
import type { SessionPush } from "./push.ts";

export interface SessionRuntimeOptions {
  userDataDir: string;
  push: SessionPush;
  /** Shared JSON store. Pass the same instance used by PlugController. */
  store?: SessionControllerOptions["store"];
  /** Shared PlugController. Defaults to settings.plugs + Kasa/HTTP/mock hosts. */
  plugs?: PlugController;
  now?: () => number;
  tickIntervalMs?: number;
  /** Brings the app window to the front when the session nudges. */
  revealWindow?: () => void;
}

function createStoreBackedPlugs(
  store: SessionControllerOptions["store"],
  now?: () => number,
): PlugController {
  return createPlugController({
    store: new SettingsPlugStore(store),
    now,
  });
}

/**
 * Production wiring: shared JSON store, platform window reader, desk AI,
 * blocklist killer, and the frozen PlugController (Kasa/HTTP/mock).
 */
export function createSessionRuntime(options: SessionRuntimeOptions): SessionController {
  const store = options.store ?? createAppStore(options.userDataDir);
  const settings = store.loadSettings();
  const windowMonitor = new FocusWindowMonitor({
    reader: createPlatformForegroundReader(),
    loadAllowlist: () => store.loadAllowlist(),
    loadBlocklist: () => store.loadBlocklist(),
  });
  const deskMonitor = createDeskMonitor({
    enabled: settings.webcamEnabled,
    modelId: settings.deskModelId,
  });
  const killer = createProcessKiller({
    getAllowlistMatchers: () =>
      store.loadAllowlist().flatMap((entry) => (entry.enabled ? entry.match : [])),
  });
  const plugs = options.plugs ?? createStoreBackedPlugs(store, options.now);
  const controllerOptions: SessionControllerOptions = {
    windowMonitor,
    deskMonitor,
    killer,
    plugs,
    store,
    push: options.push,
    policyFactory: () => new PolicyEngine(),
    now: options.now,
    tickIntervalMs: options.tickIntervalMs,
    revealWindow: options.revealWindow,
  };
  return new SessionController(controllerOptions);
}

export interface FocusPlugRuntime {
  session: SessionController;
  plugs: PlugController;
}

/** Production pair: one store, one PlugController shared with session. */
export function createFocusPlugRuntime(options: SessionRuntimeOptions): FocusPlugRuntime {
  const store = options.store ?? createAppStore(options.userDataDir);
  const plugs = options.plugs ?? createStoreBackedPlugs(store, options.now);
  return {
    session: createSessionRuntime({ ...options, store, plugs }),
    plugs,
  };
}
