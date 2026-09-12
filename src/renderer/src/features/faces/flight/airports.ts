import {
  DEFAULT_FLIGHT_ARR,
  DEFAULT_FLIGHT_DEP,
  FLIGHT_AIRPORTS,
  FLIGHT_AIRPORT_LIST,
  normalizeFlightIata,
  requireAirport,
  searchFlightAirports,
  type FlightAirport,
} from "@shared/flightRoute";

export type { FlightAirport };
export type Airport = FlightAirport;

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface FaceSettings {
  dep?: string;
  arr?: string;
  depName?: string;
  arrName?: string;
  depLat?: number;
  depLon?: number;
  arrLat?: number;
  arrLon?: number;
}

export const AIRPORTS = FLIGHT_AIRPORTS;
export const AIRPORT_LIST = FLIGHT_AIRPORT_LIST;
export const DEFAULT_DEP = requireAirport(DEFAULT_FLIGHT_DEP);
export const DEFAULT_ARR = requireAirport(DEFAULT_FLIGHT_ARR);

export { searchFlightAirports as searchAirports };

function lookup(code: string | undefined): Airport | null {
  if (!code) return null;
  const key = code.trim().toUpperCase();
  return AIRPORTS[key] ?? null;
}

export function resolveEndpoint(
  code: string | undefined,
  name: string | undefined,
  lat: number | undefined,
  lon: number | undefined,
  fallback: Airport,
): Airport {
  const known = lookup(code);
  const hasCoords =
    typeof lat === "number" &&
    Number.isFinite(lat) &&
    typeof lon === "number" &&
    Number.isFinite(lon);
  if (known && !hasCoords) {
    return {
      ...known,
      name: name?.trim() || known.name,
    };
  }
  if (hasCoords) {
    return {
      code: (code ?? fallback.code).trim().toUpperCase().slice(0, 4) || fallback.code,
      name: name?.trim() || known?.name || fallback.name,
      lat,
      lon,
    };
  }
  if (known) return known;
  return fallback;
}

export function resolveRoute(settings: FaceSettings | undefined): {
  dep: Airport;
  arr: Airport;
} {
  const depCode = settings?.dep ? normalizeFlightIata(settings.dep, DEFAULT_DEP.code) : undefined;
  const arrCode = settings?.arr ? normalizeFlightIata(settings.arr, DEFAULT_ARR.code) : undefined;
  const dep = resolveEndpoint(
    depCode ?? settings?.dep,
    settings?.depName,
    settings?.depLat,
    settings?.depLon,
    DEFAULT_DEP,
  );
  const arr = resolveEndpoint(
    arrCode ?? settings?.arr,
    settings?.arrName,
    settings?.arrLat,
    settings?.arrLon,
    DEFAULT_ARR,
  );
  if (dep.code === arr.code && dep.lat === arr.lat && dep.lon === arr.lon) {
    return { dep, arr: dep.code === DEFAULT_ARR.code ? DEFAULT_DEP : DEFAULT_ARR };
  }
  return { dep, arr };
}

export function asPoint(airport: Airport): GeoPoint {
  return { lat: airport.lat, lon: airport.lon };
}
