import { describe, expect, it } from "vitest";
import { BEAT_HZ, TRAIN, gearAngles, overshootSettle, springTurns } from "./math";

describe("movement train", () => {
  it("derives every wheel from one elapsed value with fixed ratios", () => {
    const a = gearAngles(12);
    const b = gearAngles(24);
    expect(a.escape / 12).toBeCloseTo(b.escape / 24, 5);
    const escapeFromFourth = Math.abs(a.fourth) * (TRAIN.fourthTeeth / TRAIN.escapePinion);
    expect(escapeFromFourth).toBeCloseTo(Math.abs(a.escape), 8);
    const fourthFromThird = Math.abs(a.third) * (TRAIN.thirdTeeth / TRAIN.fourthPinion);
    expect(fourthFromThird).toBeCloseTo(Math.abs(a.fourth), 8);
  });

  it("uses overshoot-and-settle, not a linear escape step", () => {
    expect(overshootSettle(0)).toBeCloseTo(0, 5);
    expect(overshootSettle(1)).toBeCloseTo(1, 5);
    expect(overshootSettle(0.3)).toBeGreaterThan(1);
    expect(overshootSettle(0.2)).not.toBeCloseTo(0.2, 2);
    const mid = gearAngles(0.3 / BEAT_HZ);
    const linear = (Math.floor(0.3) + 0.3) * ((Math.PI * 2) / TRAIN.escapeTeeth);
    expect(mid.escape).not.toBeCloseTo(linear, 3);
    expect(mid.easedBeats).toBeGreaterThan(0.3);
  });

  it("relaxes mainspring coil density as progress elapses", () => {
    expect(springTurns(0)).toBeGreaterThan(springTurns(0.5));
    expect(springTurns(0.5)).toBeGreaterThan(springTurns(1));
  });
});
