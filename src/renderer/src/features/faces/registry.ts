import type { FaceId } from "@shared/faces";
import { FACE_READY, normalizeFaceId } from "@shared/faces";
import { CircuitFace } from "./CircuitFace";
import { DescentFace } from "./DescentFace";
import { FlightFace } from "./FlightFace";
import { GrowthFace } from "./GrowthFace";
import { HourglassFace } from "./HourglassFace";
import { LineFace } from "./LineFace";
import { MovementFace } from "./MovementFace";
import { OrbitFace } from "./OrbitFace";
import { ReadoutFace } from "./ReadoutFace";
import { RecordFace } from "./RecordFace";
import type { FaceComponent } from "./types";

export const FACE_COMPONENTS: Readonly<Record<FaceId, FaceComponent>> = {
  flight: FlightFace,
  hourglass: HourglassFace,
  readout: ReadoutFace,
  descent: DescentFace,
  movement: MovementFace,
  record: RecordFace,
  circuit: CircuitFace,
  line: LineFace,
  orbit: OrbitFace,
  growth: GrowthFace,
};

export function faceComponent(id: unknown): FaceComponent {
  const resolved = normalizeFaceId(id);
  return FACE_COMPONENTS[resolved];
}

export function faceIsReady(id: FaceId): boolean {
  return FACE_READY[id] === true;
}
