# FocusPlug

**Local study-session enforcer** — detects when you leave the assignment (window + AI desk presence), force-quits Discord/games, and unlocks only when you’re back on task.

> Not a tutor chatbot. Not a gentle reminder app. Never kills the study PC.

## Run on Windows

Prerequisites: [Node.js 22.12+](https://nodejs.org/) (includes npm).

```powershell
git clone https://github.com/sahibsinghCS/FocusPlug.git
cd FocusPlug
npm install
npm run dev
```

That cold install + `npm run dev` starts Vite and opens an **Electron** window titled FocusPlug (placeholder chrome until the UI/session streams land).

| Script | What it does |
| --- | --- |
| `npm run dev` | Electron + Vite HMR (daily development) |
| `npm run build` | Typecheck + production compile into `out/` |
| `npm start` | Launch the production build (`electron-vite preview`) |
| `npm run typecheck` | Verify `src/shared/types.ts` matches `docs/CONTRACTS.md` and `tsc` passes |

Windows-first: foreground window matching and process kill land in later workstreams. The Linux Chromium sandbox is disabled in the main process so the same `npm run dev` path can boot in VMs/containers.

## Golden path (90s demo)

1. **Start session** with Google Docs / Chrome on the allowlist  
2. Open **Discord**  
3. UI shows **Distracted: Discord** + desk status + **10s countdown**  
4. Discord is **force-quit / blocked**  
5. Return to Docs + at desk → **Unlocked**  
6. Big **Demo Kill** button for reliable filming  

## MVP features

- Session start / stop  
- Editable **allowlist** (study apps) and **blocklist** (Discord, Steam, games)  
- Focused-window detector  
- **AI desk-presence** (webcam + on-device model) — load-bearing for Hyperbloom / SPEED  
- Countdown before kill (default 10s; cancels if back on task)  
- Unlock on return  
- Demo Kill  
- Session event log  
- Polished dark UI  

### Stretch
- Smart-plug kill for *secondary* fun devices only (never the study PC)  
- Mac parity  

## Stack

Windows-first **Electron + Vite + React + Tailwind + TypeScript**. Shared types and IPC live in `src/shared/` (`docs/CONTRACTS.md`). Local JSON persistence in Electron `userData` (wired in later streams).

## AI tools disclosure

*(Fill before Hyperbloom submit — list models, APIs, and coding assistants used.)*

## Demo script (2–3 min)

1. Problem (students “study” with Discord open) — 10s  
2. Live golden path — 60–90s  
3. One line: “AI decides at-desk vs away; the kill is the consequence” — 15s  
4. What’s next — 10s  

## Hackathon note

Primary submit: **Hyperbloom September** (Sep 14, 2026 @ 5:00pm EDT), then Education ML multi-submit rooms. In-window commits + AI disclosure required.

## License

MIT
