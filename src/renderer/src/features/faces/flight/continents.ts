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
    { lon: -1.6, lat: 49.7 },
    { lon: 1.8, lat: 51.0 },
    { lon: 3.6, lat: 51.5 },
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
  // Ireland — separate from Britain so the Irish Sea stays water
  [
    { lon: -10.48, lat: 51.9 },
    { lon: -10.2, lat: 52.15 },
    { lon: -10.05, lat: 53.15 },
    { lon: -9.95, lat: 53.8 },
    { lon: -9.55, lat: 54.3 },
    { lon: -8.67, lat: 54.3 },
    { lon: -8.18, lat: 54.62 },
    { lon: -7.31, lat: 55.23 },
    { lon: -6.95, lat: 55.2 },
    { lon: -6.03, lat: 55.06 },
    { lon: -5.47, lat: 54.49 },
    { lon: -5.88, lat: 54.21 },
    { lon: -6.27, lat: 53.58 },
    { lon: -6.07, lat: 53.2 },
    { lon: -6.36, lat: 52.17 },
    { lon: -6.95, lat: 52.09 },
    { lon: -7.6, lat: 51.9 },
    { lon: -8.4, lat: 51.68 },
    { lon: -9.5, lat: 51.45 },
    { lon: -10.2, lat: 51.57 },
    { lon: -10.48, lat: 51.9 },
  ],
  // Great Britain — west coast bites in so the Irish Sea stays a channel
  [
    { lon: -5.7, lat: 50.05 },
    { lon: -5.54, lat: 50.34 },
    { lon: -5.15, lat: 51.68 },
    { lon: -5.3, lat: 51.87 },
    { lon: -4.78, lat: 52.8 },
    { lon: -4.2, lat: 53.2 },
    { lon: -3.15, lat: 53.4 },
    { lon: -3.0, lat: 54.05 },
    { lon: -3.4, lat: 54.55 },
    { lon: -4.3, lat: 54.85 },
    { lon: -4.78, lat: 55.25 },
    { lon: -5.6, lat: 55.3 },
    { lon: -6.23, lat: 56.72 },
    { lon: -6.25, lat: 57.6 },
    { lon: -5.1, lat: 58.6 },
    { lon: -4.2, lat: 58.63 },
    { lon: -3.05, lat: 58.63 },
    { lon: -2.0, lat: 57.7 },
    { lon: -1.78, lat: 57.15 },
    { lon: -1.4, lat: 54.85 },
    { lon: -0.75, lat: 54.15 },
    { lon: 0.2, lat: 53.6 },
    { lon: 1.75, lat: 52.73 },
    { lon: 1.45, lat: 51.1 },
    { lon: 1.3, lat: 51.05 },
    { lon: 0.5, lat: 50.7 },
    { lon: -1.0, lat: 50.58 },
    { lon: -2.0, lat: 50.52 },
    { lon: -3.5, lat: 50.2 },
    { lon: -4.7, lat: 50.15 },
    { lon: -5.7, lat: 50.05 },
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

/**
 * Land coverage 0..1. `coast` uses live polygons so a zoomed DUB–EDI hop
 * keeps the Irish Sea open and coasts sharp. Never a lat/lon graticule.
 */
export function landCoverage(lat: number, lon: number, mode: "grid" | "coast" = "grid"): number {
  if (mode === "coast" || inBritishIsles(lat, lon)) {
    const here = landFromRings(lat, lon);
    const d = 0.035;
    const edge =
      (landFromRings(lat, lon + d) +
        landFromRings(lat, lon - d) +
        landFromRings(lat + d, lon) +
        landFromRings(lat - d, lon)) /
      4;
    return here * 0.72 + edge * 0.28;
  }
  return gridCoverage(lat, lon);
}
