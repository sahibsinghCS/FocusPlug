# FocusPlug — current state

Where the product actually is, not a log of branches. Last rewritten 2026-09-13,
when the Focus Forecast branch and `main` were merged into one tree.

## What ships

A Windows Electron app that enforces a study session. The Session route has two
states — the **plan** you edit (pick one of nine faces, drag focus / break /
round dials, see the block drawn to scale and the hour you are free) and, once a
session is live, the **console** (decision hero, forecast instrument, sensor
rail, enforcement timeline). Throwing the hold switch goes past both into
**lock mode**: the face full screen, one quiet sensor line, and the fuse overlay
on top of it when enforcement fires. Hold-to-lock and hold-to-end, never a
click. A break lifts the lock on its own and hands everything back.

Lock and live are not the same thing. The lock is a *view* of a live session,
and **Console** in the lock bar steps out of it — the instruments come back and
the app chrome with them, the session keeps running and enforcement stays armed,
and **Back to lock mode** returns to the face. Ending early is still the hold
switch in lock mode, which is why the console does not offer a Stop button while
a plan owns the session. `shellView` in
`src/renderer/src/features/timer/view.ts` is the only place that decides which
of plan / lock / console is on screen.

Worth knowing before filming: while lock mode is up the forecast instrument is
not on screen, so a pre-arm shows only as the shortened fuse, the overlay's
receipt line, and the `forecast` rows in the log — press **Console** to put the
risk meter and the feature attributions back on screen mid-session.

While a focus round runs, four things decide what happens:

| Piece | Where | What it decides |
| --- | --- | --- |
| Window sensor | `src/main/window` | Foreground process + title against the allow/blocklists |
| Desk AI | `src/main/desk` | `at_desk` / `away` / `uncertain` + confidence, on-device |
| Focus Forecast | `src/shared/forecast`, `src/main/forecast` | P(drift within 30 s) at 1 Hz → nudge, or a pre-arm that shortens the fuse |
| Adaptive fuse | `src/main/session/adaptiveFuse.ts`, `src/shared/adapt` | The personalised fuse length for this drift |

The pure `PolicyEngine` (`src/shared/policy`) consumes all of it as one input
struct and returns events. It has never been changed by either model: both write
the same single field, `countdownSec`.

Consequences: force-quit of blocklist processes, an opaque full-screen kill
overlay that names its blast radius, nudges (window to the front + a line, and
a lamp on in `plugMode: "nudge"`), optional LAN smart plugs (Kasa XOR / Tapo
KLAP / generic HTTP), and a session log that keeps the causal chain. The study
PC is hard-denied at the plug layer and cannot be powered off. Demo Kill skips
the fuse for filming.

## The fuse authority (the one design decision of the merge)

`main` shipped the adaptive fuse; this branch shipped the forecast pre-arm.
Both wrote `countdownSec`. They now compose in one pure module,
`src/main/session/fuseAuthority.ts`:

```
prearmed ? clamp(round(personal × 0.5), MIN_FUSE_SEC, personal) : personal
```

- Adapt sets the **personalised base**; the forecast **scales** it toward the
  3 s floor. It never replaces it, so ordering survives a pre-arm (20 → 10 still
  beats 8 → 4) and adapt's fair-shot contract is bent, not broken. Cold install
  at the 10 s default: 10 → 5, the demo beat unchanged.
- `SessionController.resolveFuse` is the only caller. `buildPolicyInput` decides
  nothing any more; it is handed the answer.
- **The latch:** a burning countdown never changes length mid-burn, whatever
  either model says next. This closed a `main` bug where a personalised fuse
  reverted to `settings.countdownSec` on the tick after arming, so the number on
  screen and the number enforced disagreed. Several `main` timing tests were
  updated to the corrected behaviour.
- **Never throw:** the whole composition sits inside one `try` at the kill-path
  call site, falling back to the latched value or the Settings fuse. Two learned
  models reach the deterministic kill path here; if either threw, enforcement
  would stop entirely.
- **Learning-signal guard:** a pre-armed drift is not learned from
  (`adaptive.armed` is skipped), because the fuse it was granted is not the fuse
  the learner chose. The log says so: `adapt · 5s — forecast pre-armed, scaled
  from your 10s · not learned from`. Unforecast drifts are learned from as before.
- Escape hatches: `FOCUSPLUG_NO_ADAPT=1` pins the personal length to Settings;
  `forecastEnabled` / `forecastPrearmEnabled` gate the pre-arm; with both off the
  fuse is exactly `settings.countdownSec`.

Known follow-up, renderer only: the pre-arm chip on the session clock still reads
the forecast's own advisory pair (`10s → 5s`, floored by
`forecastPrearmFuseSec`), not the composed number. They agree on every install
until the adaptive model has learned a different personal length; the overlay
always counts the composed value. Reconciling the chip is UI work, not authority
work. Rationale for all of the above: `docs/RECONCILIATION.md`.

## Models, with their numbers and their caveats

- **Focus Forecast** — `mlp24-36-1`, 937-parameter tanh MLP, Platt-calibrated.
  Held out on a disjoint 900-session / 1 230-onset / 1.58 M-frame corpus:
  lead≥20 s AUC **0.9330** vs the CI gate's strongest-24-feature-logistic
  baseline 0.9259 (+0.0071, 95% CI [+0.0035, +0.0107]); ROC-AUC 0.9510, ECE
  0.0038; 70.8% of drifts warned within 30 s at 2.28 nudges/hour; 57.5%
  pre-armed at 0.42 false pre-arms/hour; median lead 16 s. **Trained and
  evaluated entirely on simulated sessions.** Rebuild: `npm run forecast:pipeline`
  (~7.5 min, offline, deterministic under `--seed`).
