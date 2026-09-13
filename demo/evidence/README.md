# Browser demo stills

1280×800 PNGs captured by `npm run demo:stills` (`scripts/demo-stills.mjs`) against the **built** output in `dist/demo`, served from a throwaway static host — not the dev server. Regenerate with `npm run demo:verify`, which also typechecks, runs `demo/src/timeline.test.ts` and rebuilds first.

| Still | Scene |
| --- | --- |
| `demo-initial-1280x800.png` | `?t=3&freeze=1` — session start: Decision live, meter ghosted through the 15 s warm-up |
| `demo-mid-rise-1280x800.png` | `?t=37&freeze=1` — risk 46 %, 24 attributions, term-group strip, and `logit +5.26 → σ(a·z+b) a=0.70 b=−3.41 → risk 0.57` end to end inside the frame |
| `demo-nudge-1280x800.png` | `?t=40&freeze=1` — sustained above the nudge threshold: toast, zero enforcement |
| `demo-prearm-1280x800.png` | `?t=59&freeze=1` — pre-armed: fuse plate reads `FUSE 10s → 5s`, still no violation |
| `demo-kill-receipt-1280x800.png` | `?t=69&freeze=1` — the policy engine burning the shortened fuse, with the lead-time receipt |
| `demo-unlocked-1280x800.png` | `?t=76&freeze=1` — unlocked, sparkline showing nudge ▲ / pre-arm ◆ / drift ✖ |
| `demo-file-url-1280x800.png` | the same bundle opened as `file:///…/dist/demo/index.html` |
| `demo-live-denied-1280x800.png` | Mode 2 with the camera refused — it explains itself and Mode 1 is untouched |
| `demo-live-fuse-1280x800.png` | Mode 2 with Chromium's synthetic camera: no face ⇒ `away` ⇒ a real policy countdown |
| `demo-live-panel-1280x800.png` | Mode 2 panel: bundled BlazeFace reading the live frame, no network |

The two `live-*` stills come from a second Chromium launched with `--use-fake-device-for-media-stream`. Its rolling test pattern flickers between "no face" and a low-probability blob, which is why that run exercises the policy's uncertainty rule (`uncertain` cancels a desk-only fuse instead of killing on a maybe) as well as the away path.

Every scene that shows the panel is also measured, not just photographed: the calibration readout must render end to end (`scrollWidth ≤ clientWidth`) and lie wholly inside the 800 px frame, and no element anywhere on the page may be hiding part of its own text at 1280 px or 900 px. Those assertions exist because an earlier cut of this page shipped the readout ellipsed to `… b=−3.4…` at every width and below the fold in the very still that shows risk climbing.

There is no `before-*` set: this surface is new.
