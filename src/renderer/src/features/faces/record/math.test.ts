import { describe, expect, it } from "vitest";
import { faceEventsFromLog } from "../events";
import { goldenSessionEvents } from "../../logs/fixtures";
import {
  baselineNoise,
  dampedBurst,
  eventDisplacement,
  progressTheta,
  radiusAt,
  revolutionCount,
  sampleTrace,
  sessionHarmonics,
  visualWraps,
  WRAPS_PER_SESSION,
} from "./math";

describe("record seismograph", () => {
  it("keeps baseline noise deterministic per sessionId", () => {
    const a = sessionHarmonics("fp-rec-1847");
    const b = sessionHarmonics("fp-rec-1847");
    const c = sessionHarmonics("fp-other");
    expect(a).toEqual(b);
    expect(baselineNoise(1.2, a)).toBeCloseTo(baselineNoise(1.2, b), 12);
    expect(baselineNoise(1.2, a)).not.toBeCloseTo(baselineNoise(1.2, c), 5);
  });

  it("injects damped sine bursts at event angles by severity", () => {
    const high = Math.abs(dampedBurst(0.01, "kill", "high"));
    const mid = Math.abs(dampedBurst(0.01, "countdown", "medium"));
    const low = Math.abs(dampedBurst(0.01, "drift", "low"));
    expect(high).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(low);
    expect(Math.abs(dampedBurst(1.4, "kill", "high"))).toBeLessThan(0.002);

    const events = faceEventsFromLog(goldenSessionEvents(1_050_000), 1_000_000, 50_000);
    const bursts = events.filter((event) => event.kind === "kill" || event.kind === "countdown");
    expect(bursts.length).toBeGreaterThan(0);
    const theta = bursts[0]!.at * Math.PI * 2;
    const quiet = Math.abs(eventDisplacement(theta + 1.6, events, 1));
    const peak = Math.abs(eventDisplacement(theta + 0.02, events, 1));
    expect(peak).toBeGreaterThan(quiet);
  });

  it("walks radius outward so revolutions do not overwrite", () => {
    const harmonics = sessionHarmonics("fp-rec-1847");
    const r0 = radiusAt({
      theta: 0.2,
      r0: 40,
      r1: 140,
      harmonics,
      events: [],
      revs: 1,
    });
    const r1 = radiusAt({
      theta: 0.2 + Math.PI * 2,
      r0: 40,
      r1: 140,
      harmonics,
      events: [],
      revs: 2,
    });
    expect(r1).toBeGreaterThan(r0);
    expect(revolutionCount(1)).toBe(1);
    expect(revolutionCount(1.2)).toBe(2);
    expect(progressTheta(0.5)).toBeCloseTo(Math.PI * WRAPS_PER_SESSION, 5);
    expect(progressTheta(1)).toBeCloseTo(Math.PI * 2 * WRAPS_PER_SESSION, 5);
    expect(visualWraps(1)).toBe(WRAPS_PER_SESSION);
    expect(visualWraps(1.2)).toBe(WRAPS_PER_SESSION * 2);

    const first = sampleTrace({
      fromTheta: 0,
      toTheta: 0.4,
      cx: 0,
      cy: 0,
      r0: 40,
      r1: 140,
      harmonics,
      events: [],
      revs: 1,
    });
    const next = sampleTrace({
      fromTheta: 0.4,
      toTheta: 0.8,
      cx: 0,
      cy: 0,
      r0: 40,
      r1: 140,
      harmonics,
      events: [],
      revs: 1,
    });
    expect(first[first.length - 1]!.theta).toBeLessThanOrEqual(next[0]!.theta + 1e-9);
    expect(next[0]!.theta).toBeGreaterThanOrEqual(0.4 - 1e-9);
  });
});

describe("record picker drum", () => {
  it("fills a short tile and keeps the lock-size drum smaller", async () => {
    const { layoutRecordDrum } = await import("./RecordFace");
    const tile = layoutRecordDrum(168, 84);
    const lock = layoutRecordDrum(960, 300);
    expect(tile.cx).toBe(84);
    expect(tile.rx).toBeGreaterThan(lock.rx * 0.84 * (84 / 300));
    expect(tile.hh / 84).toBeGreaterThan(0.7);
    expect(lock.cx / 960).toBeCloseTo(0.46, 5);
  });
});
