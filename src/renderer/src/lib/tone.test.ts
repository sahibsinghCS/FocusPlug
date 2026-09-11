import { describe, expect, it } from "vitest";
import { toneCard, toneChip, toneDot, toneText, toneWash } from "./tone";

describe("shared tone tokens", () => {
  it("maps lime / red / amber / mute to the same text and chip classes everywhere", () => {
    expect(toneText("lime")).toBe("text-fp-lime");
    expect(toneText("red")).toBe("text-fp-red");
    expect(toneText("amber")).toBe("text-fp-amber");
    expect(toneText("mute")).toBe("text-fp-mute");
    expect(toneChip("lime")).toMatch(/border-fp-lime/);
    expect(toneChip("red")).toMatch(/border-fp-red/);
    expect(toneChip("amber")).toMatch(/border-fp-amber/);
    expect(toneChip("mute")).toMatch(/border-fp-line/);
  });

  it("keeps wash and card borders on the same status colors", () => {
    expect(toneWash("lime")).toMatch(/bg-fp-lime/);
    expect(toneWash("red")).toMatch(/bg-fp-red/);
    expect(toneCard("lime")).toBe("border-fp-lime/25");
    expect(toneCard("mute")).toBe("border-fp-line");
    expect(toneDot("lime")).toMatch(/bg-fp-lime/);
    expect(toneDot("mute")).toMatch(/bg-\[#4b5568\]/);
  });
});
