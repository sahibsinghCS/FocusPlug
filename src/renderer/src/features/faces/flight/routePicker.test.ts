import { describe, expect, it } from "vitest";
import { resolveFlightRoutePicker } from "./routePicker";

describe("resolveFlightRoutePicker", () => {
  it("defaults off so lock and catalog previews stay clear of Origin/Arrival boxes", () => {
    expect(resolveFlightRoutePicker({})).toBe(false);
    expect(resolveFlightRoutePicker({ showRoutePicker: false })).toBe(false);
    expect(resolveFlightRoutePicker({ sessionId: "lock" })).toBe(false);
    expect(resolveFlightRoutePicker({ sessionId: "preview" })).toBe(false);
  });

  it("never enables the face picker in lock mode, even if a caller opts in", () => {
    expect(resolveFlightRoutePicker({ showRoutePicker: true, sessionId: "lock" })).toBe(false);
  });

  it("opts in only on settings-style or stills surfaces", () => {
    expect(resolveFlightRoutePicker({ showRoutePicker: true })).toBe(true);
    expect(resolveFlightRoutePicker({ showRoutePicker: true, sessionId: "settings" })).toBe(
      true,
    );
    expect(
      resolveFlightRoutePicker({ showRoutePicker: true, sessionId: "flight-stills" }),
    ).toBe(true);
  });
});
