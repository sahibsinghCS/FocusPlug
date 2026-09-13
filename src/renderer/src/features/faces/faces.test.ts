import { describe, expect, it } from "vitest";
import { clampProgress, resolveFaceBox, tallStripViewBox } from "./clamp";

describe("FaceProps helpers", () => {
  it("clamps progress and resolves size", () => {
    expect(clampProgress(1.4)).toBe(1);
    expect(clampProgress(-2)).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(resolveFaceBox(240)).toEqual({ width: 240, height: 240 });
    expect(resolveFaceBox({ width: 800, height: 400 })).toEqual({ width: 800, height: 400 });
  });

  it("expands a strip viewBox when the host is taller than 380px", () => {
    expect(tallStripViewBox({ width: 960, height: 300 }, 1280, 380)).toEqual({
      width: 1280,
      height: 380,
    });
    const tall = tallStripViewBox({ width: 1280, height: 720 }, 1280, 380);
    expect(tall.width).toBe(1280);
    expect(tall.height).toBeCloseTo(720, 5);
  });
});
