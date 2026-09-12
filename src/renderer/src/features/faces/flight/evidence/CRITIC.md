# Independent critic (faces-flight-v2)

Blind critic. Bar: 1280×800. WIN only if AFTER reads as a real flight instrument — zoomed hop, globe actually rotating, no lat/lon grid, origin and arrival user-choosable.

Plates were unlabeled (`plate-m` … `plate-r`). Critic was not told which prefix is new.

## Round 1 — WIN

- **Selected:** N, O, P, Q, R (instrument family)
- **Rejected:** M (tiny gridded DUB→EDI globe sticker)
- **Largest remaining ding (not a loss):** Disc still stages a hero airliner on matte land without ND range rings, compass rose, or a flown-track line, so it reads more like a product render in a bezel than a crew navigation display.

**Why WIN:**

- N vs O: same DUB→EDI hop, aircraft stays near center, landmasses rotate — globe is not a static sticker.
- No lat/lon graticule. Coasts and land shading only; Irish Sea stays water.
- Q: searchable IATA/city picker (origin list open).
- R: same instrument on a choosable JFK→LHR crossing (2,992 km remain, ETA 19:46, GS 791 kph).
- P: night side with city lights.
- Strip on N/O: DUB → EDI, 181 km, 16:27, 403 kph.

**Checks:** `npx vitest run src/renderer/src/features/faces/flight src/shared/flightRoute.test.ts` (36) and `npx tsc --noEmit -p tsconfig.web.json` pass.
