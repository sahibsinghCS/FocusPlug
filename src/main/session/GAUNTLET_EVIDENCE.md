# Gauntlet evidence (session-wiring)

Last run: **PASS** (2026-09-11T08:58:20.887Z) on linux x64, Node v22.14.0.

Command:

```bash
npx vitest run src/main/session
```

This VM is not a Windows desktop with Discord. The harness injects:

- `ScriptedWindowMonitor` (FocusSnapshot: Chrome/Docs ↔ Discord)
- `ScriptedDeskMonitor` (at_desk / away / uncertain)
- `MemoryProcessHost` (chrome, Discord, steam, explorer, Code, System, VALORANT)
- `ProcessKiller` via `createProcessKiller({ host })`
- `PolicyEngine.step` (pure, un-rewritten)

Machine-readable dump: `src/main/session/evidence/gauntlet-run.json`.
Checklist: `src/main/session/GOLDEN_PATH.md`.

All assertions passed.
