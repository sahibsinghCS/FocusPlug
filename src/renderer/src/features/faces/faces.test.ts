import { describe, expect, it } from "vitest";
import { clampProgress, resolveFaceBox } from "./clamp";
import { assertRightOr45, CIRCUIT_LENGTH, CIRCUIT_POINTS, dashOffset } from "./circuit/path";
import { bioAmount, depthMeters, formatDepth, zoneAt } from "./descent/zones";
import { FAR_SILT, MID_MOTES, NEAR_BIO } from "./descent/particles";
import { anglesAlign, bodyAngle, ORBIT_TURNS, orbitBodies, solveStartAngles } from "./orbit/math";
import { parsePreview } from "./preview/parsePreview";
import { FACE_REGISTRY, listFaces } from "./register";
import { FACE_IDS } from "./types";

describe("FaceProps helpers", () => {
  it("clamps progress and resolves size", () => {
    expect(clampProgress(1.4)).toBe(1);
    expect(clampProgress(-2)).toBe(0);
    expect(clampProgress(Number.NaN)).toBe(0);
    expect(resolveFaceBox(240)).toEqual({ width: 240, height: 240 });
    expect(resolveFaceBox({ width: 800, height: 400 })).toEqual({ width: 800, height: 400 });
  });
});

describe("register", () => {
  it("exports descent, orbit, and circuit for foundation", () => {
    expect(listFaces().map((face) => face.id)).toEqual([...FACE_IDS]);
    expect(FACE_REGISTRY.descent.Component).toBeTypeOf("function");
    expect(FACE_REGISTRY.orbit.Component).toBeTypeOf("function");
    expect(FACE_REGISTRY.circuit.Component).toBeTypeOf("function");
  });
});

describe("Descent zones", () => {
  it("maps progress to real depth labels", () => {
    expect(zoneAt(0.1).id).toBe("sunlight");
    expect(zoneAt(0.34).id).toBe("twilight");
    expect(zoneAt(0.62).id).toBe("midnight");
    expect(zoneAt(0.9).id).toBe("abyssal");
    expect(depthMeters(0)).toBe(0);
    expect(depthMeters(1)).toBe(6000);
    expect(formatDepth(2410)).toBe("2,410 m");
    expect(bioAmount(0.2)).toBe(0);
    expect(bioAmount(0.7)).toBe(1);
  });

  it("keeps three fixed particle layers", () => {
    expect(FAR_SILT.length).toBe(72);
    expect(MID_MOTES.length).toBe(40);
    expect(NEAR_BIO.length).toBe(22);
    expect(FAR_SILT[0]?.x).toBeGreaterThanOrEqual(0);
    expect(FAR_SILT[0]?.x).toBeLessThanOrEqual(1);
  });
});

describe("Orbit math", () => {
  it("uses integer Fibonacci turns and aligns at progress=1", () => {
    expect([...ORBIT_TURNS]).toEqual([1, 2, 3, 5, 8]);
    const bodies = orbitBodies();
    const starts = solveStartAngles(ORBIT_TURNS);
    expect(new Set(starts).size).toBe(1);
    const end = bodies.map((body) => bodyAngle(body.startAngle, body.turns, 1));
    expect(anglesAlign(end)).toBe(true);
    const mid = bodies.map((body) => bodyAngle(body.startAngle, body.turns, 0.62));
    expect(anglesAlign(mid)).toBe(false);
  });
});

describe("Circuit path", () => {
  it("is hand-authored with only 90° and 45° bends", () => {
    expect(assertRightOr45(CIRCUIT_POINTS)).toBe(true);
    expect(CIRCUIT_LENGTH).toBeGreaterThan(800);
    expect(dashOffset(CIRCUIT_LENGTH, 0)).toBe(CIRCUIT_LENGTH);
    expect(dashOffset(CIRCUIT_LENGTH, 1)).toBe(0);
    expect(dashOffset(1000, 0.25)).toBe(750);
  });
});

describe("preview hash", () => {
  it("parses face, progress, and vs mode", () => {
    const solo = parsePreview("#/circuit?p=0.62&phase=focus");
    expect(solo.kind).toBe("circuit");
    expect(solo.progress).toBe(0.62);
    expect(solo.vs).toBe(false);
    const vs = parsePreview("#/vs/descent?p=0.5");
    expect(vs.kind).toBe("descent");
    expect(vs.vs).toBe(true);
    expect(parsePreview("#/bar?p=0.62").kind).toBe("bar");
  });
});
