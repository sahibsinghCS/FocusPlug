# demo/ — the judge-facing browser build

A static page that runs the shipped Focus Forecast without Windows, Electron, or a network. Judge-facing copy lives in the root [README](../README.md#try-it-in-the-browser); this file is the map for whoever edits it next.

| Path | Role |
| --- | --- |
| `index.html` | Entry. Data-URI favicon so the page requests nothing at all. |
| `vite.config.ts` | `base: "./"`, single classic-IIFE bundle with fonts and BlazeFace weights inlined (see below), out to `dist/demo`. |
| `src/pipeline.ts` | The one loop. `TelemetryRing` → `extractFeatures` → trained GLM → `smoothRisk` → `stepEscalation`, with `stepPolicy` deciding and `effectiveFuseSec` as the only knob the forecast turns. Both modes step this. |
| `src/script.ts` | Mode 1's simulated student — a raw behaviour stream (window pokes + desk labels), never features, never a risk number. |
| `src/timeline.ts` | Precomputes the 94 s arc once and reads chapter marks off the events the model actually emitted. |
| `src/timeline.test.ts` | The demo's contract: ordering, the 5 s pre-armed fuse, one kill, a real receipt, determinism. `npm run demo:test`. |
| `src/live.ts` | Mode 2's session: `getUserMedia` + a 1 Hz tick into the same pipeline, with a status for every failure path. |
| `src/desk/detector.ts` | BlazeFace over a `<video>` frame, classified by the app's own `@main/desk/classify`. |
| `src/narrative.ts`, `src/components/*` | Demo-local layout and copy. Every instrument is a console component. |
| `src/demo.css` | The console's stylesheet, demo-only chrome, and the responsive overrides that keep the model internals readable here (see below). |
| `evidence/` | Gauntlet stills; see [evidence/README.md](evidence/README.md). |

**Nothing load-bearing is reimplemented here.** The risk model, the escalation reducer, the policy engine, the desk classifier and every on-screen instrument (`ForecastPanel`, `RiskMeter`, `InternalsPanel`, `NudgeToast`, `DecisionHero`, `SessionClock`, `SensorRail`, `CountdownOverlay`, `StatusPill`) are imported from `src/shared` and `src/renderer`. Two things are demo-local by necessity, both commented at the call site: the scripted behaviour stream, and the six lines of luma arithmetic that mirror `frameStats` (the app's copy sits in a module that also decodes JPEG/PNG through Node-only libraries). `StatusCluster` itself reads `useAppState()`, so the header composes the same three pills from the same `sessionChrome`/`deskChrome`/`plugChrome` view-models instead.

**Why `demo.css` reaches into the panel.** `InternalsPanel` puts the calibration readout beside the term-group strip and lets the readout ellipse when both cannot fit. That is a fair trade in the app — the string is one hover away — and it was drawn when the head had 16 term groups. The shipped head has 24, whose 475 px strip left the readout 248 px for a 330 px line, so the demo rendered `logit +5.26 → σ(a·z+b) a=0.70 b=−3.4…` and dropped `→ risk 0.57`: the payoff, on the page whose entire claim is that the model is legible, in a still nobody can hover. `demo.css` buys the readout its width out of the demo's own page rather than out of the instrument — `RiskMeter` caps its gauge at 280 px, so the column it sat in was carrying ~100 px of dead air — stacks the two readouts below 1240 px, and lets the four sensor tiles wrap their meta line instead of ellipsing it. The selectors hang off the components' ARIA labels and off `calibrationLine()`'s text (whose shape `model.test.ts` pins), not off utility classes, so they move with the components. `demo:stills` measures all of it: the readout has to render end to end and inside the 800 px frame, and nothing on the page may clip its own text at 1280 px or 900 px. Vertical rhythm in `App.tsx` and `Transport.tsx` is deliberately tight for the same reason — the readout is the last thing above the fold at 1280×800.

**Why the bundle is shaped oddly.** The page has to survive being double-clicked. Chrome refuses `<script type="module">` over `file://` and blocks sibling `fetch`, so the build emits one classic IIFE with `assetsInlineLimit` high enough that fonts and the 392 KB BlazeFace shard become data — one HTML file plus one JS file, which is also what makes GitHub Pages a copy-and-forget deploy. The `focusplug-blazeface-weights` plugin reads `src/main/desk/models/blazeface/` at build time and hands tfjs an `IOHandler` over the inlined bytes, which is why Mode 2 loads a real model with zero requests.

**Scripts:** `demo:dev` (port 5190) · `demo:build` → `dist/demo` · `demo:preview` · `demo:test` · `demo:stills` · `demo:verify` (all four in order). `npm run typecheck` covers this directory via `typecheck:demo`.
