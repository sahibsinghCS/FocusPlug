/**
 * Compact land coverage for the globe raster.
 * Polygons are lon/lat rings, rasterized once into a 1° grid.
 */

interface Ring {
  lon: number;
  lat: number;
}

const RINGS: Ring[][] = [
  // North America — east coast pushed into the Atlantic so NYC/Boston sit on land
  [
    { lon: -168, lat: 54 },
    { lon: -141, lat: 70 },
    { lon: -105, lat: 73 },
    { lon: -84, lat: 73 },
    { lon: -55, lat: 60 },
    { lon: -52, lat: 47 },
    { lon: -66, lat: 44 },
    { lon: -69, lat: 41 },
    { lon: -74, lat: 39 },
    { lon: -75, lat: 35 },
    { lon: -80, lat: 25 },
    { lon: -82, lat: 24 },
    { lon: -97, lat: 18 },
    { lon: -105, lat: 22 },
    { lon: -117, lat: 32 },
    { lon: -125, lat: 49 },
    { lon: -154, lat: 58 },
    { lon: -168, lat: 54 },
  ],
  [
    { lon: -117, lat: 32 },
    { lon: -97, lat: 26 },
    { lon: -87, lat: 21 },
    { lon: -83, lat: 8 },
    { lon: -77, lat: 7 },
    { lon: -83, lat: 12 },
    { lon: -92, lat: 14 },
    { lon: -105, lat: 20 },
    { lon: -117, lat: 32 },
  ],
  [
    { lon: -81, lat: 12 },
    { lon: -70, lat: 12 },
    { lon: -50, lat: 4 },
    { lon: -34, lat: -5 },
    { lon: -35, lat: -20 },
    { lon: -40, lat: -23 },
    { lon: -52, lat: -35 },
    { lon: -68, lat: -55 },
    { lon: -76, lat: -50 },
    { lon: -75, lat: -18 },
    { lon: -82, lat: -5 },
    { lon: -81, lat: 12 },
  ],
  [
    { lon: -73, lat: 76 },
    { lon: -47, lat: 83 },
    { lon: -20, lat: 80 },
    { lon: -20, lat: 70 },
    { lon: -43, lat: 60 },
    { lon: -53, lat: 64 },
    { lon: -73, lat: 76 },
  ],
  [
    { lon: -9.3, lat: 36.8 },
    { lon: -9.5, lat: 38.7 },
    { lon: -8.9, lat: 42.0 },
    { lon: -7.0, lat: 43.5 },
    { lon: -4.8, lat: 48.4 },
    { lon: -1.6, lat: 49.4 },
    { lon: 1.6, lat: 50.85 },
    { lon: 2.4, lat: 51.08 },
    { lon: 3.6, lat: 51.35 },
    { lon: 6.0, lat: 53.4 },
    { lon: 8.5, lat: 56.5 },
    { lon: 5.0, lat: 62.0 },
    { lon: 12, lat: 66 },
    { lon: 25, lat: 71 },
    { lon: 32, lat: 70 },
    { lon: 30, lat: 60 },
    { lon: 28, lat: 45 },
    { lon: 18, lat: 40 },
    { lon: 16, lat: 39 },
    { lon: 10, lat: 44 },
    { lon: 3, lat: 43 },
    { lon: -2, lat: 36.8 },
    { lon: -9.3, lat: 36.8 },
  ],
  // Ireland — diamond + west bays so Dublin/Shannon/Malin read
  [
    { lon: -9.9, lat: 51.45 },
    { lon: -10.48, lat: 51.57 },
    { lon: -10.25, lat: 51.9 },
    { lon: -10.48, lat: 52.14 },
    { lon: -9.92, lat: 52.14 },
    { lon: -9.5, lat: 52.55 },
    { lon: -9.85, lat: 53.12 },
    { lon: -10.2, lat: 53.48 },
    { lon: -10.32, lat: 53.88 },
    { lon: -10.14, lat: 54.3 },
    { lon: -9.55, lat: 54.3 },
    { lon: -8.67, lat: 54.27 },
    { lon: -8.18, lat: 54.64 },
    { lon: -7.37, lat: 55.38 },
    { lon: -6.95, lat: 55.2 },
    { lon: -6.22, lat: 55.2 },
    { lon: -5.78, lat: 55.05 },
    { lon: -5.47, lat: 54.48 },
    { lon: -5.9, lat: 54.2 },
    { lon: -6.06, lat: 54.0 },
    { lon: -6.28, lat: 53.55 },
    { lon: -6.06, lat: 53.27 },
    { lon: -6.04, lat: 52.97 },
    { lon: -6.36, lat: 52.17 },
    { lon: -6.95, lat: 52.08 },
    { lon: -7.62, lat: 51.9 },
    { lon: -8.28, lat: 51.78 },
    { lon: -8.9, lat: 51.54 },
    { lon: -9.9, lat: 51.45 },
  ],
  // Great Britain — Cornwall, Wales waist, Clyde, Moray, Wash, Kent
  [
    { lon: -5.7, lat: 50.05 },
    { lon: -5.54, lat: 50.34 },
    { lon: -5.08, lat: 50.55 },
    { lon: -4.7, lat: 50.35 },
    { lon: -4.2, lat: 51.22 },
    { lon: -3.6, lat: 51.22 },
    { lon: -4.15, lat: 51.55 },
    { lon: -5.32, lat: 51.66 },
    { lon: -5.3, lat: 51.88 },
    { lon: -4.7, lat: 52.22 },
    { lon: -4.08, lat: 52.42 },
    { lon: -4.78, lat: 52.8 },
    { lon: -4.28, lat: 53.14 },
    { lon: -4.66, lat: 53.32 },
    { lon: -3.83, lat: 53.34 },
    { lon: -3.12, lat: 53.42 },
    { lon: -3.05, lat: 53.85 },
    { lon: -2.96, lat: 54.08 },
    { lon: -3.6, lat: 54.5 },
    { lon: -3.35, lat: 54.88 },
    { lon: -4.85, lat: 54.64 },
    { lon: -5.05, lat: 54.96 },
    { lon: -4.7, lat: 55.42 },
    { lon: -5.73, lat: 55.29 },
    { lon: -5.82, lat: 55.72 },
    { lon: -6.23, lat: 56.72 },
    { lon: -6.48, lat: 57.35 },
    { lon: -5.0, lat: 58.62 },
    { lon: -4.18, lat: 58.62 },
    { lon: -3.05, lat: 58.64 },
    { lon: -3.1, lat: 58.44 },
    { lon: -3.85, lat: 57.7 },
    { lon: -3.2, lat: 57.72 },
    { lon: -1.98, lat: 57.7 },
    { lon: -1.78, lat: 57.5 },
    { lon: -2.08, lat: 57.14 },
    { lon: -2.45, lat: 56.7 },
    { lon: -2.85, lat: 56.46 },
    { lon: -3.38, lat: 56.02 },
    { lon: -2.72, lat: 56.06 },
    { lon: -2.0, lat: 55.77 },
    { lon: -1.42, lat: 55.0 },
    { lon: -0.62, lat: 54.49 },
    { lon: -0.08, lat: 54.12 },
    { lon: 0.12, lat: 53.58 },
    { lon: 0.18, lat: 53.0 },
    { lon: 0.42, lat: 52.82 },
    { lon: 1.75, lat: 52.76 },
    { lon: 1.76, lat: 52.48 },
    { lon: 1.32, lat: 51.46 },
    { lon: 1.45, lat: 51.38 },
    { lon: 1.38, lat: 51.12 },
    { lon: 0.96, lat: 50.91 },
    { lon: 0.22, lat: 50.73 },
    { lon: -0.78, lat: 50.72 },
    { lon: -1.35, lat: 50.57 },
    { lon: -2.45, lat: 50.51 },
    { lon: -3.64, lat: 50.22 },
    { lon: -4.16, lat: 50.3 },
    { lon: -5.2, lat: 49.96 },
    { lon: -5.7, lat: 50.05 },
  ],
  // Isle of Man — keeps the Irish Sea from reading as one puddle
  [
    { lon: -4.78, lat: 54.04 },
    { lon: -4.66, lat: 54.42 },
    { lon: -4.31, lat: 54.4 },
    { lon: -4.31, lat: 54.05 },
    { lon: -4.78, lat: 54.04 },
  ],
  [
    { lon: -17, lat: 21 },
    { lon: -13, lat: 32 },
    { lon: -6, lat: 36 },
    { lon: 10, lat: 37 },
    { lon: 25, lat: 32 },
    { lon: 32, lat: 31 },
    { lon: 44, lat: 11 },
    { lon: 51, lat: 12 },
    { lon: 51, lat: -1 },
    { lon: 40, lat: -11 },
    { lon: 35, lat: -35 },
    { lon: 18, lat: -35 },
    { lon: 11, lat: -17 },
    { lon: 8, lat: 4 },
    { lon: -14, lat: 4 },
    { lon: -17, lat: 14 },
    { lon: -17, lat: 21 },
  ],
  [
    { lon: 43.5, lat: -12 },
    { lon: 50.5, lat: -15 },
    { lon: 47.5, lat: -25.5 },
    { lon: 43.2, lat: -25 },
    { lon: 43.5, lat: -12 },
  ],
  [
    { lon: 32, lat: 31 },
    { lon: 35, lat: 36 },
    { lon: 44, lat: 40 },
    { lon: 48, lat: 30 },
    { lon: 56, lat: 27 },
    { lon: 60, lat: 22 },
    { lon: 57, lat: 16 },
    { lon: 43, lat: 12 },
    { lon: 39, lat: 21 },
    { lon: 32, lat: 31 },
  ],
  [
    { lon: 28, lat: 45 },
    { lon: 40, lat: 48 },
    { lon: 60, lat: 54 },
    { lon: 75, lat: 73 },
    { lon: 110, lat: 76 },
    { lon: 140, lat: 73 },
    { lon: 170, lat: 70 },
    { lon: 180, lat: 65 },
    { lon: 160, lat: 60 },
    { lon: 142, lat: 50 },
    { lon: 135, lat: 35 },
    { lon: 122, lat: 30 },
    { lon: 120, lat: 22 },
    { lon: 109, lat: 18 },
    { lon: 100, lat: 7 },
    { lon: 78, lat: 8 },
    { lon: 68, lat: 23 },
    { lon: 60, lat: 25 },
    { lon: 48, lat: 36 },
    { lon: 40, lat: 40 },
    { lon: 28, lat: 45 },
  ],
  [
    { lon: 68, lat: 23 },
    { lon: 78, lat: 8 },
    { lon: 80, lat: 6 },
    { lon: 87, lat: 21 },
    { lon: 92, lat: 22 },
    { lon: 88, lat: 26 },
    { lon: 74, lat: 32 },
    { lon: 68, lat: 23 },
  ],
  [
    { lon: 129.5, lat: 33 },
    { lon: 131, lat: 31 },
    { lon: 141, lat: 35 },
    { lon: 145.8, lat: 43 },
    { lon: 141, lat: 45.5 },
    { lon: 139.5, lat: 35.5 },
    { lon: 129.5, lat: 33 },
  ],
  [
    { lon: 8, lat: 44 },
    { lon: 13.5, lat: 38 },
    { lon: 18.5, lat: 40.2 },
    { lon: 15, lat: 42 },
    { lon: 12.5, lat: 45.5 },
    { lon: 8, lat: 44 },
  ],
  [
    { lon: 113, lat: -22 },
    { lon: 129, lat: -12 },
    { lon: 142, lat: -11 },
    { lon: 153, lat: -25 },
    { lon: 150, lat: -38 },
    { lon: 115, lat: -35 },
    { lon: 113, lat: -22 },
  ],
  [
    { lon: 166, lat: -46.6 },
    { lon: 172.8, lat: -34.4 },
    { lon: 178.6, lat: -37.5 },
    { lon: 170.5, lat: -47.3 },
    { lon: 166, lat: -46.6 },
  ],
  [
    { lon: 95, lat: 5 },
    { lon: 108, lat: -8 },
    { lon: 130, lat: -8 },
    { lon: 140, lat: -2 },
    { lon: 125, lat: 12 },
    { lon: 119, lat: 18 },
    { lon: 105, lat: 8 },
    { lon: 95, lat: 5 },
  ],
  [
    { lon: -85, lat: 23 },
    { lon: -74, lat: 23.5 },
    { lon: -68, lat: 18.4 },
    { lon: -78, lat: 17.5 },
    { lon: -85, lat: 23 },
  ],
  [
    { lon: -24.5, lat: 63.4 },
    { lon: -13.5, lat: 65.2 },
    { lon: -13.6, lat: 66.5 },
    { lon: -24, lat: 66.4 },
    { lon: -24.5, lat: 63.4 },
  ],
];

