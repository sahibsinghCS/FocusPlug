# Session-wiring gauntlet

Bar: **Golden-path proof** Docs → Discord → countdown → kill → return → unlock, plus **Demo Kill** instant path.

This stream owns `src/main/session/**` and main-process IPC glue. Window/desk/kill APIs are Win32-first; the orchestrator is proven with injectable monitors and a recording killer so the path does not need a Windows desktop.

## Linux / CI (this agent)

```bash
npm test
# equivalent: npx vitest run src/main/session src/shared/policy
```

Evidence dump (written by the gauntlet test):

- `src/main/session/evidence/golden-path.json`

The dump must show, in order:

1. `SESSION_START`
2. Docs/Chrome + `at_desk` → `ON_TASK`
3. Discord focus → `DISTRACTED` + `start_countdown` + live `countdownSec` 10 → 9 → …
4. Fuse elapsed → `ProcessKiller.kill` with Discord matchers (never the `*blocklist*` sentinel)
5. Return to Docs + at desk → `unlock` + `ON_TASK`
6. `DEMO_KILL` → immediate `KillResult` with non-empty matchers (not a stub)

## Windows golden path (manual — real Win32)

Do this on a Windows machine with Discord installed and a webcam.

1. Launch FocusPlug (`npm run dev` or packaged app). Confirm the UI is the real preload API (not the renderer mock).
2. Settings: countdown **10s**, **strict mode on**, desk webcam **on**.
3. Open Chrome on a Google Docs tab. Sit in frame so Desk AI reads `at_desk`.
4. Click **Start session**. Decision should go **On task**. Session log should record `session` then `decision`.
5. Alt-tab to Discord. Overlay must appear and count down (10…1). Log: `start_countdown` / `DISTRACTED`.
6. Do not switch away. When the fuse hits 0, Discord must quit. Log: `kill` with a real `KillResult` (`discord.exe (pid …)`).
7. Return to the Docs tab while at the desk. Overlay gone, decision **On task**, log: `unlock`.
8. Open Discord again. Click **Demo Kill** (home footer or overlay). Discord must quit immediately without waiting the fuse. Log: `demo`. `KillResult.killed` must not be the foundation stub.

Hard fail:

- Demo Kill returns `{ killed: [], errors: ["Process killer not wired yet …"] }`
- Countdown stays at 10 and never ticks
- Kill never runs after 10s on Discord
- Unlock does not fire after returning to Docs + at desk
- `*blocklist*` is passed into `ProcessKiller.kill`

## Notes for Linux cloud VMs

Foreground window APIs and `taskkill` are stubbed/probed. Still:

- Main process constructs `SessionController` via `createSessionRuntime`
- IPC invoke/push channels in `src/shared/ipc.ts` are fully handled (no foundation stubs)
- Default settings: `countdownSec=10`, `strictMode=true` (allowlist focus **and** `at_desk`)
