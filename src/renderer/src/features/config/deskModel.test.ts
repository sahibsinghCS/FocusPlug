import { describe, expect, it } from "vitest";
import {
  CUSTOM_GUIDE_PATH,
  CUSTOM_MODEL_PATH,
  customReadiness,
  DESK_MODEL_CARDS,
  deskModelCard,
  modelReturned,
} from "./deskModel";

describe("config desk model", () => {
  it("explains BlazeFace default, custom seam, and stub soak", () => {
    expect(DESK_MODEL_CARDS.map((card) => card.id)).toEqual(["blazeface", "custom", "stub"]);
    expect(deskModelCard("blazeface").badge).toBe("Default");
    expect(deskModelCard("custom").detail).toContain(CUSTOM_MODEL_PATH);
    expect(deskModelCard("custom").detail).toContain(CUSTOM_GUIDE_PATH);
    expect(deskModelCard("stub").summary).toMatch(/uncertain/i);
  });

  it("does not invent custom readiness from the UI", () => {
    const readiness = customReadiness();
    expect(readiness.state).toBe("unprobed");
    expect(readiness.label).toMatch(/not probed/);
    expect(readiness.detail).toContain(CUSTOM_MODEL_PATH);
  });

  it("accepts only the returned deskModelId as success", () => {
    expect(modelReturned("custom", "custom")).toBe(true);
    expect(modelReturned("blazeface", "custom")).toBe(false);
  });
});
