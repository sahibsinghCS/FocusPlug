/**
 * Great-circle geometry for the flight face, and the pick that turns a session
 * length into a real pair of airports.
 *
 * Pure and deterministic: the same session length always draws the same route,
 * so the panel and lock mode agree and the picture does not change under you
 * mid-session.
 */

import { AIRPORTS, type Airport } from "./airports";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface FlightRoute {
  from: Airport;
  to: Airport;
  km: number;
  /** Estimated block time for the real flight, in minutes. */
  minutes: number;
}

const EARTH_KM = 6371;
const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/** Cruise ~800 km/h, plus taxi, climb and descent. */
const CRUISE_KM_PER_MIN = 800 / 60;
const GROUND_MINUTES = 25;

export function toRadians(degrees: number): number {
  return degrees * RAD;
}

export function greatCircleKm(a: LatLon, b: LatLon): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function estimateMinutes(km: number): number {
  return Math.round(GROUND_MINUTES + km / CRUISE_KM_PER_MIN);
}

/** Slerp along the great circle. `t` of 0 is `a`, 1 is `b`; both exactly. */
export function interpolate(a: LatLon, b: LatLon, t: number): LatLon {
  if (!(t > 0)) {
    return { lat: a.lat, lon: a.lon };
  }
  if (t >= 1) {
    return { lat: b.lat, lon: b.lon };
  }
  const lat1 = toRadians(a.lat);
  const lon1 = toRadians(a.lon);
  const lat2 = toRadians(b.lat);
  const lon2 = toRadians(b.lon);
  const d =
    2 *
    Math.asin(
      Math.min(
        1,
        Math.sqrt(
          Math.sin((lat2 - lat1) / 2) ** 2 +
            Math.cos(lat1) * Math.cos(lat2) * Math.sin((lon2 - lon1) / 2) ** 2,
        ),
      ),
    );
  if (d === 0) {
    return { lat: a.lat, lon: a.lon };
  }
  const clamped = Math.min(1, Math.max(0, t));
  const sinD = Math.sin(d);
  const factorA = Math.sin((1 - clamped) * d) / sinD;
  const factorB = Math.sin(clamped * d) / sinD;
  const x = factorA * Math.cos(lat1) * Math.cos(lon1) + factorB * Math.cos(lat2) * Math.cos(lon2);
  const y = factorA * Math.cos(lat1) * Math.sin(lon1) + factorB * Math.cos(lat2) * Math.sin(lon2);
  const z = factorA * Math.sin(lat1) + factorB * Math.sin(lat2);
  return {
    lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * DEG,
    lon: Math.atan2(y, x) * DEG,
  };
}

/** Initial bearing from `a` to `b`, in degrees clockwise from north. */
export function bearing(a: LatLon, b: LatLon): number {
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const dLon = toRadians(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) * DEG + 360) % 360;
}

/** Stable scatter so neighbouring session lengths do not all pick one route. */
function hash(value: number): number {
  let x = Math.round(value) * 2654435761;
  x ^= x >>> 15;
  x = Math.imul(x, 2246822519);
  x ^= x >>> 13;
  return Math.abs(x);
}

/**
 * The route whose real block time sits closest to the session you asked for.
 * Short sessions have no real flight that brief, so they land on the shortest
 * hop in the set — the face never claims the timing is real, it just draws
 * where you would have got to.
 */
export function routeForMinutes(minutes: number): FlightRoute {
  const target = Number.isFinite(minutes) && minutes > 0 ? minutes : 25;
  const candidates: FlightRoute[] = [];

  for (let i = 0; i < AIRPORTS.length; i += 1) {
    for (let j = i + 1; j < AIRPORTS.length; j += 1) {
      const from = AIRPORTS[i]!;
      const to = AIRPORTS[j]!;
      const km = greatCircleKm(from, to);
      candidates.push({ from, to, km, minutes: estimateMinutes(km) });
    }
  }

  candidates.sort(
    (a, b) => Math.abs(a.minutes - target) - Math.abs(b.minutes - target) || a.km - b.km,
  );
  const pool = candidates.slice(0, 10);
  const chosen = pool[hash(target) % pool.length];
  if (!chosen) {
    throw new Error("No flight route candidates — the airport table is empty");
  }
  return chosen;
}

export function formatKm(km: number): string {
  return `${Math.round(km).toLocaleString("en-US")} km`;
}
