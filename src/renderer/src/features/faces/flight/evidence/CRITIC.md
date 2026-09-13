# Independent critic (flight-simple-perf)

Blind critic. Bar: 1280×800. WIN only if AFTER is the simple in-flight plate — low-poly terrain, centered plane, huge session remaining clock, cheap draw — and beats the laggy globe.

Plates were compared as BEFORE (globe / bezel instrument) vs AFTER (close map, whole map, lock).

## Round 1 — WIN

- **Selected:** AFTER close cruise, AFTER whole-map, AFTER lock
- **Rejected:** BEFORE globe bezel (`before-dub-edi-cruise-16z-orbit-a-1280x800.png`)
- **Largest remaining ding (not a loss):** Whole-map plane is a bit chunky on the path; close-view silhouette is slimmer than the reference icon. Terrain facets are readable but calmer than the reference plate.

**Why WIN:**

- AFTER close reads as the reference energy: low-poly green, river, plane above a huge remaining clock. 50-minute sit at 46% shows **0:27:00**, not a fake 10h hop.
- Strip is honest: 181 km left, 403 kph (< 1000), 23m studied, arrives 16:27.
- Whole-map toggle shows DUB → EDI with the plane partway along the corridor. Lock stills prove the same clock + no Origin/Arrival boxes. Lock remaining **0:49:59** on a 50-minute sit.
- Draw path is cached 2D triangles (≤ 360), not a per-frame globe raster / terminator / city lights.

**Checks:** `npx vitest run src/renderer/src/features/faces/flight src/shared/flightRoute.test.ts` and `npx tsc --noEmit -p tsconfig.web.json` pass.
