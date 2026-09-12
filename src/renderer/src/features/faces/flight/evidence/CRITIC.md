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

## Round 2 — WIN (2026-09-12, post-rebase onto `8b496d7`)

Fresh unlabeled plates after rebase onto main (Flask #32 + Hourglass #31 + Garden #33 + Candle #35). Same v2 bar: zoomed hop, continuous orbit, no graticule, choosable route. Old Flight v1 Round 3/4 JFK–LHR WINs are historical only and do not count here.

- **Selected:** N, O, Q
- **Rejected:** M (tiny gridded DUB→EDI sticker)
- **Stills:** `before-timmy-grid-1280x800.png` vs `after-dub-edi-cruise-16z-orbit-a-1280x800.png`, `after-dub-edi-cruise-16z-orbit-b-1280x800.png`, `after-dub-edi-picker-16z-1280x800.png`
- **Largest remaining ding (not a loss):** No range scale / navaids — reads as a heading-up map porthole more than a ranging ND/EHSI.

**Why WIN:** N vs O is the same DUB→EDI hop with the aircraft centered and land rotated (not a static sticker). No lat/lon grid. Q shows a searchable IATA origin list. Strip: DUB → EDI, 181 km, 16:27, 403 kph.

**Checks after rebase:** faces + flightRoute + contracts + controller tests 142; `tsc` web + node; `check:contracts` OK. Tip `22aac32` on `8b496d7`. FACE_READY.flight/hourglass/flask/garden/candle all true. Eclipse/Field stay retired.
