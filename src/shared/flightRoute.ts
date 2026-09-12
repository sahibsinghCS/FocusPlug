/** Curated IATA catalog for the Flight face. Persist codes on AppSettings. */

export interface FlightAirport {
  code: string;
  name: string;
  lat: number;
  lon: number;
}

export const DEFAULT_FLIGHT_DEP = "DUB";
export const DEFAULT_FLIGHT_ARR = "EDI";

export const FLIGHT_AIRPORTS: Record<string, FlightAirport> = {
  DUB: { code: "DUB", name: "Dublin", lat: 53.4264, lon: -6.2499 },
  EDI: { code: "EDI", name: "Edinburgh", lat: 55.95, lon: -3.3725 },
  GLA: { code: "GLA", name: "Glasgow", lat: 55.8719, lon: -4.4331 },
  MAN: { code: "MAN", name: "Manchester", lat: 53.3537, lon: -2.275 },
  BHD: { code: "BHD", name: "Belfast", lat: 54.6181, lon: -5.8725 },
  ORK: { code: "ORK", name: "Cork", lat: 51.8413, lon: -8.4911 },
  SNN: { code: "SNN", name: "Shannon", lat: 52.702, lon: -8.9248 },
  LHR: { code: "LHR", name: "London", lat: 51.47, lon: -0.4543 },
  LGW: { code: "LGW", name: "London", lat: 51.1537, lon: -0.1821 },
  STN: { code: "STN", name: "London", lat: 51.886, lon: 0.2389 },
  LON: { code: "LON", name: "London", lat: 51.5074, lon: -0.1278 },
  AMS: { code: "AMS", name: "Amsterdam", lat: 52.3105, lon: 4.7683 },
  CDG: { code: "CDG", name: "Paris", lat: 49.0097, lon: 2.5479 },
  ORY: { code: "ORY", name: "Paris", lat: 48.7262, lon: 2.3652 },
  BRU: { code: "BRU", name: "Brussels", lat: 50.9014, lon: 4.4844 },
  FRA: { code: "FRA", name: "Frankfurt", lat: 50.0379, lon: 8.5622 },
  MUC: { code: "MUC", name: "Munich", lat: 48.3538, lon: 11.7861 },
  DUS: { code: "DUS", name: "Dusseldorf", lat: 51.2895, lon: 6.7668 },
  ZRH: { code: "ZRH", name: "Zurich", lat: 47.4647, lon: 8.5492 },
  VIE: { code: "VIE", name: "Vienna", lat: 48.1103, lon: 16.5697 },
  CPH: { code: "CPH", name: "Copenhagen", lat: 55.618, lon: 12.656 },
  OSL: { code: "OSL", name: "Oslo", lat: 60.1939, lon: 11.1004 },
  ARN: { code: "ARN", name: "Stockholm", lat: 59.6498, lon: 17.9238 },
  HEL: { code: "HEL", name: "Helsinki", lat: 60.3172, lon: 24.9633 },
  MAD: { code: "MAD", name: "Madrid", lat: 40.4983, lon: -3.5676 },
  BCN: { code: "BCN", name: "Barcelona", lat: 41.2974, lon: 2.0833 },
  LIS: { code: "LIS", name: "Lisbon", lat: 38.7742, lon: -9.1342 },
  FCO: { code: "FCO", name: "Rome", lat: 41.8003, lon: 12.2389 },
  MXP: { code: "MXP", name: "Milan", lat: 45.6306, lon: 8.7281 },
  ATH: { code: "ATH", name: "Athens", lat: 37.9364, lon: 23.9445 },
  WAW: { code: "WAW", name: "Warsaw", lat: 52.1657, lon: 20.9671 },
  PRG: { code: "PRG", name: "Prague", lat: 50.1008, lon: 14.26 },
  BUD: { code: "BUD", name: "Budapest", lat: 47.4394, lon: 19.2618 },
  IST: { code: "IST", name: "Istanbul", lat: 41.2753, lon: 28.7519 },
  DXB: { code: "DXB", name: "Dubai", lat: 25.2532, lon: 55.3657 },
  DOH: { code: "DOH", name: "Doha", lat: 25.2731, lon: 51.6081 },
  JFK: { code: "JFK", name: "New York", lat: 40.6413, lon: -73.7781 },
  LGA: { code: "LGA", name: "New York", lat: 40.7769, lon: -73.874 },
  EWR: { code: "EWR", name: "Newark", lat: 40.6895, lon: -74.1745 },
  NYC: { code: "NYC", name: "New York", lat: 40.7128, lon: -74.006 },
  BOS: { code: "BOS", name: "Boston", lat: 42.3656, lon: -71.0096 },
  ORD: { code: "ORD", name: "Chicago", lat: 41.9742, lon: -87.9073 },
  ATL: { code: "ATL", name: "Atlanta", lat: 33.6407, lon: -84.4277 },
  MIA: { code: "MIA", name: "Miami", lat: 25.7959, lon: -80.287 },
  DFW: { code: "DFW", name: "Dallas", lat: 32.8998, lon: -97.0403 },
  LAX: { code: "LAX", name: "Los Angeles", lat: 33.9416, lon: -118.4085 },
  SFO: { code: "SFO", name: "San Francisco", lat: 37.6213, lon: -122.379 },
  SEA: { code: "SEA", name: "Seattle", lat: 47.4502, lon: -122.3088 },
  YYZ: { code: "YYZ", name: "Toronto", lat: 43.6777, lon: -79.6248 },
  YVR: { code: "YVR", name: "Vancouver", lat: 49.1967, lon: -123.1815 },
  MEX: { code: "MEX", name: "Mexico City", lat: 19.4361, lon: -99.0719 },
  GRU: { code: "GRU", name: "Sao Paulo", lat: -23.4356, lon: -46.4731 },
  EZE: { code: "EZE", name: "Buenos Aires", lat: -34.8222, lon: -58.5358 },
  JNB: { code: "JNB", name: "Johannesburg", lat: -26.1392, lon: 28.246 },
  CAI: { code: "CAI", name: "Cairo", lat: 30.1219, lon: 31.4056 },
  DEL: { code: "DEL", name: "Delhi", lat: 28.5562, lon: 77.1 },
  BOM: { code: "BOM", name: "Mumbai", lat: 19.0896, lon: 72.8656 },
  SIN: { code: "SIN", name: "Singapore", lat: 1.3644, lon: 103.9915 },
  HKG: { code: "HKG", name: "Hong Kong", lat: 22.308, lon: 113.9185 },
  NRT: { code: "NRT", name: "Tokyo", lat: 35.772, lon: 140.3929 },
  HND: { code: "HND", name: "Tokyo", lat: 35.5494, lon: 139.7798 },
  ICN: { code: "ICN", name: "Seoul", lat: 37.4602, lon: 126.4407 },
  PEK: { code: "PEK", name: "Beijing", lat: 40.0799, lon: 116.6031 },
  PVG: { code: "PVG", name: "Shanghai", lat: 31.1443, lon: 121.8083 },
  SYD: { code: "SYD", name: "Sydney", lat: -33.9399, lon: 151.1753 },
  MEL: { code: "MEL", name: "Melbourne", lat: -37.6733, lon: 144.8433 },
};