const COLS = 360;
const ROWS = 180;
const CELL = 1;

function pointInRing(lon: number, lat: number, ring: Ring[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (!a || !b) continue;
    const intersect =
      a.lat > lat !== b.lat > lat &&
      lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat + 1e-12) + a.lon;
    if (intersect) inside = !inside;
  }
  return inside;
}

function buildMask(): Uint8Array {
  const mask = new Uint8Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y += 1) {
    const lat = 90 - (y + 0.5) * CELL;
    for (let x = 0; x < COLS; x += 1) {
      const lon = -180 + (x + 0.5) * CELL;
      if (lat < -62) {
        mask[y * COLS + x] = 1;
        continue;
      }
      for (const ring of RINGS) {
        if (pointInRing(lon, lat, ring)) {
          mask[y * COLS + x] = 1;
          break;
        }
      }
    }
  }
  return mask;
}

const MASK = buildMask();

function sampleMask(x: number, y: number): number {
  const xi = Math.min(COLS - 1, Math.max(0, x));
  const yi = Math.min(ROWS - 1, Math.max(0, y));
  return MASK[yi * COLS + xi] ?? 0;
}

function gridCoverage(lat: number, lon: number): number {
  const fx = (lon + 180) / CELL - 0.5;
  const fy = (90 - lat) / CELL - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const v00 = sampleMask(x0, y0);
  const v10 = sampleMask(x0 + 1, y0);
  const v01 = sampleMask(x0, y0 + 1);
  const v11 = sampleMask(x0 + 1, y0 + 1);
  return v00 * (1 - tx) * (1 - ty) + v10 * tx * (1 - ty) + v01 * (1 - tx) * ty + v11 * tx * ty;
}

