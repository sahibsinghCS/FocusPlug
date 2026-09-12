import { describe, expect, it } from "vitest";
import { innerRadius, outerRadius, transferFromProgress } from "./math";

describe("hourglass profile", () => {
  it("is bulbous — widest mid-chamber, not a triangle from cap to point", () => {
    const neck = innerRadius(0);
    const mid = innerRadius(-0.56);
    const cap = innerRadius(-1);
    const triangularMid = neck + 0.56 * (cap - neck);
    expect(neck).toBeLessThan(0.05);
    expect(mid).toBeGreaterThan(neck * 8);
    expect(mid).toBeGreaterThan(cap + 0.14);
    expect(mid).toBeGreaterThan(triangularMid + 0.14);
    expect(innerRadius(0.56)).toBeCloseTo(mid, 5);
    expect(outerRadius(0)).toBeGreaterThan(neck);
  });
});

describe("hourglass transfer", () => {
  it("derives sand only from progress — top empty and bottom full at the end", () => {
    const idle = transferFromProgress(0, "idle");
    expect(idle.topFill).toBe(1);
    expect(idle.bottomFill).toBe(0);
    expect(idle.flowing).toBe(false);
    expect(idle.bottom.kind).toBe("empty");

    const mid = transferFromProgress(0.62, "focus");
    expect(mid.topFill).toBeCloseTo(0.38, 5);
    expect(mid.bottomFill).toBeCloseTo(0.62, 5);
    expect(mid.topFill + mid.bottomFill).toBeCloseTo(1, 8);
    expect(mid.flowing).toBe(true);
    expect(mid.bottom.kind).not.toBe("empty");
    expect(mid.topSurfaceY).toBeGreaterThan(idle.topSurfaceY);
    expect(mid.streamHalfWidth).toBeGreaterThan(0.02);

    const done = transferFromProgress(1, "focus");
    expect(done.topFill).toBe(0);
    expect(done.bottomFill).toBe(1);
    expect(done.flowing).toBe(false);
    expect(done.bottom.kind).toBe("bowl");
    expect(done.bottom.peakY).toBeLessThan(0.25);
  });

  it("is stall-proof: the same progress yields the same fill, ignoring frame time", () => {
    const a = transferFromProgress(0.4, "focus");
    const b = transferFromProgress(0.4, "focus");
    expect(a).toEqual(b);
    expect(transferFromProgress(0.4, "break").topFill).toBe(a.topFill);
    expect(transferFromProgress(0.4, "break").bottom.peakY).toBe(a.bottom.peakY);
  });

  it("grows the bottom pile monotonically as progress increases", () => {
    const samples = [0, 0.12, 0.35, 0.62, 0.88, 1].map((progress) =>
      transferFromProgress(progress, "focus"),
    );
    for (let i = 1; i < samples.length; i += 1) {
      const prev = samples[i - 1];
      const next = samples[i];
      if (!prev || !next) {
        continue;
      }
      expect(next.bottomFill).toBeGreaterThan(prev.bottomFill);
      expect(next.topFill).toBeLessThan(prev.topFill);
      expect(next.bottom.peakY).toBeLessThanOrEqual(prev.bottom.peakY + 1e-6);
    }
  });
});