export const FLIGHT_AIRPORT_LIST: readonly FlightAirport[] = Object.values(FLIGHT_AIRPORTS).sort(
  (a, b) => a.code.localeCompare(b.code),
);

export function isFlightIata(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const key = value.trim().toUpperCase();
  return Object.hasOwn(FLIGHT_AIRPORTS, key);
}

export function requireAirport(code: string): FlightAirport {
  const found = FLIGHT_AIRPORTS[code.trim().toUpperCase()];
  if (!found) {
    throw new Error(`Unknown flight airport ${code}`);
  }
  return found;
}

export function normalizeFlightIata(value: unknown, fallback: string): string {
  if (isFlightIata(value)) {
    return value.trim().toUpperCase();
  }
  return fallback;
}

export function searchFlightAirports(query: string): FlightAirport[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...FLIGHT_AIRPORT_LIST];
  }
  return FLIGHT_AIRPORT_LIST.filter((airport) => {
    return (
      airport.code.toLowerCase().includes(needle) || airport.name.toLowerCase().includes(needle)
    );
  });
}

export function normalizeFlightPair(
  dep: unknown,
  arr: unknown,
): { flightDep: string; flightArr: string } {
  const flightDep = normalizeFlightIata(dep, DEFAULT_FLIGHT_DEP);
  let flightArr = normalizeFlightIata(arr, DEFAULT_FLIGHT_ARR);
  if (flightDep === flightArr) {
    flightArr = flightDep === DEFAULT_FLIGHT_ARR ? DEFAULT_FLIGHT_DEP : DEFAULT_FLIGHT_ARR;
  }
  return { flightDep, flightArr };
}
