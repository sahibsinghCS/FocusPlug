/** Close hop vs the whole route. Lock and settings share this; default is close. */
export type FlightMapView = "close" | "route";

export function parseFlightMapView(raw: string | null | undefined): FlightMapView {
  if (raw === "route" || raw === "whole" || raw === "map") {
    return "route";
  }
  return "close";
}

export function isFlightMapView(value: string): value is FlightMapView {
  return value === "close" || value === "route";
}
