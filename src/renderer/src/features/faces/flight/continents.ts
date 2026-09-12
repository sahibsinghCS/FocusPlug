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
    { lon: -10, lat: 36 },
    { lon: -9, lat: 44 },
    { lon: -5, lat: 48 },
    { lon: -6, lat: 58 },
    { lon: 5, lat: 62 },
    { lon: 12, lat: 66 },
    { lon: 25, lat: 71 },
    { lon: 32, lat: 70 },
    { lon: 30, lat: 60 },
    { lon: 28, lat: 45 },
    { lon: 18, lat: 40 },
    { lon: 16, lat: 39 },
    { lon: 10, lat: 44 },
    { lon: 3, lat: 43 },
    { lon: -2, lat: 36 },
    { lon: -10, lat: 36 },
  ],
  [
    { lon: -10.8, lat: 51.2 },
    { lon: -8.2, lat: 55.3 },
    { lon: -6.2, lat: 58.7 },
    { lon: -1.1, lat: 60.8 },
    { lon: 1.9, lat: 52.8 },
    { lon: 1.6, lat: 50.7 },
    { lon: -5.7, lat: 49.9 },
    { lon: -10.8, lat: 51.2 },
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

export function landCoverage(lat: number, lon: number): number {
  const x = Math.min(COLS - 1, Math.max(0, Math.floor((lon + 180) / CELL)));
  const y = Math.min(ROWS - 1, Math.max(0, Math.floor((90 - lat) / CELL)));
  const here = MASK[y * COLS + x] ?? 0;
  const xm = Math.max(0, x - 1);
  const xp = Math.min(COLS - 1, x + 1);
  const ym = Math.max(0, y - 1);
  const yp = Math.min(ROWS - 1, y + 1);
  const sum =
    here +
    (MASK[y * COLS + xm] ?? 0) +
    (MASK[y * COLS + xp] ?? 0) +
    (MASK[ym * COLS + x] ?? 0) +
    (MASK[yp * COLS + x] ?? 0);
  return sum / 5;
}
