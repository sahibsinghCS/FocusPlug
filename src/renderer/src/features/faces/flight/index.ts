import type { ComponentType } from "react";
import { registerFace, type FaceModule } from "../register";
import type { FaceProps } from "../types";
import { FlightFace } from "./FlightFace";

export const FLIGHT_FACE_ID = "flight" as const;

export const FLIGHT_FACE: FaceModule = {
  id: FLIGHT_FACE_ID,
  title: "Flight",
  component: FlightFace as ComponentType<FaceProps>,
};

registerFace(FLIGHT_FACE);

export function registerFlightFace(
  register: (mod: FaceModule) => void,
): FaceModule {
  if (typeof register !== "function") {
    throw new Error("registerFlightFace requires a registrar");
  }
  register(FLIGHT_FACE);
  return FLIGHT_FACE;
}

export { FlightFace } from "./FlightFace";
export type { FlightFaceViewProps } from "./FlightFace";
export { buildFlightModel } from "./model";
export { drawFlightFace } from "./draw";
