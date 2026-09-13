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
import {
  createFocusPlan,
  silentPlanPush,
  withPlan,
  withPlanForecast,
  type FocusPlan,
} from "../focusplan/index.ts";
import { createProcessKiller } from "../kill/index.ts";
import { createPlugController, SettingsPlugStore, type PlugController } from "../plugs/index.ts";
import { createAppStore } from "../store/appStore.ts";
import { createPlatformForegroundReader, FocusWindowMonitor } from "../window/index.ts";
import { SessionController, type SessionControllerOptions } from "./controller.ts";
import type { SessionPush } from "./push.ts";
import type { PlanPush } from "../../shared/plan/types.ts";

export interface SessionRuntimeOptions {
  userDataDir: string;
  push: SessionPush;
  /** Forecast fan-out (FORECAST_SNAPSHOT / FORECAST_EVENT). Defaults silent. */
  forecastPush?: ForecastPush;
  /** Focus Plan fan-out (PLAN_ROUND, on round close). Defaults silent. */
  planPush?: PlanPush;
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
  plan: FocusPlan;
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
  /**
   * Focus Plan is a push observer and a JSON file. It is constructed here so
   * it can be tapped onto both fan-outs, and it reaches the controller through
   * NOTHING: `SessionControllerOptions` gains no plan-shaped key, and
   * `adaptiveFuse.ts` is untouched, so the coaching layer has no seam into the
   * fuse authority by construction rather than by discipline.
   */
  const plan = createFocusPlan({
    loadSettings: () => store.loadSettings(),
    appendLog: (detail) => {
      const event: SessionEvent = { ts: now(), kind: "plan", detail };
      try {
        store.appendSessionLog(event);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Failed to persist plan log:", message);
      }
      options.push.sessionEvent({ ...event });
    },
    push: options.planPush ?? silentPlanPush(),
    store,
    now,
  });
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
    push: withPlanForecast(options.forecastPush ?? silentForecastPush(), plan.forecastTap),
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
    // base push -> plan tap -> forecast tap. Both wrappers forward to the
    // base FIRST, so the enforcement stream is unchanged in content and in
    // order whether or not either observer is attached.
    push: withForecast(withPlan(options.push, plan.sessionTap), forecast.monitor),
    policyFactory: () => new PolicyEngine(),
    now: options.now,
    tickIntervalMs: options.tickIntervalMs,
    forecast: forecast.hook,
    revealWindow: options.revealWindow,
  };
  return { session: new SessionController(controllerOptions), forecast, plan };
}

export function createSessionRuntime(options: SessionRuntimeOptions): SessionController {
  return buildSessionRuntime(options).session;
}

export interface FocusPlugRuntime {
  session: SessionController;
  plugs: PlugController;
  forecast: Forecast;
  plan: FocusPlan;
}

/** Production set: one store, one PlugController, one Forecast, one Focus Plan. */
export function createFocusPlugRuntime(options: SessionRuntimeOptions): FocusPlugRuntime {
  const store = options.store ?? createAppStore(options.userDataDir);
  const plugs = options.plugs ?? createStoreBackedPlugs(store, options.now);
  const built = buildSessionRuntime({ ...options, store, plugs });
  return {
    session: built.session,
    plugs,
    forecast: built.forecast,
    plan: built.plan,
  };
}
