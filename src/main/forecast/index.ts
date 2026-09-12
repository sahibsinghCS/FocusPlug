import type { AppSettings } from "../../shared/ipc.ts";
import type { ForecastHook, ForecastPush, ForecastSnapshot } from "../../shared/forecast/index.ts";
import { ForecastMonitor } from "./monitor.ts";
import type { ForecastFrameSink } from "./recorder.ts";

export { FORCED_INFER_MIN_GAP_MS, ForecastMonitor } from "./monitor.ts";
export type { ForecastMonitorOptions } from "./monitor.ts";
export { withForecast } from "./tap.ts";
export type { ForecastTap } from "./tap.ts";
export { FORECAST_RECORD_ENV, ForecastRecorder, createForecastRecorder } from "./recorder.ts";
export type { ForecastFrameRow, ForecastFrameSink, ForecastRecorderOptions } from "./recorder.ts";

export interface CreateForecastOptions {
  loadSettings(): AppSettings;
  /** Writes a SessionEvent{kind:"forecast"} — the runtime wires store + push. */
  appendLog(detail: string): void;
  push: ForecastPush;
  /** Untrusted weights payload; defaults to the committed weights.json. */
  weights?: unknown;
  /** Env-gated JSONL recorder; null/omitted disables recording. */
  recorder?: ForecastFrameSink | null;
}

export interface Forecast {
  monitor: ForecastMonitor;
  /** The advisory seam for SessionControllerOptions.forecast. */
  hook: ForecastHook;
  /** FORECAST_GET_STATE — latest snapshot, null between sessions. */
  getSnapshot(): ForecastSnapshot | null;
}

export function createForecast(options: CreateForecastOptions): Forecast {
  const monitor = new ForecastMonitor(options);
  return {
    monitor,
    hook: monitor.hook,
    getSnapshot: () => monitor.getSnapshot(),
  };
}

/** No-op fan-out for tests and headless wiring (mirrors session silentPush). */
export function silentForecastPush(): ForecastPush {
  return {
    snapshot: () => undefined,
    event: () => undefined,
  };
}
