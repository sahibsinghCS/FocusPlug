# FocusPlug

**Local study-session enforcer.** Detects when you leave the assignment (foreground window + on-device AI desk presence), force-quits Discord and games, and unlocks only when you are back on task.

> Not a tutor. Not a Pomodoro. Never kills the study PC.

Homework is open. Discord is where the session actually happens. Students know the pattern: a Docs tab for the screenshot, a game or chat client for the hours. Focus timers lose that fight because they only measure time. They cannot see that you tabbed to Discord. They cannot see that you left the chair. After a week the notification is just another badge to dismiss.

FocusPlug is a local Windows enforcer for a real study session. You allowlist the assignment — Chrome, Google Docs, Word, VS Code, Notion — and blocklist the usual leaks: Discord, Steam, Epic, common games. When a session is live, two sensors decide whether you are still on the work.

The first sensor is the focused window: process name and title, matched against those lists. The second is Desk AI — an on-device MediaPipe BlazeFace model on the webcam. It emits `at_desk`, `away`, or `uncertain` with a confidence score. Frames stay on the machine. No cloud vision API. Uncertain is a first-class label: the policy will not start a desk-only kill on a maybe.

That presence signal is load-bearing, not a dashboard widget. Session off is observe-only. Session on plus a blocked window starts a ten-second fuse, then FocusPlug force-quits the blocked process. High-confidence desk-away starts the same fuse and kills running blocklist apps even if Discord is only in the background. Return to an allowlisted window while you are actually at the desk and the session unlocks; recover before zero and the countdown cancels. Default strict mode will not call you **On task** unless both the window and the body are on the assignment.

The interface is an enforcement console, not a wellness tracker: live Decision (On task / Distracted / Away / Idle), window and Desk AI readouts, an opaque kill overlay, a session event log, and a **Demo Kill** control so a two-minute film can show the consequence without waiting on Discord. We never power off the study PC. We never tutor. The product is the kill — and the AI is what makes the kill honest when you walk away.

Optional LAN smart plugs (TP-Link Kasa local protocol, or generic HTTP POST on/off) can sit on **secondary fun devices only**. Add a Kasa by LAN IP; **Demo Kill will cut it**. The study PC is hard-denied (names like `study-pc`, localhost, empty address; `isStudyPc` is always `false`). Plugs are optional — the app boots with none. No cloud account. Setup and probe steps: [docs/SMART-PLUGS.md](docs/SMART-PLUGS.md).

**Run (Windows, Node 22.12+):** `git clone https://github.com/sahibsinghCS/FocusPlug.git && cd FocusPlug && npm install && npm run dev`. Live window match and `taskkill` are Win32; Linux can boot the UI. Film the 2–3 min golden path in [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md). Paste AI tools into Devpost from [docs/AI-DISCLOSURE.md](docs/AI-DISCLOSURE.md). Electron + React + Tailwind. MIT. Hyperbloom September (due 14 Sep 2026, 5:00pm EDT).

## Try it in the browser

`npm run demo:build` writes a static page to `dist/demo`. Open `dist/demo/index.html` directly — it is one HTML file and one classic script with the fonts and model weights inlined, so it runs from `file://`, from `python3 -m http.server`, or from GitHub Pages without configuration (`base` is `./`, no module scripts, no sibling fetches). `npm run demo:dev` serves the same page from source on port 5190. It needs neither Windows nor an Electron install, and it makes no network requests at all.

The page runs the shipped Focus Forecast against a simulated study session: a scripted stream of window-focus and desk events — writing in Docs, then tab flicking and grey-app loiter, then Discord — feeds the real telemetry ring, the real feature extractor, the real trained `weights.json`, the real escalation reducer and the real `src/shared/policy` engine, in that order, in the tab. The student is the only fabricated part; there is no place in the code to put a canned risk number. The arc is 94 seconds at 1x (there is a 2x toggle, a scrub bar and chapter marks): the risk meter climbs with its 24 feature attributions and the `logit → Platt → risk` line visible, a nudge fires with no enforcement, the student complies and the needle decays, a harder ramp earns a pre-arm that shortens the fuse from 10 s to 5 s before any violation exists, the policy engine classifies Discord and burns that shortened fuse, the kill overlay carries the lead-time receipt, and returning to the assignment unlocks the session. The beat timings are not scripted — they are wherever the shipped 937-parameter net actually fires on that stream, which is why swapping the model moves them. A browser tab cannot force-quit a process or cut a plug, so what you see at the end is the policy engine's kill decision and its targets — the Windows app is what executes them. The page says so in its own footer.

An optional second mode swaps the scripted desk sensor for your webcam and runs the app's own MediaPipe BlazeFace graph on-device (the weights are inlined in the bundle, so this is still offline). Cover the lens or leave the frame and presence drops, strict mode stops calling you on task, Decision flips to Away and the same policy fuse starts. It is opt-in and fails soft: a declined permission, a missing camera, or a `file://` page — which cannot ask for one — leaves the scripted run untouched and prints why. Use `http://localhost` or https for this mode.

`npm run demo:verify` is the gauntlet: typecheck, the timeline's own tests, a production build, then headless Chromium against the built output asserting that the beats render, that nothing is requested off-origin (including the BlazeFace weights), that there are no console errors, that the page does not scroll horizontally at 900 px, that `file://` boots, and that the webcam mode initialises the model and drives a real countdown. Legibility is measured rather than assumed: the `logit → σ(a·z+b) → risk` readout must render end to end and sit inside the 800 px frame in every scene that shows the panel, and no text anywhere on the page may be clipped by its own overflow at 1280 px or 900 px — a `title` attribute is not a defence, because nobody hovers a screenshot. It writes the stills in [demo/evidence](demo/evidence).

![Pre-arm — the fuse shortens before the violation](demo/evidence/demo-prearm-1280x800.png)

**Swap the desk model:** default is on-device BlazeFace (`deskModelId: "blazeface"`). To drop in your own, edit only `src/main/desk/model/your-model.ts` (`infer()`), then set `deskModelId` to `"custom"`. Guide: [docs/MODEL-SEAM.md](docs/MODEL-SEAM.md).

![On task — Desk AI at desk](docs/screenshots/01-on-task.png)

![Kill overlay — Discord fuse](docs/screenshots/02-kill-overlay.png)

![Desk AI away — covered lens](docs/screenshots/03-desk-away.png)

![Session log — countdown, kill, unlock](docs/screenshots/04-session-log.png)

![Demo Kill footer](docs/screenshots/05-demo-kill.png)
