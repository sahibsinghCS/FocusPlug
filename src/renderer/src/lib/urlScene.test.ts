import { describe, expect, it } from "vitest";
import { parseUrlScene } from "./urlScene";

describe("parseUrlScene", () => {
  it("keeps the filming still contract for distracted overlay", () => {
    expect(parseUrlScene("?scene=distracted&countdown=8&freeze=1", "")).toEqual({
      countdown: 8,
      scene: "distracted",
      freeze: true,
    });
  });

  it("reads live / away / recovered command-center scenes", () => {
    expect(parseUrlScene("?scene=live", "")).toEqual({
      countdown: null,
      scene: "live",
      freeze: false,
    });
    expect(parseUrlScene("", "#/?scene=away")).toEqual({
      countdown: null,
      scene: "away",
      freeze: false,
    });
    expect(parseUrlScene("?scene=recovered", "")).toEqual({
      countdown: null,
      scene: "recovered",
      freeze: false,
    });
  });

  it("reads the log golden-path scene from search or hash", () => {
    expect(parseUrlScene("?scene=golden", "")).toEqual({
      countdown: null,
      scene: "golden",
      freeze: false,
    });
    expect(parseUrlScene("", "#/log?scene=golden")).toEqual({
      countdown: null,
      scene: "golden",
      freeze: false,
    });
  });

  it("treats a countdown without scene as distracted", () => {
    expect(parseUrlScene("?countdown=10", "").scene).toBe("distracted");
  });
});
