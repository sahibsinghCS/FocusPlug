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
    expect(faceComponent("column").name).toBe("FlightFace");
    expect(faceComponent("growth").name).toBe("GrowthFace");
    expect(faceComponent("flask").name).toBe("FlaskFace");
    expect(faceIsReady("hourglass")).toBe(true);
    expect(faceIsReady("growth")).toBe(true);
    expect(faceIsReady("flask")).toBe(true);
    expect(faceIsReady("flight")).toBe(true);
    expect(faceIsReady("descent")).toBe(true);
    expect(faceIsReady("orbit")).toBe(true);
    expect(faceIsReady("circuit")).toBe(true);
    expect(faceComponent("descent").name).toBe("DescentFace");
    expect(faceComponent("orbit").name).toBe("OrbitFace");
    expect(faceComponent("circuit").name).toBe("CircuitFace");
  });

  it("reads a stills override from search or hash without inventing ids", () => {
    expect(parseFaceParam("?face=hourglass", "")).toBe("hourglass");
    expect(parseFaceParam("?face=flask", "")).toBe("flask");
    expect(parseFaceParam("", "#/?scene=live&face=flight")).toBe("flight");
    expect(parseFaceParam("", "#/?scene=live&face=flask&progress=0.62")).toBe("flask");
    expect(parseFaceParam("?face=eclipse", "")).toBeNull();
    expect(parseProgressParam("?progress=0.62", "")).toBe(0.62);
    expect(parseProgressParam("?progress=2", "")).toBe(1);
    expect(parseKillsParam("?kills=3", "")).toBe(3);
    expect(parseSessionParam("", "#/?scene=live&face=growth&session=gauntlet-growth-01")).toBe(
      "gauntlet-growth-01",
    );
  });
});
