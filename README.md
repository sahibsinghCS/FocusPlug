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

**Swap the desk model:** default is on-device BlazeFace (`deskModelId: "blazeface"`). To drop in your own, edit only `src/main/desk/model/your-model.ts` (`infer()`), then set `deskModelId` to `"custom"`. Guide: [docs/MODEL-SEAM.md](docs/MODEL-SEAM.md).

![On task — Desk AI at desk](docs/screenshots/01-on-task.png)

![Kill overlay — Discord fuse](docs/screenshots/02-kill-overlay.png)

![Desk AI away — covered lens](docs/screenshots/03-desk-away.png)

![Session log — countdown, kill, unlock](docs/screenshots/04-session-log.png)

![Demo Kill footer](docs/screenshots/05-demo-kill.png)
