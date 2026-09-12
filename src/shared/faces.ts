/** Immersive session timer faces. Persist `faceId` on `AppSettings`. */

export const FACE_IDS = [
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
] as const;

export type FaceId = (typeof FACE_IDS)[number];

export type FacePhase = "focus" | "break" | "idle";

export type FaceReadiness = "ready" | "pending";

/** Retired names — never add these to FaceId. */
export const RETIRED_FACE_IDS = ["column", "grid", "eclipse", "field"] as const;
export type RetiredFaceId = (typeof RETIRED_FACE_IDS)[number];

export interface FaceMeta {
  id: FaceId;
  title: string;
  blurb: string;
  stream: string;
  file: string;
  readiness: FaceReadiness;
}

/**
 * Flip `flight` to ready when `FlightFace.tsx` is merged.
 * Default face is `flight` once that lands, otherwise `readout`.
 */
export const FACE_READY: Readonly<Record<FaceId, boolean>> = {
  flight: false,
  hourglass: true,
  readout: true,
  descent: true,
  movement: false,
  record: false,
  circuit: true,
  line: false,
  orbit: true,
  growth: true,
};

export const FACE_CATALOG: readonly FaceMeta[] = [
  {
    id: "flight",
    title: "Flight",
    blurb: "Terminator / ETA instrument — destination clock.",
    stream: "agent/faces-flight",
    file: "src/renderer/src/features/faces/FlightFace.tsx",
    readiness: FACE_READY.flight ? "ready" : "pending",
  },
  {
    id: "hourglass",
    title: "Hourglass",
    blurb: "Flipped sand in a dark room. Progress is transfer.",
    stream: "agent/faces-foundation",
    file: "src/renderer/src/features/faces/HourglassFace.tsx",
    readiness: FACE_READY.hourglass ? "ready" : "pending",
  },
  {
    id: "readout",
    title: "Readout",
    blurb: "Monospace honest digits plus a linear progress track.",
    stream: "agent/faces-foundation",
    file: "src/renderer/src/features/faces/ReadoutFace.tsx",
    readiness: FACE_READY.readout ? "ready" : "pending",
  },
  {
    id: "descent",
    title: "Descent",
    blurb: "Deep-sea timer. Progress sinks sunlight → abyssal.",
    stream: "agent/faces-descent",
    file: "src/renderer/src/features/faces/DescentFace.tsx",
    readiness: FACE_READY.descent ? "ready" : "pending",
  },
  {
    id: "movement",
    title: "Movement",
    blurb: "Seismic trace of focus, drift, and kills.",
    stream: "agent/faces-movement",
    file: "src/renderer/src/features/faces/MovementFace.tsx",
    readiness: FACE_READY.movement ? "ready" : "pending",
  },
  {
    id: "record",
    title: "Record",
    blurb: "Groove / disc — a session you can watch spin.",
    stream: "agent/faces-record",
    file: "src/renderer/src/features/faces/RecordFace.tsx",
    readiness: FACE_READY.record ? "ready" : "pending",
  },
  {
    id: "circuit",
    title: "Circuit",
    blurb: "Session fuse plate. Current charges the kill rail.",
    stream: "agent/faces-circuit",
    file: "src/renderer/src/features/faces/CircuitFace.tsx",
    readiness: FACE_READY.circuit ? "ready" : "pending",
  },
  {
    id: "line",
    title: "Line",
    blurb: "Horizon instrument — remaining as distance.",
    stream: "agent/faces-line",
    file: "src/renderer/src/features/faces/LineFace.tsx",
    readiness: FACE_READY.line ? "ready" : "pending",
  },
  {
    id: "orbit",
    title: "Orbit",
    blurb: "Five bodies, integer turns. Alignment is the lock.",
    stream: "agent/faces-orbit",
    file: "src/renderer/src/features/faces/OrbitFace.tsx",
    readiness: FACE_READY.orbit ? "ready" : "pending",
  },
  {
    id: "growth",
    title: "Growth",
    blurb: "Bonsai — progress reveals wood; kills wilt the same tree.",
    stream: "agent/faces-growth",
    file: "src/renderer/src/features/faces/GrowthFace.tsx",
    readiness: FACE_READY.growth ? "ready" : "pending",
  },
];

export function isFaceId(value: unknown): value is FaceId {
  return typeof value === "string" && (FACE_IDS as readonly string[]).includes(value);
}

export function isRetiredFaceId(value: unknown): value is RetiredFaceId {
  return typeof value === "string" && (RETIRED_FACE_IDS as readonly string[]).includes(value);
}

export function resolveDefaultFaceId(ready: Readonly<Record<FaceId, boolean>> = FACE_READY): FaceId {
  return ready.flight ? "flight" : "readout";
}

export const DEFAULT_FACE_ID: FaceId = resolveDefaultFaceId();

export function normalizeFaceId(value: unknown): FaceId {
  if (isRetiredFaceId(value)) {
    return DEFAULT_FACE_ID;
  }
  return isFaceId(value) ? value : DEFAULT_FACE_ID;
}

export function faceMeta(id: FaceId): FaceMeta {
  const found = FACE_CATALOG.find((entry) => entry.id === id);
  if (!found) {
    throw new Error(`Unknown face id: ${id}`);
  }
  return found;
}

/** Visual block length when the session has no explicit estimate. */
export const DEFAULT_ESTIMATE_MINUTES = 50;
