# Scripted checklist (Linux agent run)

Bar: Docs → Discord → countdown → kill → return → unlock, plus Demo Kill.

Command: `npx vitest run src/main/session`

| Step | Result |
| --- | --- |
| SESSION_START starts window + desk monitors, sessionActive=true | PASS |
| Docs/Chrome + at_desk → ON_TASK | PASS |
| Discord focus → DISTRACTED + start_countdown | PASS |
| Live countdown IPC: SessionState.countdownSec 10 → 9 → 8 | PASS |
| 250ms ticker continues countdown without new snapshots | PASS |
| Fuse elapsed → ProcessKiller.kill(["discord.exe"]); not `*blocklist*` | PASS |
| Return Docs + at_desk → unlock + ON_TASK | PASS |
| DEMO_KILL returns KillResult.killed (not foundation stub) | PASS |
| Cancel countdown if back ON_TASK before 0 | PASS |
| Desk-away expands `*blocklist*` to real matchers | PASS |
| Lists/settings/desk enable persist and affect fuse | PASS |
| Settings+log JSON round-trip on disk | PASS |
| Typecheck + window store tests | PASS |

Structured dump: `golden-path.json` (this directory).

Windows live Win32/taskkill is **not** run on this Linux VM — see `../GAUNTLET.md`.
