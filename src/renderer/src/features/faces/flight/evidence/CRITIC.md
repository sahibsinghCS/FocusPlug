# Independent critic (faces-flight)

Blind critic. Bar: 1280×800 before/after. WIN only if AFTER reads as a photographed flight instrument at a real local time.

Plates were unlabeled (`plate-p` … `plate-u`). Critic was not told which prefix is new.

## Round 1 — LOSE

- **Selected:** AFTER (still lost the bar)
- **Largest gap:** Flat screensaver globe — knife-edge terminator, level airplane decal, no tapering contrail, doubled canvas type, 3,693 km/h strip from a 90-minute JFK–LHR clock.

## Round 2 — LOSE

- **Selected:** AFTER (still lost the bar)
- **Largest gap:** Wings-level silhouette; strip GS OCR’d as 7911 from `791 km/h`.

## Round 3 — WIN

- **Selected:** Q (instrument family). P is the flat gray disc + orange arc sticker.
- **Largest remaining ding (not a loss):** Land is still a smooth brown mask; terminator is a thin cyan band, not a photographed Earth texture.

## Round 4 — WIN (rebase onto FaceHost)

Foundation merged (`4fab72d`). Flight stub replaced. Fresh unlabeled plates including host chrome (`plate-u`).

- **Selected:** Q
- **Host check:** U is the same banked globe + strip inside FocusPlug session chrome, not a pending silhouette.
- **Largest remaining ding (not a loss):** Continents stay matte cutouts under a cyan terminator.

**Why WIN:**

- Q at 16:00Z: warm gold day / indigo night / cyan twilight. R at 02:00Z flips to night with orange city lights.
- Airplane banks 15°R on Q/R and 9°R on S with a tapering wake; T is wings-level on arrival + DESTINATION SETS LONDON.
- Strip: JFK→LHR, remain 5318 / 2,992 / 0 km, ETA 22:43 / 19:46 / ARR, GS 791 then 0 kph.

**Checks:** `npm test` (279) and `npm run typecheck:web` / `typecheck:node` pass. Default `AppSettings.faceId` is `flight`.
