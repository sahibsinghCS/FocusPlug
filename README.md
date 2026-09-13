# FocusPlug

**A focus timer that can actually make you keep it.** Pick how the time should look — a flight crossing a globe, an hourglass, a draining column, a grid burning down, an eclipse, a dimming room, or a plain clock — set how long, and hold the switch. While the session runs FocusPlug watches the foreground window and, through an on-device AI, whether you are still in the chair. Drift and it force-quits Discord and the games.

> Every other focus timer asks you to keep the promise. This one keeps it for you. Never kills the study PC.

Homework is open. Discord is where the session actually happens. Students know the pattern: a Docs tab for the screenshot, a game or chat client for the hours. Ordinary focus apps lose that fight because all they do is count. They cannot see that you tabbed to Discord. They cannot see that you left the chair. After a week the ding is just another notification to dismiss.

FocusPlug keeps the timer and adds the part that was missing: consequences.

You open the panel, choose a face from seven live previews running side by side, set the length, and hold the switch to enter **lock mode**. Rounds and breaks are there if you want them — presets for 25/5, 50/10 and 15/3, or your own numbers — but the default is one unbroken block, and a ribbon only appears once there is more than one round to draw.

You allowlist the assignment — Chrome, Google Docs, Word, VS Code, Notion — and blocklist the usual leaks: Discord, Steam, Epic, common games. While a focus round runs, two sensors decide whether you are still on the work. On a break the lock lifts on its own and everything is handed back, which is what makes the next round bearable.

The first sensor is the focused window: process name and title, matched against those lists. The second is Desk AI — an on-device MediaPipe BlazeFace model on the webcam. It emits `at_desk`, `away`, or `uncertain` with a confidence score. Frames stay on the machine. No cloud vision API. Uncertain is a first-class label: the policy will not start a desk-only kill on a maybe.

That presence signal is load-bearing, not a dashboard widget. Session off is observe-only. Session on plus a blocked window starts a ten-second fuse, then FocusPlug force-quits the blocked process. High-confidence desk-away starts the same fuse and kills running blocklist apps even if Discord is only in the background. Return to an allowlisted window while you are actually at the desk and the session unlocks; recover before zero and the countdown cancels. Default strict mode will not call you **On task** unless both the window and the body are on the assignment.

The default face is **Flight**. Your session becomes a real one: a fifty-minute block is Dubai to Doha, two hours is Shanghai to Hong Kong, and the aircraft lands the moment you are done. The route is picked by matching the great-circle block time to the length you set, out of sixty real airports, and it is the same route every time for a given length. The globe is drawn from Natural Earth coastlines bundled into the app and projected on a canvas — no map tiles, no API key, no request leaves the machine, which is the only way a globe belongs in a local-first product.

Lock mode is the whole screen: the face you picked running out, and one quiet line proving the sensors are awake. Drift and the room floods crimson with an opaque kill overlay that names exactly what is about to die. A **Demo Kill** control skips the fuse so a two-minute film can show the consequence without waiting on Discord, and the session log keeps the causal chain. We never power off the study PC. We never tutor. The product is the kill — and the AI is what makes the kill honest when you walk away.

Optional LAN smart plugs (TP-Link Kasa local protocol, or generic HTTP POST on/off) can sit on **secondary fun devices only**. Add a plug by LAN IP; **Demo Kill will cut it**. Both TP-Link dialects work: legacy Kasa (HS103/KP105-class) needs nothing, and **Tapo** (P100/P105/P110/P110M, recent Kasa firmware) speaks KLAP — set `FOCUSPLUG_TAPO_USERNAME` / `FOCUSPLUG_TAPO_PASSWORD` and it is used automatically. `npm run mock:plug` and `npm run mock:tapo` test both paths without hardware. The study PC is hard-denied (names like `study-pc`, localhost, empty address; `isStudyPc` is always `false`). Plugs are optional — the app boots with none. No cloud account. Setup and probe steps: [docs/SMART-PLUGS.md](docs/SMART-PLUGS.md).

**Run (Windows, Node 22.12+):** `git clone https://github.com/sahibsinghCS/FocusPlug.git && cd FocusPlug && npm install && npm run dev`. Live window match and `taskkill` are Win32; Linux can boot the UI. On the demo machine run `npm run probe:golden` first — it drives the real wiring against your focused window and fails loudly if the sensor is dead (it can never kill anything). `npm run probe:window:live` shows the raw sensor as you alt-tab; `npm run test:kill` performs a real `taskkill` on a harmless stand-in. Film the 2–3 min golden path in [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md). Paste AI tools into Devpost from [docs/AI-DISCLOSURE.md](docs/AI-DISCLOSURE.md). Electron + React + Tailwind. MIT. Hyperbloom September (due 14 Sep 2026, 5:00pm EDT).

**Swap the desk model:** default is on-device BlazeFace (`deskModelId: "blazeface"`). To drop in your own, edit only `src/main/desk/model/your-model.ts` (`infer()`), then set `deskModelId` to `"custom"`. Guide: [docs/MODEL-SEAM.md](docs/MODEL-SEAM.md).

Stills below are the real UI rendered on seeded demo state (`npm run preview:renderer`, then `npm run stills:readme`), not a live session. The film in [docs/DEMO-SCRIPT.md](docs/DEMO-SCRIPT.md) is the live run.

![Session panel — seven faces, live, and the hour you are free](docs/screenshots/01-session-panel.png)

![Lock mode — your session as a real flight](docs/screenshots/02-lock-flight.png)

![Kill overlay — the Discord fuse, and what it takes with it](docs/screenshots/03-kill-overlay.png)

![Lock mode — the same session as an hourglass](docs/screenshots/04-lock-hourglass.png)

![Session log — countdown, kill, unlock](docs/screenshots/05-session-log.png)
