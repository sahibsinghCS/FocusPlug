# Flask face gauntlet

Bar: a fresh harsh critic compares the attached **COLUMN** still vs the **AFTER flask** still at **1280×800**. AFTER must clearly read as a **leaking water flask timer**, not a blue pill. WIN / LOSE only.

## Owns

- `src/renderer/src/features/faces/FlaskFace.tsx` (FaceHost registry slot)
- `src/renderer/src/features/faces/flask/**`
- `FACE_READY.flask` in `src/shared/faces.ts`

Does **not** fork FaceHost or FacePicker. Does **not** revive Column / Grid / Eclipse / Field.

## Must hold

1. Silhouette is a **glass bottle** — neck, cork, shoulders, belly, base. Not a stadium capsule.
2. Water level is **remaining** session (`1 − progress`). Emptying as time passes.
3. **Visible leak** — stream + mid-air drips from the brass valve (and a wet mouth drip when the cork is off). Not a static puddle.
4. Dark FocusPlug room. Liquid reads wet (meniscus, glass highlight). Electron-sane canvas.
5. Wired as `faceId: "flask"` through `FACE_COMPONENTS` / `FACE_READY` / FacePicker / settings blob.

## Linux / CI

```bash
npx vitest run src/renderer/src/features/faces/flask src/shared/faces.test.ts
npm run typecheck
```

Stills (isolated preview, 1280×800):

```bash
npx vite --config scripts/flask-preview.vite.ts
node src/renderer/src/features/faces/flask/stills.mjs
```

Host-mounted (FaceHost on Session):

```bash
npx vite --config scripts/renderer-preview.vite.ts
# #/?scene=live&face=flask&progress=0.62&freeze=1
```

Scenes: `?scene=leak|full|low|idle` plus `&still=1`.

## Hard fail

- Critic still reads a blue pill / column / capsule
- No visible stream or drips in the AFTER still
- Water fills the whole silhouette (no meniscus / empty glass)
- `faceId` is `column` or any retired name
