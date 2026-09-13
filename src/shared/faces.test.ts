import { describe, expect, it } from "vitest";
import {
  DEFAULT_ESTIMATE_MINUTES,
  DEFAULT_FACE_ID,
  FACE_CATALOG,
  FACE_IDS,
  FACE_READY,
  RETIRED_FACE_IDS,
  faceMeta,
  isFaceId,
  isRetiredFaceId,
  normalizeFaceId,
  resolveDefaultFaceId,
} from "./faces";

describe("faces catalog", () => {
  it("owns the nine live FaceIds and refuses retired names", () => {
    expect([...FACE_IDS]).toEqual([
      "flight",
      "hourglass",
      "readout",
      "movement",
      "line",
      "growth",
      "flask",
      "garden",
      "candle",
    ]);
    expect([...RETIRED_FACE_IDS]).toEqual([
      "column",
      "grid",
      "eclipse",
      "field",
      "descent",
      "record",
      "circuit",
      "orbit",
    ]);
    for (const id of RETIRED_FACE_IDS) {
      expect(isFaceId(id)).toBe(false);
      expect(isRetiredFaceId(id)).toBe(true);
      expect(normalizeFaceId(id)).toBe("flight");
    }
  });

  it("defaults to flight once the instrument is marked ready", () => {
    expect(FACE_READY.flight).toBe(true);
    expect(FACE_READY.growth).toBe(true);
    expect(FACE_READY.flask).toBe(true);
    expect(FACE_READY.garden).toBe(true);
    expect(FACE_READY.candle).toBe(true);
    expect(faceMeta("growth").readiness).toBe("ready");
    expect(faceMeta("flask").readiness).toBe("ready");
    expect(faceMeta("flask").file).toContain("FlaskFace.tsx");
    expect(faceMeta("garden").readiness).toBe("ready");
    expect(faceMeta("garden").stream).toBe("agent/faces-garden");
    expect(faceMeta("candle").readiness).toBe("ready");
    expect(faceMeta("candle").file).toContain("CandleFace.tsx");
    expect(faceMeta("candle").stream).toBe("agent/faces-candle");
    expect(DEFAULT_FACE_ID).toBe("flight");
    expect(resolveDefaultFaceId({ ...FACE_READY, flight: false })).toBe("readout");
    expect(DEFAULT_ESTIMATE_MINUTES).toBe(50);
  });

  it("catalogs one owner file per FaceId for parallel streams", () => {
    expect(FACE_CATALOG.map((entry) => entry.id)).toEqual([...FACE_IDS]);
    expect(faceMeta("hourglass").stream).toBe("agent/faces-hourglass-v2");
    expect(faceMeta("readout").file).toContain("ReadoutFace.tsx");
    expect(faceMeta("flight").readiness).toBe("ready");
    expect(faceMeta("movement").readiness).toBe("ready");
    expect(faceMeta("line").readiness).toBe("ready");
    expect(normalizeFaceId("not-a-face")).toBe("flight");
    expect(normalizeFaceId("line")).toBe("line");
  });

  it("marks which faces draw their own time left, so lock mode adds it to the rest", () => {
    for (const entry of FACE_CATALOG) {
      expect(typeof entry.showsTimeLeft).toBe("boolean");
    }
    expect(FACE_CATALOG.filter((entry) => !entry.showsTimeLeft).map((entry) => entry.id)).toEqual([
      "hourglass",
      "movement",
      "line",
      "growth",
      "garden",
    ]);
    expect(FACE_CATALOG.filter((entry) => entry.showsTimeLeft).map((entry) => entry.id)).toEqual([
      "flight",
      "readout",
      "flask",
      "candle",
    ]);
  });
});
