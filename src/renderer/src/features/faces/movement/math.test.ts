import { describe, expect, it } from "vitest";
import { GEARS, layoutGears, meshDistance, PITCH_FACTOR } from "./draw";
import { BEAT_HZ, TRAIN, gearAngles, movementClock, overshootSettle, springTurns } from "./math";

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

  it("advances one second per wall second — never elapsed plus raw rAF clock", () => {
    // Stills / pre-rAF paints: pose comes from session elapsed alone.
    const still = movementClock(5000, 0, null);
    expect(still.elapsedSec).toBeCloseTo(5, 8);
    expect(still.base).toBeNull();

    // First live frame rebases; the rAF clock contributes nothing yet.
    const first = movementClock(5000, 120_000, still.base);
    expect(first.elapsedSec).toBeCloseTo(5, 8);

    // Within one elapsed tick only the rAF delta advances the train.
    const mid = movementClock(5000, 120_400, first.base);
    expect(mid.elapsedSec).toBeCloseTo(5.4, 8);

    // Elapsed ticking +1s while the clock advanced 1s must land on 6s, not 7s
    // (the old elapsed + clockMs sum ran the train at 2x with a 4-beat lurch).
    const next = movementClock(6000, 121_000, mid.base);
    expect(next.elapsedSec).toBeCloseTo(6, 8);
    expect(next.elapsedSec - mid.elapsedSec).toBeLessThan(1.001);
  });

  it("relaxes mainspring coil density as progress elapses", () => {
    expect(springTurns(0)).toBeGreaterThan(springTurns(0.5));
    expect(springTurns(0.5)).toBeGreaterThan(springTurns(1));
  });

  it("places neighbouring wheels on pitch so teeth mesh", () => {
    const laid = layoutGears();
    const pairs: Array<[string, string]> = [
      ["barrel", "center"],
      ["center", "third"],
      ["third", "fourth"],
      ["fourth", "escape"],
    ];
    for (const [aId, bId] of pairs) {
      const a = laid[aId];
      const b = laid[bId];
      expect(a).toBeDefined();
      expect(b).toBeDefined();
      if (!a || !b) {
        continue;
      }
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      expect(dist).toBeCloseTo(meshDistance(a.spec, b.spec), 5);
      expect(PITCH_FACTOR).toBeGreaterThan(0.85);
    }
    expect(GEARS.find((gear) => gear.id === "escape")?.brass).toBe(false);
  });
});
