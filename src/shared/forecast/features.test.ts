import { describe, expect, it } from "vitest";
import type { Decision, DeskSnapshot } from "../types";
import { DESK_NEUTRAL, extractFeatures, logCompress } from "./features";
import { TelemetryRing } from "./ring";
import { FORECAST_FEATURE_KEYS, type ForecastFeatureKey } from "./types";
import goldenJson from "./fixtures/golden.json";

const T0 = 1_700_000_000_000;
const SEC = 1000;

interface FixtureTick {
  repeat?: number;
  focus?: Array<[string, string, boolean, boolean]>;
  desk?: [DeskSnapshot["label"], number, boolean];
  decision?: Decision;
}

interface FeatureScenario {
  name: string;
  sessionStartTs: number;
  deskThreshold: number;
  extractTs: number;
  ticks: FixtureTick[];
  expected: { raw: Record<ForecastFeatureKey, number>; values: number[] };
}

const golden = goldenJson as unknown as {
  features: { tolerance: number; scenarios: FeatureScenario[] };
};

/** Replays a golden feed: per second — focus snapshots, desk, status, commit. */
function replay(scenario: FeatureScenario): TelemetryRing {
  const ring = new TelemetryRing();
  ring.reset(scenario.sessionStartTs);
  let second = 1;
  for (const tick of scenario.ticks) {
    const repeat = tick.repeat ?? 1;
    for (let r = 0; r < repeat; r += 1) {
      const ts = scenario.sessionStartTs + second * SEC;
      for (const [processName, windowTitle, matchedAllow, matchedBlock] of tick.focus ?? []) {
        ring.noteFocus({ ts, processName, windowTitle, matchedAllow, matchedBlock });
      }
      if (tick.desk !== undefined) {
        const [label, confidence, webcamEnabled] = tick.desk;
        ring.noteDesk({ ts, label, confidence, webcamEnabled }, scenario.deskThreshold);
      }
      if (tick.decision !== undefined) {
        ring.noteStatus(tick.decision);
      }
      ring.commit(ts);
      second += 1;
    }
  }
  return ring;
}

function expectAllInUnit(values: number[]): void {
  expect(values).toHaveLength(FORECAST_FEATURE_KEYS.length);
  for (const value of values) {
    expect(Number.isFinite(value)).toBe(true);
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(1);
  }
}

describe("extractFeatures golden fixtures", () => {
  for (const scenario of golden.features.scenarios) {
    it(`matches hand-derived raw + encoded values: ${scenario.name}`, () => {
      const ring = replay(scenario);
      const { raw, values } = extractFeatures(ring, scenario.extractTs);
      const tolerance = golden.features.tolerance;
      FORECAST_FEATURE_KEYS.forEach((key, i) => {
        const gotRaw = raw[key];
        const wantRaw = scenario.expected.raw[key];
        expect(
          Math.abs(gotRaw - wantRaw),
          `${scenario.name}.raw.${key}: got ${gotRaw}, want ${wantRaw}`,
        ).toBeLessThanOrEqual(tolerance);
        const gotValue = values[i] ?? Number.NaN;
        const wantValue = scenario.expected.values[i] ?? Number.NaN;
        expect(
          Math.abs(gotValue - wantValue),
          `${scenario.name}.values[${i}] (${key}): got ${gotValue}, want ${wantValue}`,
        ).toBeLessThanOrEqual(tolerance);
      });
      expectAllInUnit(values);
    });
  }
});

