import { describe, expect, it } from "vitest";
import { PREVIEW_PROGRESS, previewFaceProps } from "./previewProps";

describe("preview face props", () => {
  it("freezes every catalog preview at about 35 percent", () => {
    const now = new Date("2026-09-12T12:00:00Z");
    const props = previewFaceProps({
      estimateMinutes: 40,
      width: 168,
      height: 84,
      now,
    });
    expect(PREVIEW_PROGRESS).toBe(0.35);
    expect(props.progress).toBe(0.35);
    expect(props.phase).toBe("focus");
    expect(props.paused).toBe(true);
    expect(props.elapsedMs).toBe(0.35 * 40 * 60_000);
    expect(props.remainingMs).toBe(0.65 * 40 * 60_000);
    expect(props.sessionId).toBe("preview");
    expect(props.width).toBe(168);
    expect(props.height).toBe(84);
  });
});
