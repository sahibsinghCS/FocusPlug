import { describe, expect, it } from "vitest";
import { parseFaceUrl } from "./urlFace";

describe("parseFaceUrl", () => {
  it("reads solo still contracts for the mid pack", () => {
    expect(parseFaceUrl("?face=bar&solo=1&faceScene=artifact&freeze=1", "")).toEqual({
      face: "bar",
      scene: "artifact",
      solo: true,
      freeze: true,
    });
    expect(parseFaceUrl("", "#/?face=line&solo=1&faceScene=rounds")).toEqual({
      face: "line",
      scene: "rounds",
      solo: true,
      freeze: false,
    });
    expect(parseFaceUrl("?face=movement&solo=1", "").face).toBe("movement");
    expect(parseFaceUrl("?face=bar&solo=1", "").scene).toBe("artifact");
  });

  it("no longer knows the removed Record face", () => {
    expect(parseFaceUrl("?face=record&solo=1", "").face).toBeNull();
  });
});
