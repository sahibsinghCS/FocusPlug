import { describe, expect, it } from "vitest";
import { parseFlightPreview } from "./preview";

describe("flight preview query", () => {
  it("derives remainingMs from progress and estimateMinutes on FaceProps", () => {
    const parsed = parseFlightPreview(
      "progress=0.25&estimateMinutes=80&now=2026-09-12T16:00:00.000Z&freeze=1",
    );
    expect(parsed.face.estimateMinutes).toBe(80);
    expect(parsed.face.remainingMs).toBeCloseTo(80 * 60 * 0.75 * 1000, 6);
    expect(parsed.face.elapsedMs).toBeCloseTo(80 * 60 * 0.25 * 1000, 6);
    expect(parsed.face.now.getTime()).toBe(Date.parse("2026-09-12T16:00:00.000Z"));
    expect(parsed.freeze).toBe(true);
    expect(parsed.variant).toBe("instrument");
    expect(parsed.estimateMinutes).toBe(80);
  });

  it("selects the sticker baseline when asked", () => {
    const parsed = parseFlightPreview("variant=sticker&remaining=0&complete=1");
    expect(parsed.variant).toBe("sticker");
    expect(parsed.face.progress).toBe(1);
    expect(parsed.face.remainingMs).toBe(0);
  });
});
