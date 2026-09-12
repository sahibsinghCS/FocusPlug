/**
 * Sixty real airports, enough to find a plausible route for any session
 * length the dials allow. Coordinates are the field itself, not the city
 * centre, so the great-circle distances come out close to published ones.
 */

export interface Airport {
  iata: string;
  city: string;
  lat: number;
  lon: number;
}

export const AIRPORTS: readonly Airport[] = [
  { iata: "LHR", city: "London", lat: 51.47, lon: -0.45 },
  { iata: "CDG", city: "Paris", lat: 49.01, lon: 2.55 },
  { iata: "AMS", city: "Amsterdam", lat: 52.31, lon: 4.76 },
  { iata: "FRA", city: "Frankfurt", lat: 50.03, lon: 8.56 },
  { iata: "MAD", city: "Madrid", lat: 40.47, lon: -3.56 },
  { iata: "BCN", city: "Barcelona", lat: 41.3, lon: 2.08 },
  { iata: "FCO", city: "Rome", lat: 41.8, lon: 12.25 },
  { iata: "MUC", city: "Munich", lat: 48.35, lon: 11.79 },
  { iata: "ZRH", city: "Zurich", lat: 47.46, lon: 8.55 },
  { iata: "VIE", city: "Vienna", lat: 48.11, lon: 16.57 },
  { iata: "CPH", city: "Copenhagen", lat: 55.62, lon: 12.66 },
  { iata: "ARN", city: "Stockholm", lat: 59.65, lon: 17.92 },
  { iata: "OSL", city: "Oslo", lat: 60.19, lon: 11.1 },
  { iata: "HEL", city: "Helsinki", lat: 60.32, lon: 24.96 },
  { iata: "DUB", city: "Dublin", lat: 53.42, lon: -6.27 },
  { iata: "EDI", city: "Edinburgh", lat: 55.95, lon: -3.37 },
  { iata: "LIS", city: "Lisbon", lat: 38.77, lon: -9.13 },
  { iata: "ATH", city: "Athens", lat: 37.94, lon: 23.95 },
  { iata: "IST", city: "Istanbul", lat: 41.28, lon: 28.73 },
  { iata: "KEF", city: "Reykjavik", lat: 63.99, lon: -22.61 },
  { iata: "WAW", city: "Warsaw", lat: 52.17, lon: 20.97 },
  { iata: "PRG", city: "Prague", lat: 50.1, lon: 14.26 },

  { iata: "JFK", city: "New York", lat: 40.64, lon: -73.78 },
  { iata: "BOS", city: "Boston", lat: 42.36, lon: -71.01 },
  { iata: "IAD", city: "Washington", lat: 38.95, lon: -77.46 },
  { iata: "ATL", city: "Atlanta", lat: 33.64, lon: -84.43 },
  { iata: "ORD", city: "Chicago", lat: 41.98, lon: -87.9 },
  { iata: "DFW", city: "Dallas", lat: 32.9, lon: -97.04 },
  { iata: "DEN", city: "Denver", lat: 39.86, lon: -104.67 },
  { iata: "LAX", city: "Los Angeles", lat: 33.94, lon: -118.41 },
  { iata: "SFO", city: "San Francisco", lat: 37.62, lon: -122.38 },
  { iata: "SEA", city: "Seattle", lat: 47.45, lon: -122.31 },
  { iata: "LAS", city: "Las Vegas", lat: 36.08, lon: -115.15 },
  { iata: "MIA", city: "Miami", lat: 25.8, lon: -80.29 },
  { iata: "YYZ", city: "Toronto", lat: 43.68, lon: -79.63 },
  { iata: "YVR", city: "Vancouver", lat: 49.19, lon: -123.18 },
  { iata: "MEX", city: "Mexico City", lat: 19.44, lon: -99.07 },

  { iata: "GRU", city: "Sao Paulo", lat: -23.43, lon: -46.47 },
  { iata: "EZE", city: "Buenos Aires", lat: -34.82, lon: -58.54 },
  { iata: "BOG", city: "Bogota", lat: 4.7, lon: -74.15 },
  { iata: "LIM", city: "Lima", lat: -12.02, lon: -77.11 },
  { iata: "SCL", city: "Santiago", lat: -33.39, lon: -70.79 },

  { iata: "HND", city: "Tokyo", lat: 35.55, lon: 139.78 },
  { iata: "ICN", city: "Seoul", lat: 37.46, lon: 126.44 },
  { iata: "PEK", city: "Beijing", lat: 40.08, lon: 116.58 },
  { iata: "PVG", city: "Shanghai", lat: 31.14, lon: 121.81 },
  { iata: "HKG", city: "Hong Kong", lat: 22.31, lon: 113.91 },
  { iata: "SIN", city: "Singapore", lat: 1.36, lon: 103.99 },
  { iata: "BKK", city: "Bangkok", lat: 13.69, lon: 100.75 },
  { iata: "KUL", city: "Kuala Lumpur", lat: 2.75, lon: 101.71 },
  { iata: "DEL", city: "Delhi", lat: 28.56, lon: 77.1 },
  { iata: "BOM", city: "Mumbai", lat: 19.09, lon: 72.87 },
  { iata: "DXB", city: "Dubai", lat: 25.25, lon: 55.36 },
  { iata: "DOH", city: "Doha", lat: 25.27, lon: 51.61 },

  { iata: "SYD", city: "Sydney", lat: -33.95, lon: 151.18 },
  { iata: "MEL", city: "Melbourne", lat: -37.67, lon: 144.84 },
  { iata: "AKL", city: "Auckland", lat: -37.01, lon: 174.79 },

  { iata: "JNB", city: "Johannesburg", lat: -26.14, lon: 28.25 },
  { iata: "CPT", city: "Cape Town", lat: -33.97, lon: 18.6 },
  { iata: "CAI", city: "Cairo", lat: 30.12, lon: 31.41 },
  { iata: "NBO", city: "Nairobi", lat: -1.32, lon: 36.93 },
  { iata: "LOS", city: "Lagos", lat: 6.58, lon: 3.32 },
  { iata: "CMN", city: "Casablanca", lat: 33.37, lon: -7.59 },
];
