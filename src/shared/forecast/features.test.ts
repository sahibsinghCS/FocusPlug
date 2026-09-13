import { describe, expect, it } from "vitest";
import type { Decision, DeskSnapshot } from "../types";
import {
  DESK_NEUTRAL,
  DESK_TREND_MIN_FRAMES,
  SWITCH_ACCEL_EPS,
  extractFeatures,
  logCompress,
} from "./features";
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

/** Index of a feature in the encoded vector — no magic numbers in assertions. */
function idx(key: ForecastFeatureKey): number {
  return FORECAST_FEATURE_KEYS.indexOf(key);
}

/** Commits `count` 1 Hz frames starting at `T0 + fromSec*1000`, via `each`. */
function commitFrames(
  ring: TelemetryRing,
  fromSec: number,
  count: number,
  each: (ring: TelemetryRing, ts: number, i: number) => void,
): void {
  for (let i = 0; i < count; i += 1) {
    const ts = T0 + (fromSec + i) * SEC;
    each(ring, ts, i);
    ring.commit(ts);
  }
}

describe("the trend block — hand-derived cases", () => {
  it("deskSagSlope30 is the least-squares slope, per minute, one-sided", () => {
    // 30 webcam-on frames, confidence falling exactly 0.01 per second.
    // Regressing on (frame.ts − ts)/1000 gives slope −0.01/s ⇒ 0.6 lost/min,
    // and 0.6 / DESK_SAG_FULL_SCALE_PER_MIN (1.2) encodes to exactly 0.5.
    const sagging = new TelemetryRing();
    sagging.reset(T0);
    commitFrames(sagging, 1, 30, (ring, ts, i) => {
      ring.noteDesk({ ts, label: "at_desk", confidence: 0.9 - 0.01 * i, webcamEnabled: true }, 0.6);
    });
    const sag = extractFeatures(sagging, T0 + 30 * SEC);
    expect(sag.raw.deskSagSlope30).toBeCloseTo(0.6, 9);
    expect(sag.values[idx("deskSagSlope30")]).toBeCloseTo(0.5, 9);

    // A RISING trend is not a sag: the feature is max(0, −slope), so 0.
    const rising = new TelemetryRing();
    rising.reset(T0);
    commitFrames(rising, 1, 30, (ring, ts, i) => {
      ring.noteDesk({ ts, label: "at_desk", confidence: 0.6 + 0.01 * i, webcamEnabled: true }, 0.6);
    });
    expect(extractFeatures(rising, T0 + 30 * SEC).raw.deskSagSlope30).toBe(0);

    // Fewer than DESK_TREND_MIN_FRAMES samples ⇒ no estimate, not a wild one.
    const thin = new TelemetryRing();
    thin.reset(T0);
    commitFrames(thin, 1, DESK_TREND_MIN_FRAMES - 1, (ring, ts, i) => {
      ring.noteDesk({ ts, label: "at_desk", confidence: 0.9 - 0.2 * i, webcamEnabled: true }, 0.6);
    });
    expect(extractFeatures(thin, T0 + (DESK_TREND_MIN_FRAMES - 1) * SEC).raw.deskSagSlope30).toBe(0);
  });

  it("deskSagSlope30 ignores webcam-off frames entirely", () => {
    // A steep "sag" made only of webcam-off frames must read 0 — the camera
    // being off is not evidence that the user is leaving.
    const ring = new TelemetryRing();
    ring.reset(T0);
    commitFrames(ring, 1, 30, (r, ts, i) => {
      r.noteDesk({ ts, label: "uncertain", confidence: 0.9 - 0.03 * i, webcamEnabled: false }, 0.6);
    });
    const { raw, values } = extractFeatures(ring, T0 + 30 * SEC);
    expect(raw.deskSagSlope30).toBe(0);
    expect(raw.deskConfDrop120).toBe(0);
    expect(raw.absenceRun60).toBe(0);
    expectAllInUnit(values);
  });

  it("dwellShrink30v90 reads the 30 s switch rate against the 90 s rate", () => {
    // Six process switches, all inside the last 30 s ⇒ proc30 = proc90 = 6.
    const ring = new TelemetryRing();
    ring.reset(T0);
    commitFrames(ring, 1, 90, (r, ts, i) => {
      // One steady window for 60 s, then a switch every 5 s for the last 30 s.
      const second = i + 1;
      const app = second <= 60 ? "editor.exe" : `app-${Math.floor((second - 61) / 5)}.exe`;
      r.noteFocus({ ts, processName: app, windowTitle: "w", matchedAllow: true, matchedBlock: false });
    });
    const { raw, values } = extractFeatures(ring, T0 + 90 * SEC);
    const expected = (6 / 30 + SWITCH_ACCEL_EPS) / (6 / 90 + SWITCH_ACCEL_EPS);
    expect(raw.dwellShrink30v90).toBeCloseTo(expected, 9);
    expect(raw.dwellShrink30v90).toBeGreaterThan(1); // dwells ARE shrinking
    expect(values[idx("dwellShrink30v90")]).toBeCloseTo(expected / 4, 9);
    expectAllInUnit(values);
  });

  it("dwellShrink30v90 drops below 1 when the churn is OLD, not new", () => {
    // The mirror image: the same six switches, but 60–90 s ago and nothing
    // since. proc30 = 0, proc90 = 6 ⇒ ratio < 1, "dwells are lengthening".
    const ring = new TelemetryRing();
    ring.reset(T0);
    commitFrames(ring, 1, 90, (r, ts, i) => {
      const second = i + 1;
      const app = second <= 30 ? `app-${Math.floor((second - 1) / 5)}.exe` : "editor.exe";
      r.noteFocus({ ts, processName: app, windowTitle: "w", matchedAllow: true, matchedBlock: false });
    });
    const { raw } = extractFeatures(ring, T0 + 90 * SEC);
    expect(raw.dwellShrink30v90).toBeLessThan(1);
  });

  it("titleChurnAccel is the same shape on same-process title flips", () => {
    // Four title flips inside the last 30 s, none in the 30 s before that.
    const ring = new TelemetryRing();
    ring.reset(T0);
    commitFrames(ring, 1, 60, (r, ts, i) => {
      const second = i + 1;
      const title = second <= 30 ? "doc" : `doc-${Math.floor((second - 31) / 8)}`;
      r.noteFocus({
        ts,
        processName: "chrome.exe",
        windowTitle: title,
        matchedAllow: true,
        matchedBlock: false,
      });
    });
    const { raw, values } = extractFeatures(ring, T0 + 60 * SEC);
    expect(raw.titleChurn30).toBe(4);
    expect(raw.titleChurn60).toBe(4);
    const expected = (4 / 30 + SWITCH_ACCEL_EPS) / (4 / 60 + SWITCH_ACCEL_EPS);
    expect(raw.titleChurnAccel).toBeCloseTo(expected, 9);
    expect(values[idx("titleChurnAccel")]).toBeCloseTo(expected / 4, 9);
  });

  it("greyLeaky120 is 1 on an all-grey ring, 0 on an all-allow ring, and recency-weighted between", () => {
    const grey = new TelemetryRing();
    grey.reset(T0);
    commitFrames(grey, 1, 40, (r, ts) => {
      r.noteFocus({ ts, processName: "x.exe", windowTitle: "w", matchedAllow: false, matchedBlock: false });
    });
    expect(extractFeatures(grey, T0 + 40 * SEC).raw.greyLeaky120).toBeCloseTo(1, 12);

    const allow = new TelemetryRing();
    allow.reset(T0);
    commitFrames(allow, 1, 40, (r, ts) => {
      r.noteFocus({ ts, processName: "e.exe", windowTitle: "w", matchedAllow: true, matchedBlock: false });
    });
    expect(extractFeatures(allow, T0 + 40 * SEC).raw.greyLeaky120).toBe(0);

    // Same 60 s of grey, once at the end of a 300 s session and once at its
    // start: the recent one must score higher. This is the whole point of the
    // feature — `fracOther60` cannot tell these two apart at all.
    const build = (greyFrom: number, greyTo: number): number => {
      const ring = new TelemetryRing();
      ring.reset(T0);
      commitFrames(ring, 1, 300, (r, ts, i) => {
        const second = i + 1;
        const isGrey = second > greyFrom && second <= greyTo;
        r.noteFocus({
          ts,
          processName: isGrey ? "x.exe" : "e.exe",
          windowTitle: "w",
          matchedAllow: !isGrey,
          matchedBlock: false,
        });
      });
      return extractFeatures(ring, T0 + 300 * SEC).raw.greyLeaky120;
    };
    const recent = build(240, 300);
    const stale = build(0, 60);
    expect(recent).toBeGreaterThan(stale);
    expect(stale).toBeGreaterThan(0);
  });

  it("absenceRun60 is the LONGEST unbroken absence, not the count of absences", () => {
    // 3 away, 1 present, 5 away ⇒ longest run 5, encoded 5/20 = 0.25.
    const labels: Array<"away" | "at_desk"> = [
      "away", "away", "away", "at_desk", "away", "away", "away", "away", "away",
    ];
    const ring = new TelemetryRing();
    ring.reset(T0);
    commitFrames(ring, 1, labels.length, (r, ts, i) => {
      const label = labels[i] as "away" | "at_desk";
      r.noteDesk(
        { ts, label, confidence: label === "at_desk" ? 0.95 : 0.05, webcamEnabled: true },
        0.6,
      );
    });
    const { raw, values } = extractFeatures(ring, T0 + labels.length * SEC);
    expect(raw.absenceRun60).toBe(5);
    expect(values[idx("absenceRun60")]).toBeCloseTo(0.25, 12);
    // The flicker COUNT sees the same stream as 2 changes — the two features
    // are not redundant, which is why this one is here.
    expect(raw.deskFlicker60).toBe(2);
  });

  it("deskConfDrop120 compares the last 30 s against the preceding 120 s", () => {
    // 120 s at 0.90, then 30 s at 0.60 ⇒ a 0.30 drop, encoded 0.30/0.40 = 0.75.
    const ring = new TelemetryRing();
    ring.reset(T0);
    commitFrames(ring, 1, 150, (r, ts, i) => {
      r.noteDesk(
        { ts, label: "at_desk", confidence: i < 120 ? 0.9 : 0.6, webcamEnabled: true },
        0.6,
      );
    });
    const { raw, values } = extractFeatures(ring, T0 + 150 * SEC);
    expect(raw.deskConfDrop120).toBeCloseTo(0.3, 9);
    expect(values[idx("deskConfDrop120")]).toBeCloseTo(0.75, 9);

    // One-sided: confidence RISING against the long baseline reads 0.
    const rising = new TelemetryRing();
    rising.reset(T0);
    commitFrames(rising, 1, 150, (r, ts, i) => {
      r.noteDesk(
        { ts, label: "at_desk", confidence: i < 120 ? 0.6 : 0.9, webcamEnabled: true },
        0.6,
      );
    });
    expect(extractFeatures(rising, T0 + 150 * SEC).raw.deskConfDrop120).toBe(0);
  });

  it("every trend feature sits at its documented neutral on a one-frame ring", () => {
    const ring = new TelemetryRing();
    ring.reset(T0);
    ring.noteFocus({
      ts: T0 + SEC,
      processName: "editor.exe",
      windowTitle: "essay",
      matchedAllow: true,
      matchedBlock: false,
    });
    ring.commit(T0 + SEC);
    const { raw, values } = extractFeatures(ring, T0 + SEC);
    expectAllInUnit(values);
    expect(raw.deskSagSlope30).toBe(0);
    expect(raw.dwellShrink30v90).toBe(1); // ε/ε
    expect(raw.titleChurnAccel).toBe(1);
    expect(raw.greyLeaky120).toBe(0);
    expect(raw.absenceRun60).toBe(0);
    expect(raw.deskConfDrop120).toBe(0);
    expect(values[idx("dwellShrink30v90")]).toBeCloseTo(0.25, 12);
    expect(values[idx("titleChurnAccel")]).toBeCloseTo(0.25, 12);
  });
});

describe("extractFeatures neutrals and bounds", () => {
  it("an empty ring (session just started) encodes to defined neutrals, never NaN", () => {
    const ring = new TelemetryRing();
    ring.reset(T0);
    const { raw, values } = extractFeatures(ring, T0);
    expectAllInUnit(values);
    // Trend neutrals: nothing observed ⇒ no trend, and the rate ratios are
    // exactly ε/ε = 1 rather than 0/0.
    expect(raw.deskSagSlope30).toBe(0);
    expect(raw.dwellShrink30v90).toBe(1);
    expect(raw.titleChurnAccel).toBe(1);
    expect(raw.greyLeaky120).toBe(0);
    expect(raw.absenceRun60).toBe(0);
    expect(raw.deskConfDrop120).toBe(0);
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
