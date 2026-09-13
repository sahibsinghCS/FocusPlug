import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { DeskPresence, FocusKind } from "../../shared/policy/index.ts";
import type { Decision } from "../../shared/types.ts";
import type { ForecastFeatureKey } from "../../shared/forecast/index.ts";

/**
 * Dev-only training-data recorder, gated behind `FOCUSPLUG_FORECAST_RECORD=1`.
 * One JSONL line per committed 1 Hz telemetry frame, written to
 * `<userData>/forecast-sessions/<sessionId>.jsonl`.
 *
 * Privacy is structural: process and title identity appear on disk ONLY as
 * FNV-1a hashes (`procHash` / `titleHash`) — hashes preserve the switch /
 * churn / distinctness signals losslessly, the strings do not. No titles, no
 * raw process names, no images; nothing ever leaves disk. Labels are null
 * here — `secs_to_drift` / `drift_type` are derived offline by the dataset
 * builder from the recorded decision stream.
 */

export const FORECAST_RECORD_ENV = "FOCUSPLUG_FORECAST_RECORD";

/** One recorded frame — the dataset schema with labels left for offline fill. */
export interface ForecastFrameRow {
  v: 1;
  session_id: string;
  source: "recorded";
  archetype: "unknown";
  /** Seconds since session start. */
  t: number;
  /** Encoded [0,1] features, FORECAST_FEATURE_KEYS order, pre-normalization. */
  features: number[];
  /** Human-unit values keyed by feature. */
  raw: Record<ForecastFeatureKey, number>;
  label: null;
  secs_to_drift: null;
  drift_type: null;
  /** FNV-1a of the foreground process key — never the raw string. */
  procHash: number;
  /** FNV-1a of the lowercased window title — never the raw string. */
  titleHash: number;
  focusKind: FocusKind;
  deskPresence: DeskPresence;
  deskConfidence: number;
  webcamEnabled: boolean;
  /** Policy's authoritative decision at frame close (offline label source). */
  decision: Decision;
  countdownActive: boolean;
}

/** What the monitor needs from a recorder — structural, test-friendly. */
export interface ForecastFrameSink {
  record(row: ForecastFrameRow): void;
}

export class ForecastRecorder implements ForecastFrameSink {
  private readonly dir: string;
  private prepared = false;
  private broken = false;

  constructor(dir: string) {
    this.dir = dir;
  }

  record(row: ForecastFrameRow): void {
    if (this.broken) {
      return;
    }
    try {
      if (!this.prepared) {
        mkdirSync(this.dir, { recursive: true });
        this.prepared = true;
      }
      appendFileSync(join(this.dir, `${row.session_id}.jsonl`), `${JSON.stringify(row)}\n`, "utf8");
    } catch (error) {
      // Recording is a dev convenience — a full disk or bad path disables the
      // recorder, never the forecast and never the session.
      this.broken = true;
      const message = error instanceof Error ? error.message : String(error);
      console.error("Forecast recorder disabled:", message);
    }
  }
}

export interface ForecastRecorderOptions {
  /** Target directory, e.g. `<userData>/forecast-sessions`. */
  dir: string;
  /** Injectable for tests; defaults to process.env. */
  env?: Record<string, string | undefined>;
}

/** Null unless `FOCUSPLUG_FORECAST_RECORD=1` — recording is strictly opt-in. */
export function createForecastRecorder(options: ForecastRecorderOptions): ForecastRecorder | null {
  const env = options.env ?? process.env;
  if (env[FORECAST_RECORD_ENV] !== "1") {
    return null;
  }
  return new ForecastRecorder(options.dir);
}
