import { describe, expect, it } from "vitest";
import {
  DEFAULT_FLIGHT_ARR,
  DEFAULT_FLIGHT_DEP,
  FLIGHT_AIRPORTS,
  isFlightIata,
  normalizeFlightPair,
  searchFlightAirports,
} from "./flightRoute";

describe("flight route catalog", () => {
  it("defaults to DUB→EDI with real coordinates", () => {
    expect(DEFAULT_FLIGHT_DEP).toBe("DUB");
    expect(DEFAULT_FLIGHT_ARR).toBe("EDI");
    expect(FLIGHT_AIRPORTS.DUB?.name).toBe("Dublin");
    expect(FLIGHT_AIRPORTS.EDI?.name).toBe("Edinburgh");
    expect(FLIGHT_AIRPORTS.DUB?.lat).toBeCloseTo(53.4264, 3);
    expect(FLIGHT_AIRPORTS.EDI?.lon).toBeCloseTo(-3.3725, 3);
  });

  it("accepts curated IATA codes and rejects junk", () => {
    expect(isFlightIata("dub")).toBe(true);
    expect(isFlightIata("JFK")).toBe(true);
    expect(isFlightIata("XXX")).toBe(false);
    expect(isFlightIata(12)).toBe(false);
  });

  it("keeps origin and destination different", () => {
    expect(normalizeFlightPair("DUB", "EDI")).toEqual({ flightDep: "DUB", flightArr: "EDI" });
    expect(normalizeFlightPair("edi", "edi")).toEqual({
      flightDep: "EDI",
      flightArr: "DUB",
    });
  });

  it("filters the curated list by city or code", () => {
    const dublin = searchFlightAirports("dub");
    expect(dublin.some((row) => row.code === "DUB")).toBe(true);
    const edinburgh = searchFlightAirports("edinburgh");
    expect(edinburgh.map((row) => row.code)).toContain("EDI");
    expect(searchFlightAirports("zzzz").length).toBe(0);
  });
});