function landFromRings(lat: number, lon: number): number {
  if (lat < -62) return 1;
  for (const ring of RINGS) {
    if (pointInRing(lon, lat, ring)) return 1;
  }
  return 0;
}

const BI_BOX = { lon0: -12.2, lon1: 2.6, lat0: 49.2, lat1: 59.4 };

function inBritishIsles(lat: number, lon: number): boolean {
  return lon >= BI_BOX.lon0 && lon <= BI_BOX.lon1 && lat >= BI_BOX.lat0 && lat <= BI_BOX.lat1;
}

export function coastRings(): ReadonlyArray<ReadonlyArray<Ring>> {
  return RINGS;
}

/**
 * Land coverage 0..1. `coast` uses live polygons so a zoomed DUB–EDI hop
 * keeps the Irish Sea open and coasts sharp. Never a lat/lon graticule.
 */
export function landCoverage(lat: number, lon: number, mode: "grid" | "coast" = "grid"): number {
  if (mode === "coast" || inBritishIsles(lat, lon)) {
    const here = landFromRings(lat, lon);
    const d = inBritishIsles(lat, lon) ? 0.012 : 0.03;
    const edge =
      (landFromRings(lat, lon + d) +
        landFromRings(lat, lon - d) +
        landFromRings(lat + d, lon) +
        landFromRings(lat - d, lon)) /
      4;
    return here * 0.9 + edge * 0.1;
  }
  return gridCoverage(lat, lon);
}
