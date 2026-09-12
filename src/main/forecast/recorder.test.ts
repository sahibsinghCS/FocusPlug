import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { processHash, titleHash } from "../../shared/forecast/index.ts";
import { DEFAULT_SESSION_STATE, DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import { presentDesk } from "../session/harness.ts";
import { switchProbeWeights } from "./fixtures.ts";
import { createForecast } from "./index.ts";
import {
  FORECAST_RECORD_ENV,
  ForecastRecorder,
  createForecastRecorder,
  type ForecastFrameRow,
} from "./recorder.ts";

const T0 = 1_000_000;

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "focusplug-forecast-rec-"));
}

function sampleRow(overrides?: Partial<ForecastFrameRow>): ForecastFrameRow {
  return {
    v: 1,
    session_id: "rec-1000000",
    source: "recorded",
    archetype: "unknown",
    t: 42,
    features: new Array<number>(18).fill(0),
    raw: {
      switch15: 0,
      switch60: 0,
      switchAccel: 1,
      dwellCur: 0,
      fracAllow60: 0,
      fracOther60: 0,
      otherDwell30: 0,
      distinct60: 0,
      sinceBlock: 600,
      streak: 0,
      deskPresent30: 0.5,
      deskConfMean30: 0.5,
      deskConfStd30: 0,
      deskFlicker60: 0,
      sessionMin: 0,
      priorDrifts: 0,
      titleChurn30: 0,
      titleChurn60: 0,
    },
    label: null,
    secs_to_drift: null,
    drift_type: null,
    procHash: processHash("chrome.exe"),
    titleHash: titleHash("Essay — Google Docs"),
    focusKind: "allow",
    deskPresence: "present",
    deskConfidence: 0.94,
    webcamEnabled: true,
    decision: "ON_TASK",
    countdownActive: false,
    ...overrides,
  };
}

describe("createForecastRecorder", () => {
  it("is strictly opt-in behind FOCUSPLUG_FORECAST_RECORD=1", () => {
    const dir = tempDir();
    expect(createForecastRecorder({ dir, env: {} })).toBe(null);
    expect(createForecastRecorder({ dir, env: { [FORECAST_RECORD_ENV]: "0" } })).toBe(null);
    expect(createForecastRecorder({ dir, env: { [FORECAST_RECORD_ENV]: "true" } })).toBe(null);
    expect(
      createForecastRecorder({ dir, env: { [FORECAST_RECORD_ENV]: "1" } }),
    ).toBeInstanceOf(ForecastRecorder);
  });
});

describe("ForecastRecorder", () => {
  it("appends one JSONL line per frame to <dir>/<sessionId>.jsonl", () => {
    const dir = tempDir();
    const recorder = new ForecastRecorder(dir);
    recorder.record(sampleRow({ t: 1 }));
    recorder.record(sampleRow({ t: 2 }));

    const lines = readFileSync(join(dir, "rec-1000000.jsonl"), "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    const first = JSON.parse(lines[0] ?? "") as ForecastFrameRow;
    expect(first.v).toBe(1);
    expect(first.t).toBe(1);
    expect(first.source).toBe("recorded");
    expect(first.label).toBe(null);
    expect(first.secs_to_drift).toBe(null);
    expect(first.drift_type).toBe(null);
    expect(first.features.length).toBe(18);
  });

  it("a write failure disables the recorder, never throws", () => {
    const dir = tempDir();
    writeFileSync(join(dir, "not-a-dir"), "occupied", "utf8");
    const recorder = new ForecastRecorder(join(dir, "not-a-dir", "nested"));
    expect(() => recorder.record(sampleRow())).not.toThrow();
    expect(() => recorder.record(sampleRow())).not.toThrow();
  });

  it("hash-only identities: no window title or process name ever hits disk", () => {
    const dir = tempDir();
    const recorder = new ForecastRecorder(dir);
    const settings = { ...DEFAULT_SETTINGS, forecastEnabled: true };
    const forecast = createForecast({
      loadSettings: () => ({ ...settings, plugs: [] }),
      appendLog: () => undefined,
      push: { snapshot: () => undefined, event: () => undefined },
      weights: switchProbeWeights(),
      recorder,
    });
    const monitor = forecast.monitor;
    monitor.onSessionState({ ...DEFAULT_SESSION_STATE, sessionActive: true });
    monitor.beforeStep(T0, 10);
    monitor.onFocus({
      ts: T0,
      processName: "discord.exe",
      windowTitle: "SECRET plans — #general — Discord",
      matchedAllow: false,
      matchedBlock: true,
      blockEntryId: "discord",
    });
    monitor.onDesk(presentDesk(T0));
    monitor.onPolicyEvent({ type: "status", decision: "DISTRACTED", detail: "test" });
    for (let i = 1; i <= 3; i += 1) {
      monitor.beforeStep(T0 + i * 1000, 10);
    }

    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    const content = readFileSync(join(dir, files[0] ?? ""), "utf8");
    const rows = content
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as ForecastFrameRow);
    expect(rows.length).toBe(3);

    // Identity survives only as FNV-1a hashes...
    expect(rows[0]?.procHash).toBe(processHash("discord.exe"));
    expect(rows[0]?.titleHash).toBe(titleHash("SECRET plans — #general — Discord"));
    expect(rows[0]?.focusKind).toBe("block");
    expect(rows[0]?.decision).toBe("DISTRACTED");

    // ...never as strings, in any casing, anywhere in the file.
    expect(/discord/i.test(content)).toBe(false);
    expect(/secret/i.test(content)).toBe(false);
    expect(/general/i.test(content)).toBe(false);
    expect(/windowTitle/.test(content)).toBe(false);
    expect(/processName/.test(content)).toBe(false);
    expect(/processKey/.test(content)).toBe(false);
  });
});
