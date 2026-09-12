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
  it("owns the ten live FaceIds and refuses retired names", () => {
    expect([...FACE_IDS]).toEqual([
      "flight",
      "hourglass",
      "readout",
      "descent",
      "movement",
      "record",
      "circuit",
      "line",
      "orbit",
      "growth",
    ]);
    expect([...RETIRED_FACE_IDS]).toEqual(["column", "grid", "eclipse", "field"]);
    for (const id of RETIRED_FACE_IDS) {
      expect(isFaceId(id)).toBe(false);
      expect(isRetiredFaceId(id)).toBe(true);
      expect(normalizeFaceId(id)).toBe("readout");
    }
  });

  it("defaults to readout until Flight is marked ready", () => {
    expect(FACE_READY.flight).toBe(false);
    expect(DEFAULT_FACE_ID).toBe("readout");
    expect(resolveDefaultFaceId({ ...FACE_READY, flight: true })).toBe("flight");
    expect(DEFAULT_ESTIMATE_MINUTES).toBe(50);
  });

  it("catalogs one owner file per FaceId for parallel streams", () => {
    expect(FACE_CATALOG.map((entry) => entry.id)).toEqual([...FACE_IDS]);
    expect(faceMeta("hourglass").stream).toBe("agent/faces-foundation");
    expect(faceMeta("readout").file).toContain("ReadoutFace.tsx");
    expect(faceMeta("flight").readiness).toBe("pending");
    expect(normalizeFaceId("not-a-face")).toBe("readout");
    expect(normalizeFaceId("orbit")).toBe("orbit");
  });
});
