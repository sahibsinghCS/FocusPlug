# Independent critic (faces-flight)

Blind critic. Bar: 1280×800 before/after. WIN only if AFTER reads as a photographed flight instrument at a real local time.

Plates were unlabeled (`plate-p` … `plate-t`). Critic was not told which prefix is new.

## Round 1 — LOSE

- **Selected:** AFTER (still lost the bar)
- **Largest gap:** Flat screensaver globe — knife-edge terminator, level airplane decal, no tapering contrail, doubled canvas type, 3,693 km/h strip from a 90-minute JFK–LHR clock.

## Round 2 — LOSE

- **Selected:** AFTER (still lost the bar)
- **Largest gap:** Wings-level silhouette; strip GS OCR’d as 7911 from `791 km/h`.

Fixes after R2: HTML instrument type, dusk terminator, screen-space wake, honest 420-minute block (GS ≈ 791 kph).

## Round 3 — WIN

- **Selected:** Q (instrument family). P is the flat gray disc + orange arc sticker.
- **Largest remaining ding (not a loss):** Land is still a smooth brown mask; terminator is a thin cyan band, not a photographed Earth texture.

**Why WIN:**

- Q at 16:00Z: warm gold day / indigo night / cyan twilight. R at 02:00Z flips to night with orange city lights.
- Airplane banks 15°R on Q/R and 9°R on S (one wing up, green/red tips) with a tapering wake; T is wings-level on arrival.
- Strip: JFK→LHR, remain 5318 / 2,992 / 0 km, ETA 22:43 / 19:46 / ARR, GS 791 then 0 kph.
- T pull-back + DESTINATION SETS LONDON.

**Checks:** `npx vitest run src/renderer/src/features/faces` (23) and `npm run typecheck:web` pass. Stills at 1280×800, pinned `2026-09-12T16:00:00Z` / `02:00Z`, 420-minute JFK–LHR block.
