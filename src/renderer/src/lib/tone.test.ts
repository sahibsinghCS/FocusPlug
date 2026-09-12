import { describe, expect, it } from "vitest";
import { toneCard, toneChip, toneDot, toneText, toneWash } from "./tone";

describe("shared tone tokens", () => {
  it("maps focus / red / warn / mute to the same text and chip classes everywhere", () => {
    expect(toneText("focus")).toBe("text-fp-focus");
    expect(toneText("red")).toBe("text-fp-red");
    expect(toneText("warn")).toBe("text-fp-warn");
    expect(toneText("mute")).toBe("text-fp-mute");
    expect(toneChip("focus")).toMatch(/border-fp-focus/);
    expect(toneChip("red")).toMatch(/border-fp-red/);
    expect(toneChip("warn")).toMatch(/border-fp-warn/);
    expect(toneChip("mute")).toMatch(/border-fp-line/);
  });

  it("keeps wash and card borders on the same status colors", () => {
    expect(toneWash("focus")).toMatch(/bg-fp-focus/);
    expect(toneWash("red")).toMatch(/bg-fp-red/);
    expect(toneCard("focus")).toBe("border-fp-focus/25");
    expect(toneCard("mute")).toBe("border-fp-line");
    expect(toneDot("focus")).toMatch(/bg-fp-focus/);
    expect(toneDot("mute")).toMatch(/bg-\[#4a4354\]/);
  });
});
