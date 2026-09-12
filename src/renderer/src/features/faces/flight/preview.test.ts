import { describe, expect, it } from "vitest";
import { parseFlightPreview } from "./preview";

describe("flight preview query", () => {
  it("derives remaining from progress and estimateMinutes", () => {
    const parsed = parseFlightPreview(
      "progress=0.25&estimateMinutes=80&now=2026-09-12T16:00:00.000Z&freeze=1",
    );
    expect(parsed.props.estimateMinutes).toBe(80);
    expect(parsed.props.remaining).toBeCloseTo(80 * 60 * 0.75, 6);
    expect(parsed.props.now).toBe(Date.parse("2026-09-12T16:00:00.000Z"));
    expect(parsed.props.paused).toBe(true);
    expect(parsed.variant).toBe("instrument");
  });

  it("selects the sticker baseline when asked", () => {
    const parsed = parseFlightPreview("variant=sticker&remaining=0&complete=1");
    expect(parsed.variant).toBe("sticker");
    expect(parsed.props.complete).toBe(true);
    expect(parsed.props.remaining).toBe(0);
  });
});
