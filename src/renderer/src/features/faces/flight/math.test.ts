import { describe, expect, it } from "vitest";
import {
  MAX_BANK_DEG,
  bankDeg,
  dayAmount,
  flightPhase,
  flightProgress,
  formatBank,
  formatClockHm,
  formatGrouped,
  formatHdg,
  formatZulu,
  greatCirclePoint,
  groundSpeedKmh,
  haversineKm,
  remainingKm,
  solarDeclinationDeg,
  subsolar,
  twilightBand,
  wingAttitude,
  wrapLon,
} from "./math";

const NYC = { lat: 40.6413, lon: -73.7781 };
const LON = { lat: 51.47, lon: -0.4543 };
const SEP_12_2026_16Z = Date.parse("2026-09-12T16:00:00.000Z");
const SEP_12_2026_12Z = Date.parse("2026-09-12T12:00:00.000Z");
const SEP_12_2026_02Z = Date.parse("2026-09-12T02:00:00.000Z");

describe("subsolar / terminator", () => {
  it("puts the subsolar point at lon 0 at 12:00 UTC", () => {
    const s = subsolar(SEP_12_2026_12Z);
    expect(s.lon).toBeCloseTo(0, 5);
    expect(s.lat).toBeCloseTo(solarDeclinationDeg(SEP_12_2026_12Z), 8);
  });

  it("uses lon ≈ (12 - utcHours) * 15 at 16:00 UTC", () => {
    const s = subsolar(SEP_12_2026_16Z);
    expect(s.lon).toBeCloseTo((12 - 16) * 15, 5);
    expect(s.lon).toBeCloseTo(-60, 5);
  });

  it("uses lon ≈ 150° at 02:00 UTC", () => {
    const s = subsolar(SEP_12_2026_02Z);
    expect(wrapLon(s.lon)).toBeCloseTo(150, 5);
  });

  it("keeps September declination a few degrees north of the equator", () => {
    const dec = solarDeclinationDeg(SEP_12_2026_16Z);
    expect(dec).toBeGreaterThan(3);
    expect(dec).toBeLessThan(8);
  });

  it("builds a thin twilight band via smoothstep", () => {
    expect(dayAmount(-1)).toBe(0);
    expect(dayAmount(1)).toBe(1);
    expect(dayAmount(0)).toBeGreaterThan(0.3);
    expect(dayAmount(0)).toBeLessThan(0.7);
    expect(twilightBand(0)).toBeGreaterThan(twilightBand(0.8));
    expect(twilightBand(0)).toBeGreaterThan(twilightBand(-0.8));
  });
});

describe("great circle NYC→LON", () => {
  it("is about 5550 km, not a flat sticker distance", () => {
    const km = haversineKm(NYC.lat, NYC.lon, LON.lat, LON.lon);
    expect(km).toBeGreaterThan(5400);
    expect(km).toBeLessThan(5700);
  });

  it("tracks a north Atlantic arc instead of a straight rhumb", () => {
    const mid = greatCirclePoint(NYC.lat, NYC.lon, LON.lat, LON.lon, 0.5);
    expect(mid.lat).toBeGreaterThan(50);
    expect(mid.lon).toBeGreaterThan(-50);
    expect(mid.lon).toBeLessThan(-20);
  });

  it("banks into the heading change and stays within ±25°", () => {
    const samples = [0.08, 0.25, 0.45, 0.7].map((t) =>
      bankDeg(NYC.lat, NYC.lon, LON.lat, LON.lon, t),
    );
    for (const bank of samples) {
      expect(Math.abs(bank)).toBeLessThanOrEqual(MAX_BANK_DEG);
    }
    expect(Math.max(...samples.map((b) => Math.abs(b)))).toBeGreaterThan(2);
  });
});

describe("progress, phases, honest strip math", () => {
  it("uses remaining / estimateMinutes honestly", () => {
    expect(flightProgress(45 * 60, 90)).toBeCloseTo(0.5, 8);
    expect(flightProgress(0, 90)).toBe(1);
    expect(flightProgress(90 * 60, 90)).toBe(0);
  });

  it("treats first 8% as climb and last 12% as descent", () => {
    expect(flightPhase(0.04, false)).toBe("climb");
    expect(flightPhase(0.5, false)).toBe("cruise");
    expect(flightPhase(0.9, false)).toBe("descent");
    expect(flightPhase(1, false)).toBe("complete");
    expect(flightPhase(0.5, true)).toBe("complete");
  });

  it("computes remaining km and ground speed from the same remaining clock", () => {
    const total = haversineKm(NYC.lat, NYC.lon, LON.lat, LON.lon);
    const progress = 0.5;
    const remainKm = remainingKm(total, progress);
    expect(remainKm).toBeCloseTo(total * 0.5, 6);
    const gs = groundSpeedKmh(remainKm, 45 * 60);
    expect(gs).toBeCloseTo(remainKm / 0.75, 6);
  });

  it("prints ETA as a real 24h clock in UTC when asked", () => {
    const eta = SEP_12_2026_16Z + 45 * 60 * 1000;
    expect(formatClockHm(eta, "UTC")).toBe("16:45");
    expect(formatZulu(SEP_12_2026_16Z)).toBe("16:00Z");
  });

  it("prints bank, heading, and bare strip integers without unit suffixes", () => {
    expect(formatBank(15.2)).toBe("15°R");
    expect(formatBank(-4.4)).toBe("4°L");
    expect(formatBank(0.2)).toBe("LVL");
    expect(formatHdg(72.9)).toBe("073");
    expect(formatGrouped(791.4)).toBe("791");
    expect(formatGrouped(2992.2)).toBe("2,992");
  });

  it("rolls wing tips vertically so bank is a silhouette, not extra yaw", () => {
    const right = wingAttitude(15, 28);
    expect(right.rightY - right.leftY).toBeGreaterThan(22);
    expect(right.leftSpan).toBeGreaterThan(right.rightSpan);
    const left = wingAttitude(-15, 28);
    expect(left.leftY).toBeGreaterThan(left.rightY);
    expect(wingAttitude(0, 28).drop).toBe(0);
  });
});
