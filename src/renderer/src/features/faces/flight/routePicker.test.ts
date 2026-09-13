import { describe, expect, it } from "vitest";
import { resolveFlightRoutePicker } from "./routePicker";

describe("resolveFlightRoutePicker", () => {
  it("defaults off so lock and catalog previews stay clear of Origin/Arrival boxes", () => {
    expect(resolveFlightRoutePicker({})).toBe(false);
    expect(resolveFlightRoutePicker({ showRoutePicker: false })).toBe(false);
    expect(resolveFlightRoutePicker({ sessionId: "preview" })).toBe(false);
    expect(resolveFlightRoutePicker({ sessionId: "sess-1000" })).toBe(false);
  });

  it("does not treat the leftover sessionId lock string as lock mode", () => {
    expect(resolveFlightRoutePicker({ sessionId: "lock" })).toBe(false);
    expect(resolveFlightRoutePicker({ showRoutePicker: true, sessionId: "lock" })).toBe(
      true,
    );
    expect(resolveFlightRoutePicker({ showRoutePicker: true, sessionId: "sess-1000" })).toBe(
      true,
    );
  });

  it("opts in only when showRoutePicker is true (settings / stills)", () => {
    expect(resolveFlightRoutePicker({ showRoutePicker: true })).toBe(true);
    expect(resolveFlightRoutePicker({ showRoutePicker: true, sessionId: "settings" })).toBe(
      true,
    );
    expect(
      resolveFlightRoutePicker({ showRoutePicker: true, sessionId: "flight-stills" }),
    ).toBe(true);
  });
});