- **Adaptive fuse** — 17-feature logistic, online per install, cancel = positive
  / kill = negative, target recovery 0.85, floor 3 s. `npm run gauntlet:adapt`
  reports 77.5% recovered at 8.4 s waited vs the constant fuse's 69.4% at 9.4 s —
  **simulated students**; the fitted prior comes from 9,600 sampled drifts
  (`datasets/focusplug-drifts.csv`), held-out log-loss 0.6225 → 0.5600. The
  per-user model has no number until it has watched a real person drift.
- **Custom desk head** (opt-in, `deskModelId: "custom"`) — 64-32 MLP over
  BlazeFace crops + MobileNetV2 + hand-crafted descriptors. 95.16% held-out
  3-way vs 46.89% heuristic baseline; diverse-scene figure 89.44%; eval imagery
  is 3rd-person stock, the runtime camera is 1st-person.
- **Attention head** (`focused` / `unfocused` / `phone`, custom model only) —
  trained on Adaption Labs Adaptive Data annotations of 1,919 desk photos.
  **Not reliable yet.** On the original 143-image eval the first head scored
  56.6% and the shipped head 60.8%, both under the 65.7% always-`focused`
  baseline; on the current 200-image eval 64.0% (phone F1 68.5%) vs a 48.5%
  baseline, at the cost of calling "phone" on ~17% of non-phone photos. Claim
  the pipeline, never phone detection.
- **Reused, not trained here** — MediaPipe BlazeFace (default desk path) and
  MobileNetV2 α0.50/160 ImageNet features. Both local, CPU, no network.

Disclosure copy for Devpost, covering every model and every build-time
assistant: `docs/AI-DISCLOSURE.md`.

## The browser demo

`demo/` is a static page (`npm run demo:build` → `dist/demo/index.html`, opens
from `file://`) that runs the shipped forecast weights, the real feature
extractor, the real escalation reducer and the real policy engine over a
scripted 94-second session, ending in the kill decision and its lead-time
receipt. A browser tab cannot force-quit anything or cut a plug — the page
renders the decision and says so in its footer. Optional webcam mode runs the
app's own BlazeFace graph in-tab. `npm run demo:verify` is its gauntlet
(typecheck → tests → build → headless Chromium over the built page, including
off-origin request and text-clipping assertions) and writes `demo/evidence`.

## Verification

```
npm run typecheck        # contracts fence + node/web/demo tsconfigs
npm test                 # vitest suite
npm run test:kill        # node --test, real taskkill against a stand-in (Windows: 25/25)
npm run test:window      # node --test, matcher + monitor + the Win32 foreground script
npm run test:forecast    # forecast ring/features/weights/escalation/tap
npm run test:desk        # desk-vision fixture gauntlet
npm run gauntlet:adapt   # adaptive-fuse simulation
npm run demo:verify      # browser demo, end to end
npm run probe:golden     # pre-flight on the demo machine: real wiring, kills nothing
```

Stills and smoke helpers (each starts its own preview server; needs Chrome or
Chromium, `CHROME_PATH=` to point at one): `preview:renderer`, `stills:readme`,
`session:stills`, `console:stills`, `smoke:session-actions`, `faces:stills`,
`gauntlet:flight`.

Known broken by the merge, both in the renderer and both owned by the UI work,
not by the docs: `src/renderer/src/state/AppState.tsx` declares
`useOptionalAppState` twice (the whole renderer fails to compile, so
`typecheck:web` and one vitest file fail), and
`src/renderer/src/features/forecast/preview.tsx` still imports
`components/CountdownOverlay` and `session/DecisionHero`, which the Phase-4
rebuild removed — so `forecast:preview` and `forecast:stills` do not run until
those two are fixed. Nothing else on the list above is affected.

## Platform truth

- Live foreground-window read and `taskkill` are Win32 only. Linux boots the UI
  and runs every test; it cannot enforce.
- The Win32 foreground script's `$pid` collision with PowerShell's constant
  `$PID` was found and fixed independently on both sides of this merge; one
  version survives, guarded by `src/main/window/win32.test.ts`.
- Camera lifecycle fixes are in: a failed start tears the hidden window down
  instead of leaking a renderer, concurrent callers join one warm-up, and the
  `started` flag cannot stick on. So is the plug hardening — every loopback
  spelling including IPv6 is hard-denied (`src/main/plugs/protect.ts`), and a
  Kasa switch is only believed on `err_code` 0.

## Not shipping — do not claim

macOS support, cloud vision, pose or skeleton tracking, phone camera, any
hosted inference. Smart plugs ship but boot with zero configured and are
CI-verified against mocks and loopback; claim hardware only if you probed it.
Nine faces ship and both pickers (Session panel and Settings) write the same
`settings.faceId` that lock mode reads; the retired ids in `RETIRED_FACE_IDS`
normalise back to Flight. `docs/DEMO-5MIN.md` § Known traps still lists the
Settings grid as dead — that trap is stale, the rest of the list is not.
