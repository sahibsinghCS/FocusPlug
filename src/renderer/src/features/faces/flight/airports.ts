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

export interface Airport {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export const AIRPORTS: Record<string, Airport> = {
  JFK: { code: "JFK", name: "New York", lat: 40.6413, lon: -73.7781 },
  LGA: { code: "LGA", name: "New York", lat: 40.7769, lon: -73.874 },
  EWR: { code: "EWR", name: "Newark", lat: 40.6895, lon: -74.1745 },
  NYC: { code: "NYC", name: "New York", lat: 40.7128, lon: -74.006 },
  LHR: { code: "LHR", name: "London", lat: 51.47, lon: -0.4543 },
  LGW: { code: "LGW", name: "London", lat: 51.1537, lon: -0.1821 },
  LON: { code: "LON", name: "London", lat: 51.5074, lon: -0.1278 },
  BOS: { code: "BOS", name: "Boston", lat: 42.3656, lon: -71.0096 },
  ORD: { code: "ORD", name: "Chicago", lat: 41.9742, lon: -87.9073 },
  LAX: { code: "LAX", name: "Los Angeles", lat: 33.9416, lon: -118.4085 },
  SFO: { code: "SFO", name: "San Francisco", lat: 37.6213, lon: -122.379 },
  SEA: { code: "SEA", name: "Seattle", lat: 47.4502, lon: -122.3088 },
  MIA: { code: "MIA", name: "Miami", lat: 25.7959, lon: -80.287 },
  CDG: { code: "CDG", name: "Paris", lat: 49.0097, lon: 2.5479 },
  AMS: { code: "AMS", name: "Amsterdam", lat: 52.3105, lon: 4.7683 },
  FRA: { code: "FRA", name: "Frankfurt", lat: 50.0379, lon: 8.5622 },
  MAD: { code: "MAD", name: "Madrid", lat: 40.4983, lon: -3.5676 },
  FCO: { code: "FCO", name: "Rome", lat: 41.8003, lon: 12.2389 },
  DXB: { code: "DXB", name: "Dubai", lat: 25.2532, lon: 55.3657 },
  DEL: { code: "DEL", name: "Delhi", lat: 28.5562, lon: 77.1 },
  NRT: { code: "NRT", name: "Tokyo", lat: 35.772, lon: 140.3929 },
  HND: { code: "HND", name: "Tokyo", lat: 35.5494, lon: 139.7798 },
  ICN: { code: "ICN", name: "Seoul", lat: 37.4602, lon: 126.4407 },
  PEK: { code: "PEK", name: "Beijing", lat: 40.0799, lon: 116.6031 },
  PVG: { code: "PVG", name: "Shanghai", lat: 31.1443, lon: 121.8083 },
  HKG: { code: "HKG", name: "Hong Kong", lat: 22.308, lon: 113.9185 },
  SIN: { code: "SIN", name: "Singapore", lat: 1.3644, lon: 103.9915 },
  SYD: { code: "SYD", name: "Sydney", lat: -33.9399, lon: 151.1753 },
};

function requireAirport(code: keyof typeof AIRPORTS): Airport {
  const found = AIRPORTS[code];
  if (!found) {
    throw new Error(`Missing airport preset ${code}`);
  }
  return found;
}

export const DEFAULT_DEP = requireAirport("JFK");
export const DEFAULT_ARR = requireAirport("LHR");

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
  const dep = resolveEndpoint(
    settings?.dep,
    settings?.depName,
    settings?.depLat,
    settings?.depLon,
    DEFAULT_DEP,
  );
  const arr = resolveEndpoint(
    settings?.arr,
    settings?.arrName,
    settings?.arrLat,
    settings?.arrLon,
    DEFAULT_ARR,
  );
  return { dep, arr };
}

export function asPoint(airport: Airport): GeoPoint {
  return { lat: airport.lat, lon: airport.lon };
}
