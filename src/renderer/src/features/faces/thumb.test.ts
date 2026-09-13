import { describe, expect, it } from "vitest";
import { FACE_THUMB_MAX_HEIGHT, isFaceThumb } from "./thumb";

describe("isFaceThumb", () => {
  it("treats setup picker tiles as thumbs and lock hosts as full faces", () => {
    expect(FACE_THUMB_MAX_HEIGHT).toBe(140);
    expect(isFaceThumb(58)).toBe(true);
    expect(isFaceThumb(84)).toBe(true);
    expect(isFaceThumb(139)).toBe(true);
    expect(isFaceThumb(140)).toBe(false);
    expect(isFaceThumb(300)).toBe(false);
    expect(isFaceThumb(380)).toBe(false);
    expect(isFaceThumb(0)).toBe(false);
    expect(isFaceThumb(Number.NaN)).toBe(false);
  });
});
