/**
 * Regenerates `src/renderer/src/assets/land.json` — the coastlines the flight
 * face draws its globe from.
 *
 *   node scripts/build-land.mjs
 *
 * Source is Natural Earth 1:110m land, via world-atlas. The renderer CSP is
 * `default-src 'self'` and the product is local-first, so the map ships in the
 * bundle rather than being fetched from a tile server at runtime. Output is a
 * flat [lon, lat, lon, lat, …] array per ring, rounded to one decimal (~11 km,
 * which is finer than a 400px globe can draw anyway).
 */
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const SOURCE = "https://cdn.jsdelivr.net/npm/world-atlas@2/land-110m.json";
const OUT = resolve("src/renderer/src/assets/land.json");
/** Rings smaller than this are specks at globe scale — drop them. */
const MIN_POINTS = 6;

const response = await fetch(SOURCE);
if (!response.ok) {
  throw new Error(`Could not fetch ${SOURCE}: ${response.status}`);
}
const topology = await response.json();
const { scale, translate } = topology.transform;

/** TopoJSON arcs are delta-encoded and quantised; walk them back to lon/lat. */
function decodeArc(index) {
  const reversed = index < 0;
  const arc = topology.arcs[reversed ? ~index : index];
  let x = 0;
  let y = 0;
  const points = arc.map(([dx, dy]) => {
    x += dx;
    y += dy;
    return [x * scale[0] + translate[0], y * scale[1] + translate[1]];
  });
  return reversed ? points.reverse() : points;
}

function ringFor(arcIndexes) {
  const points = [];
  for (const index of arcIndexes) {
    const arc = decodeArc(index);
    // Consecutive arcs repeat the shared vertex.
    points.push(...(points.length > 0 ? arc.slice(1) : arc));
  }
  return points;
}

const rings = [];
for (const geometry of topology.objects.land.geometries) {
  const polygons = geometry.type === "Polygon" ? [geometry.arcs] : geometry.arcs;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      const points = ringFor(ring);
      if (points.length < MIN_POINTS) {
        continue;
      }
      const flat = [];
      for (const [lon, lat] of points) {
        flat.push(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10);
      }
      rings.push(flat);
    }
  }
}

rings.sort((a, b) => b.length - a.length);
await writeFile(OUT, JSON.stringify({ rings }), "utf8");

const points = rings.reduce((sum, ring) => sum + ring.length / 2, 0);
console.log(`${OUT}\n${rings.length} rings · ${points} points`);
