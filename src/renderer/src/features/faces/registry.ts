import type { FaceId } from "@shared/faces";
import { FACE_READY, normalizeFaceId } from "@shared/faces";
import { CandleFace } from "./CandleFace";
import { FlaskFace } from "./FlaskFace";
import { FlightFace } from "./FlightFace";
import { GardenFace } from "./GardenFace";
import { GrowthFace } from "./GrowthFace";
import { HourglassFace } from "./HourglassFace";
import { LineFace } from "./LineFace";
import { MovementFace } from "./MovementFace";
import { ReadoutFace } from "./ReadoutFace";
import type { FaceComponent } from "./types";

export const FACE_COMPONENTS: Readonly<Record<FaceId, FaceComponent>> = {
  flight: FlightFace,
  hourglass: HourglassFace,
  readout: ReadoutFace,
  movement: MovementFace,
  line: LineFace,
  growth: GrowthFace,
  flask: FlaskFace,
  garden: GardenFace,
  candle: CandleFace,
};

export function faceComponent(id: unknown): FaceComponent {
  const resolved = normalizeFaceId(id);
  return FACE_COMPONENTS[resolved];
}

export function faceIsReady(id: FaceId): boolean {
  return FACE_READY[id] === true;
}
