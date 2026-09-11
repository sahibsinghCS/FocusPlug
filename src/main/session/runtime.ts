import { PolicyEngine } from "../../shared/policy/index.ts";
import { createDeskMonitor } from "../desk/index.ts";
import { createProcessKiller } from "../kill/index.ts";
import { createAppStore } from "../store/appStore.ts";
import { createPlatformForegroundReader, FocusWindowMonitor } from "../window/index.ts";
import { SessionController, type SessionControllerOptions } from "./controller.ts";
import type { SessionPush } from "./push.ts";

export interface SessionRuntimeOptions {
  userDataDir: string;
  push: SessionPush;
  now?: () => number;
  tickIntervalMs?: number;
}

/**
 * Production wiring: shared JSON store, platform window reader, desk AI,
 * blocklist killer. Tests should construct SessionController with mocks instead.
 */
export function createSessionRuntime(options: SessionRuntimeOptions): SessionController {
  const store = createAppStore(options.userDataDir);
  const settings = store.loadSettings();
  const windowMonitor = new FocusWindowMonitor({
    reader: createPlatformForegroundReader(),
    loadAllowlist: () => store.loadAllowlist(),
    loadBlocklist: () => store.loadBlocklist(),
  });
  const deskMonitor = createDeskMonitor({ enabled: settings.webcamEnabled });
  const killer = createProcessKiller({
    getAllowlistMatchers: () =>
      store.loadAllowlist().flatMap((entry) => (entry.enabled ? entry.match : [])),
  });
  const controllerOptions: SessionControllerOptions = {
    windowMonitor,
    deskMonitor,
    killer,
    store,
    push: options.push,
    policyFactory: () => new PolicyEngine(),
    now: options.now,
    tickIntervalMs: options.tickIntervalMs,
  };
  return new SessionController(controllerOptions);
}
