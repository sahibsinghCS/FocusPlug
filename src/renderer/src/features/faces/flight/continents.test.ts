import { describe, expect, it } from "vitest";
import { landCoverage } from "./continents";

describe("continent mask", () => {
  it("marks New York and London as land and the mid-Atlantic as ocean", () => {
    expect(landCoverage(40.7, -74)).toBeGreaterThan(0.4);
    expect(landCoverage(51.5, -0.1)).toBeGreaterThan(0.4);
    expect(landCoverage(40, -40)).toBeLessThan(0.4);
  });

  it("keeps Dublin and Edinburgh on land and the Irish Sea as water", () => {
    expect(landCoverage(53.43, -6.25, "coast")).toBeGreaterThan(0.5);
    expect(landCoverage(55.95, -3.19, "coast")).toBeGreaterThan(0.5);
    expect(landCoverage(53.48, -2.24, "coast")).toBeGreaterThan(0.5);
    expect(landCoverage(53.8, -5.35, "coast")).toBeLessThan(0.35);
  });
});
