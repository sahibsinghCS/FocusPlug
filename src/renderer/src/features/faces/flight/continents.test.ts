import { describe, expect, it } from "vitest";
import { landCoverage } from "./continents";

describe("continent mask", () => {
  it("marks New York and London as land and the mid-Atlantic as ocean", () => {
    expect(landCoverage(40.7, -74)).toBeGreaterThan(0.4);
    expect(landCoverage(51.5, -0.1)).toBeGreaterThan(0.4);
    expect(landCoverage(40, -40)).toBeLessThan(0.4);
  });
});
