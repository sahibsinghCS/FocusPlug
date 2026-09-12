import { describe, expect, it } from "vitest";
import { STILL_CLOCK_MS } from "./math";
import { parseFlaskPreview, parseFlaskScene } from "./preview";

describe("flask preview hash", () => {
  it("defaults to the mid-session leaking still", () => {
    const preview = parseFlaskPreview("", "");
    expect(preview.scene).toBe("leak");
    expect(preview.progress).toBe(0.62);
    expect(preview.phase).toBe("focus");
    expect(preview.freeze).toBe(false);
    expect(preview.stillClockMs).toBe(STILL_CLOCK_MS);
    expect(preview.remainingMs).toBeGreaterThan(0);
  });

  it("reads still/freeze and progress overrides", () => {
    expect(parseFlaskScene("low")).toBe("low");
    const still = parseFlaskPreview("?scene=leak&progress=0.62&still=1", "");
    expect(still.freeze).toBe(true);
    expect(still.progress).toBe(0.62);
    const hashed = parseFlaskPreview("", "#/?scene=full&freeze=1");
    expect(hashed.scene).toBe("full");
    expect(hashed.phase).toBe("idle");
    expect(hashed.freeze).toBe(true);
  });
});
