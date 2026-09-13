import { describe, expect, it } from "vitest";
import { FACE_IDS } from "@shared/faces";
import { faceComponent, FACE_COMPONENTS, faceIsReady } from "./registry";
import { parseFaceParam, parseKillsParam, parseProgressParam, parseSessionParam } from "./urlFace";

describe("face registry", () => {
  it("registers every FaceId so parallel streams replace a file, not the host", () => {
    expect(Object.keys(FACE_COMPONENTS).sort()).toEqual([...FACE_IDS].sort());
    expect(faceComponent("hourglass").name).toBe("HourglassFace");
    expect(faceComponent("readout").name).toBe("ReadoutFace");
    expect(faceComponent("flight").name).toBe("FlightFace");
    expect(faceComponent("movement").name).toBe("MovementFace");
    expect(faceComponent("line").name).toBe("LineFace");
    expect(faceComponent("growth").name).toBe("GrowthFace");
    expect(faceComponent("flask").name).toBe("FlaskFace");
    expect(faceComponent("garden").name).toBe("GardenFace");
    expect(faceComponent("candle").name).toBe("CandleFace");
    for (const id of FACE_IDS) {
      expect(faceIsReady(id)).toBe(true);
    }
  });

  it("sends a saved retired face to the default instead of crashing", () => {
    for (const retired of ["column", "field", "descent", "record", "circuit", "orbit"]) {
      expect(faceComponent(retired).name).toBe("FlightFace");
    }
  });

  it("reads a stills override from search or hash without inventing ids", () => {
    expect(parseFaceParam("?face=hourglass", "")).toBe("hourglass");
    expect(parseFaceParam("?face=flask", "")).toBe("flask");
    expect(parseFaceParam("?face=candle", "")).toBe("candle");
    expect(parseFaceParam("", "#/?scene=live&face=flight")).toBe("flight");
    expect(parseFaceParam("", "#/?scene=live&face=flask&progress=0.62")).toBe("flask");
    expect(parseFaceParam("?face=garden", "")).toBe("garden");
    expect(parseFaceParam("", "#/?scene=live&face=candle&progress=0.5")).toBe("candle");
    expect(parseFaceParam("?face=field", "")).toBeNull();
    expect(parseFaceParam("?face=eclipse", "")).toBeNull();
    expect(parseFaceParam("?face=circuit", "")).toBeNull();
    expect(parseFaceParam("?face=orbit", "")).toBeNull();
    expect(parseProgressParam("?progress=0.62", "")).toBe(0.62);
    expect(parseProgressParam("?progress=2", "")).toBe(1);
    expect(parseKillsParam("?kills=3", "")).toBe(3);
    expect(parseSessionParam("", "#/?scene=live&face=growth&session=gauntlet-growth-01")).toBe(
      "gauntlet-growth-01",
    );
  });
});
