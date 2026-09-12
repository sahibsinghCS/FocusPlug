import { describe, expect, it } from "vitest";
import { FACE_READY } from "@shared/faces";
import { clampProgress, resolveFaceBox } from "./clamp";
import { assertRightOr45, CIRCUIT_LENGTH, CIRCUIT_POINTS, dashOffset } from "./circuit/path";
import { bioAmount, depthMeters, formatDepth, zoneAt } from "./descent/zones";
import { FAR_SILT, MID_MOTES, NEAR_BIO } from "./descent/particles";
import { anglesAlign, bodyAngle, ORBIT_TURNS, orbitBodies, solveStartAngles } from "./orbit/math";
import { parsePreview } from "./preview/parsePreview";
import { FACE_REGISTRY, listFaces } from "./register";
import { faceComponent, faceIsReady } from "./registry";
import { toVisualFaceProps, VISUAL_FACE_IDS, visualPhaseFromFace } from "./visual";

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
  it("exports descent, orbit, and circuit paint for the host map", () => {
    expect(listFaces().map((face) => face.id)).toEqual([...VISUAL_FACE_IDS]);
    expect(FACE_REGISTRY.descent.Component).toBeTypeOf("function");
    expect(FACE_REGISTRY.orbit.Component).toBeTypeOf("function");
    expect(FACE_REGISTRY.circuit.Component).toBeTypeOf("function");
    expect(FACE_READY.descent).toBe(true);
    expect(FACE_READY.orbit).toBe(true);
    expect(FACE_READY.circuit).toBe(true);
    expect(faceIsReady("descent")).toBe(true);
    expect(faceIsReady("orbit")).toBe(true);
    expect(faceIsReady("circuit")).toBe(true);
    expect(faceComponent("descent").name).toBe("DescentFace");
    expect(faceComponent("orbit").name).toBe("OrbitFace");
    expect(faceComponent("circuit").name).toBe("CircuitFace");
  });
});

describe("visual adapter", () => {
  it("maps frozen FaceProps onto paint props without Date.now", () => {
    expect(visualPhaseFromFace("idle", 1)).toBe("idle");
    expect(visualPhaseFromFace("break", 0.4)).toBe("fuse");
    expect(visualPhaseFromFace("focus", 0.4)).toBe("focus");
    expect(visualPhaseFromFace("focus", 1)).toBe("complete");
    const painted = toVisualFaceProps({
      progress: 0.62,
      phase: "focus",
      elapsedMs: 1860_000,
      remainingMs: 1140_000,
      sessionId: "sess-1",
      events: [{ ts: 1, kind: "kill" }],
      killCount: 1,
      now: new Date(1_700_000_420_000),
      width: 960,
      height: 300,
    });
    expect(painted.now).toBe(1_700_000_420_000);
    expect(painted.size).toEqual({ width: 960, height: 300 });
    expect(painted.phase).toBe("focus");
    expect(painted.killCount).toBe(1);
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
    expect(FAR_SILT.length).toBe(110);
    expect(MID_MOTES.length).toBe(56);
    expect(NEAR_BIO.length).toBe(28);
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
