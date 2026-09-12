import { describe, expect, it } from "vitest";
import { STILL_CLOCK_MS } from "./math";
import { parseCandlePreview, parseCandleScene } from "./preview";

describe("candle preview hash", () => {
  it("defaults to the mid-session melting still", () => {
    const preview = parseCandlePreview("", "");
    expect(preview.scene).toBe("mid");
    expect(preview.progress).toBe(0.5);
    expect(preview.phase).toBe("focus");
    expect(preview.freeze).toBe(false);
    expect(preview.killCount).toBe(0);
    expect(preview.stillClockMs).toBe(STILL_CLOCK_MS);
    expect(preview.remainingMs).toBeGreaterThan(0);
  });

  it("reads still/freeze, progress, and kill overrides", () => {
    expect(parseCandleScene("end")).toBe("end");
    const still = parseCandlePreview("?scene=start&progress=0.04&still=1", "");
    expect(still.freeze).toBe(true);
    expect(still.progress).toBe(0.04);
    expect(still.scene).toBe("start");
    const hashed = parseCandlePreview("", "#/?scene=end&freeze=1");
    expect(hashed.scene).toBe("end");
    expect(hashed.progress).toBe(0.92);
    expect(hashed.freeze).toBe(true);
    const stakes = parseCandlePreview("?scene=stakes&kills=3&still=1", "");
    expect(stakes.killCount).toBe(3);
    expect(stakes.progress).toBe(0.5);
  });
});