describe("extractFeatures neutrals and bounds", () => {
  it("an empty ring (session just started) encodes to defined neutrals, never NaN", () => {
    const ring = new TelemetryRing();
    ring.reset(T0);
    const { raw, values } = extractFeatures(ring, T0);
    expectAllInUnit(values);
    // Desk neutrals with zero webcam frames in window.
    expect(raw.deskPresent30).toBe(DESK_NEUTRAL);
    expect(raw.deskConfMean30).toBe(DESK_NEUTRAL);
    expect(raw.deskConfStd30).toBe(0);
    expect(raw.deskFlicker60).toBe(0);
    // Quiet switch ratio is exactly 1 (ε/ε), encoded 0.25.
    expect(raw.switchAccel).toBe(1);
    expect(values[2]).toBe(0.25);
    // Block never seen reads as 600 s ago, encoded 0.
    expect(raw.sinceBlock).toBe(600);
    expect(values[8]).toBe(0);
  });

  it("extreme switching clamps every related encoding to 1", () => {
    const ring = new TelemetryRing();
    ring.reset(T0);
    for (let i = 0; i < 60; i += 1) {
      ring.noteFocus({
        ts: T0 + 1000 + i * 100,
        processName: `proc-${i % 12}.exe`,
        windowTitle: `t${i}`,
        matchedAllow: false,
        matchedBlock: false,
      });
    }
    ring.commit(T0 + 7 * SEC);
    const { values } = extractFeatures(ring, T0 + 7 * SEC);
    expectAllInUnit(values);
    expect(values[0]).toBe(1); // switch15
    expect(values[1]).toBe(1); // switch60
    expect(values[7]).toBe(1); // distinct60 (12 distinct > cap 8)
  });

  it("non-finite desk confidences are neutralized upstream — encodings stay in [0,1]", () => {
    const ring = new TelemetryRing();
    ring.reset(T0);
    for (let i = 1; i <= 10; i += 1) {
      ring.noteDesk(
        {
          ts: T0 + i * SEC,
          label: "at_desk",
          confidence: i % 2 === 0 ? Number.NaN : Number.POSITIVE_INFINITY,
          webcamEnabled: true,
        },
        0.6,
      );
      ring.commit(T0 + i * SEC);
    }
    const { raw, values } = extractFeatures(ring, T0 + 10 * SEC);
    expectAllInUnit(values);
    expect(Number.isFinite(raw.deskConfMean30)).toBe(true);
    expect(Number.isFinite(raw.deskConfStd30)).toBe(true);
  });

  it("webcam flipping off mid-window: desk stats use webcam-on frames only", () => {
    const ring = new TelemetryRing();
    ring.reset(T0);
    for (let i = 1; i <= 10; i += 1) {
      ring.noteDesk({ ts: T0 + i * SEC, label: "at_desk", confidence: 0.8, webcamEnabled: true }, 0.6);
      ring.commit(T0 + i * SEC);
    }
    for (let i = 11; i <= 20; i += 1) {
      ring.noteDesk({ ts: T0 + i * SEC, label: "uncertain", confidence: 0, webcamEnabled: false }, 0.6);
      ring.commit(T0 + i * SEC);
    }
    const { raw } = extractFeatures(ring, T0 + 20 * SEC);
    expect(raw.deskPresent30).toBe(1);
    expect(Math.abs(raw.deskConfMean30 - 0.8)).toBeLessThanOrEqual(1e-9);
    // webcam-off frames never count as presence flicker.
    expect(raw.deskFlicker60).toBe(0);
  });

  it("logCompress is clamped and NaN-proof", () => {
    expect(logCompress(0, 600)).toBe(0);
    expect(logCompress(-5, 600)).toBe(0);
    expect(logCompress(Number.NaN, 600)).toBe(0);
    expect(logCompress(600, 600)).toBe(1);
    expect(logCompress(10_000, 600)).toBe(1);
    expect(logCompress(60, 600)).toBeCloseTo(Math.log1p(60) / Math.log1p(600), 12);
  });
});

describe("extractFeatures fuzz — no NaN, all encodings in [0,1]", () => {
  // Deterministic PRNG so a failure reproduces (house seeded-clock style).
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("survives 200 random sessions with hostile inputs", () => {
    const rand = mulberry32(0xf0cca);
    const decisions: Decision[] = ["ON_TASK", "DISTRACTED", "AWAY", "IDLE"];
    const labels: Array<DeskSnapshot["label"]> = ["at_desk", "away", "uncertain"];
    for (let run = 0; run < 200; run += 1) {
      const ring = new TelemetryRing();
      ring.reset(T0);
      let ts = T0;
      const seconds = 5 + Math.floor(rand() * 120);
      for (let i = 0; i < seconds; i += 1) {
        ts += 1000 + Math.floor(rand() * 3) * 500; // uneven clock
        const focusBursts = Math.floor(rand() * 4);
        for (let f = 0; f < focusBursts; f += 1) {
          ring.noteFocus({
            ts: ts - 900 + f * 300,
            processName: rand() < 0.1 ? "" : `p${Math.floor(rand() * 9)}.exe`,
            windowTitle: `w${Math.floor(rand() * 30)}`,
            matchedAllow: rand() < 0.4,
            matchedBlock: rand() < 0.15,
          });
        }
        if (rand() < 0.8) {
          const conf =
            rand() < 0.05
              ? Number.NaN
              : rand() < 0.05
                ? Number.POSITIVE_INFINITY
                : rand() * 1.5 - 0.2; // sometimes out of [0,1]
          ring.noteDesk(
            {
              ts,
              label: labels[Math.floor(rand() * labels.length)] ?? "uncertain",
              confidence: conf,
              webcamEnabled: rand() < 0.7,
            },
            0.6,
          );
        }
        if (rand() < 0.5) {
          ring.noteStatus(decisions[Math.floor(rand() * decisions.length)] ?? "IDLE");
        }
        ring.commit(ts);
      }
      const { raw, values } = extractFeatures(ring, ts + Math.floor(rand() * 5000));
      for (const key of FORECAST_FEATURE_KEYS) {
        expect(Number.isFinite(raw[key]), `raw.${key} finite (run ${run})`).toBe(true);
      }
      values.forEach((value, i) => {
        expect(Number.isFinite(value), `values[${i}] finite (run ${run})`).toBe(true);
        expect(value, `values[${i}] >= 0 (run ${run})`).toBeGreaterThanOrEqual(0);
        expect(value, `values[${i}] <= 1 (run ${run})`).toBeLessThanOrEqual(1);
      });
    }
  });
});
