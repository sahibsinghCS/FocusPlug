import { join } from "node:path";
import type { ForecastPush } from "../../shared/forecast/index.ts";
import { PolicyEngine } from "../../shared/policy/index.ts";
import type { SessionEvent } from "../../shared/types.ts";
import { createDeskMonitor } from "../desk/index.ts";
import {
  createForecast,
  createForecastRecorder,
  silentForecastPush,
  withForecast,
  type Forecast,
} from "../forecast/index.ts";
import { createProcessKiller } from "../kill/index.ts";
import { createPlugController, SettingsPlugStore, type PlugController } from "../plugs/index.ts";
import { createAppStore } from "../store/appStore.ts";
import { createPlatformForegroundReader, FocusWindowMonitor } from "../window/index.ts";
import { SessionController, type SessionControllerOptions } from "./controller.ts";
import type { SessionPush } from "./push.ts";

export interface SessionRuntimeOptions {
  userDataDir: string;
  push: SessionPush;
  /** Forecast fan-out (FORECAST_SNAPSHOT / FORECAST_EVENT). Defaults silent. */
  forecastPush?: ForecastPush;
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

interface BuiltSessionRuntime {
  session: SessionController;
  forecast: Forecast;
}

/**
 * Production wiring: shared JSON store, platform window reader, desk AI,
 * blocklist killer, the frozen PlugController (Kasa/HTTP/mock), and the
 * Focus Forecast observer — its tap wraps the push (SessionPush itself is
 * unchanged) and its hook rides SessionControllerOptions.forecast.
 *
 * The controller owns the other half of the fuse authority: it builds its own
 * AdaptiveFuse over the same store (the learned model lives beside the
 * settings in the user's data dir), and composes the two — personalised base
 * length, scaled by the forecast's pre-arm. See `fuseAuthority.ts`.
 */
function buildSessionRuntime(options: SessionRuntimeOptions): BuiltSessionRuntime {
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
  const now = options.now ?? Date.now;
  const forecast = createForecast({
    loadSettings: () => store.loadSettings(),
    appendLog: (detail) => {
      const event: SessionEvent = { ts: now(), kind: "forecast", detail };
      try {
        store.appendSessionLog(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to persist forecast log:", message);
      }
      options.push.sessionEvent({ ...event });
    },
    push: options.forecastPush ?? silentForecastPush(),
    recorder: createForecastRecorder({
      dir: join(options.userDataDir, "forecast-sessions"),
    }),
  });
  const controllerOptions: SessionControllerOptions = {
    windowMonitor,
    deskMonitor,
    killer,
    plugs,
    store,
    push: withForecast(options.push, forecast.monitor),
    policyFactory: () => new PolicyEngine(),
    now: options.now,
    tickIntervalMs: options.tickIntervalMs,
    forecast: forecast.hook,
    revealWindow: options.revealWindow,
  };
  return { session: new SessionController(controllerOptions), forecast };
}

export function createSessionRuntime(options: SessionRuntimeOptions): SessionController {
  return buildSessionRuntime(options).session;
}

export interface FocusPlugRuntime {
  session: SessionController;
  plugs: PlugController;
  forecast: Forecast;
}

/** Production trio: one store, one PlugController, one Forecast per session. */
export function createFocusPlugRuntime(options: SessionRuntimeOptions): FocusPlugRuntime {
  const store = options.store ?? createAppStore(options.userDataDir);
  const plugs = options.plugs ?? createStoreBackedPlugs(store, options.now);
  const built = buildSessionRuntime({ ...options, store, plugs });
  return {
    session: built.session,
    plugs,
    forecast: built.forecast,
  };
}
