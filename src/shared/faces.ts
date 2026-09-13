/** Immersive session timer faces. Persist `faceId` on `AppSettings`. */

export const FACE_IDS = [
  "flight",
  "hourglass",
  "readout",
  "movement",
  "line",
  "growth",
  "flask",
  "garden",
  "candle",
] as const;

export type FaceId = (typeof FACE_IDS)[number];

export type FacePhase = "focus" | "break" | "idle";

export type FaceReadiness = "ready" | "pending";

/**
 * Retired names — never add these to FaceId. A saved setting that still names
 * one falls back to the default face. Descent, Record, Circuit and Orbit were
 * removed from the picker on 2026-09-13.
 */
export const RETIRED_FACE_IDS = [
  "column",
  "grid",
  "eclipse",
  "field",
  "descent",
  "record",
  "circuit",
  "orbit",
] as const;
export type RetiredFaceId = (typeof RETIRED_FACE_IDS)[number];

export interface FaceMeta {
  id: FaceId;
  title: string;
  blurb: string;
  stream: string;
  file: string;
  readiness: FaceReadiness;
  /**
   * True only when the face draws its own clearly readable time-left readout:
   * full strength and at least 15px at lock size, like Flight, Readout, Flask and Candle.
   * Lock mode adds one beside the caption for every other face, so every timer
   * shows the actual time. A small or faint caption does not count.
   */
  showsTimeLeft: boolean;
}

/** Flight is the default once marked ready. */
export const FACE_READY: Readonly<Record<FaceId, boolean>> = {
  flight: true,
  hourglass: true,
  readout: true,
  movement: true,
  line: true,
  growth: true,
  flask: true,
  garden: true,
  candle: true,
};

export const FACE_CATALOG: readonly FaceMeta[] = [
  {
    id: "flight",
    title: "Flight",
    blurb: "Zoomed globe, choosable route, terminator instrument.",
    stream: "agent/faces-flight-v2",
    file: "src/renderer/src/features/faces/FlightFace.tsx",
    readiness: FACE_READY.flight ? "ready" : "pending",
    showsTimeLeft: true,
  },
  {
    id: "hourglass",
    title: "Hourglass",
    blurb: "Blown glass in a dark room. Progress is the sand that has fallen.",
    stream: "agent/faces-hourglass-v2",
    file: "src/renderer/src/features/faces/HourglassFace.tsx",
    readiness: FACE_READY.hourglass ? "ready" : "pending",
    showsTimeLeft: false,
  },
  {
    id: "readout",
    title: "Readout",
    blurb: "Monospace honest digits plus a linear progress track.",
    stream: "agent/faces-foundation",
    file: "src/renderer/src/features/faces/ReadoutFace.tsx",
    readiness: FACE_READY.readout ? "ready" : "pending",
    showsTimeLeft: true,
  },
  {
    id: "movement",
    title: "Movement",
    blurb: "Exposed calibre — mainspring, train, 4 Hz escapement.",
    stream: "agent/faces-mid",
    file: "src/renderer/src/features/faces/MovementFace.tsx",
    readiness: FACE_READY.movement ? "ready" : "pending",
    showsTimeLeft: false,
  },
  {
    id: "line",
    title: "Line",
    blurb: "Transit map — rounds, breaks, and the train.",
    stream: "agent/faces-mid",
    file: "src/renderer/src/features/faces/LineFace.tsx",
    readiness: FACE_READY.line ? "ready" : "pending",
    showsTimeLeft: false,
  },
  {
    id: "growth",
    title: "Growth",
    blurb: "Bonsai — progress reveals wood; kills wilt the same tree.",
    stream: "agent/faces-growth",
    file: "src/renderer/src/features/faces/GrowthFace.tsx",
    readiness: FACE_READY.growth ? "ready" : "pending",
    showsTimeLeft: false,
  },
  {
    id: "flask",
    title: "Flask",
    blurb: "Glass water vessel. Remaining time is the water; you can see it leak.",
    stream: "agent/faces-flask",
    file: "src/renderer/src/features/faces/FlaskFace.tsx",
    readiness: FACE_READY.flask ? "ready" : "pending",
    showsTimeLeft: true,
  },
  {
    id: "garden",
    title: "Garden",
    blurb: "Sunrise timer — night moon to a colorful garden day.",
    stream: "agent/faces-garden",
    file: "src/renderer/src/features/faces/GardenFace.tsx",
    readiness: FACE_READY.garden ? "ready" : "pending",
    showsTimeLeft: false,
  },
  {
    id: "candle",
    title: "Candle",
    blurb: "Melting beeswax timer. Elapsed burns the pillar down.",
    stream: "agent/faces-candle",
    file: "src/renderer/src/features/faces/CandleFace.tsx",
    readiness: FACE_READY.candle ? "ready" : "pending",
    showsTimeLeft: true,
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
