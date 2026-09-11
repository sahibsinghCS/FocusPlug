# Prompt — agent/foundation

You are a cloud coding agent on https://github.com/sahibsinghCS/FocusPlug.
Model expectation: Grok 4.6 extra high effort.

## Goal
Scaffold a Windows-first Electron + Vite + React + Tailwind + TypeScript app with shared contracts from `docs/CONTRACTS.md`. Commit often on branch `agent/foundation`.

## Deliverables
- package.json scripts: `dev`, `build`, `start`
- Electron main process bootstrap
- Vite React renderer shell (placeholder pages OK)
- `src/shared/types.ts` + `src/shared/ipc.ts` exactly matching docs/CONTRACTS.md
- Default allow/block lists constants
- README run instructions for Windows
- App launches (`npm install && npm run dev` or documented equivalent)

## Out of scope
Real window monitoring, desk AI, killing, polished final UI

## Gauntlet
**Bar:** A cold `npm install && npm run dev` brings up an Electron window showing placeholder "FocusPlug" chrome; TypeScript compiles; `types.ts` matches CONTRACTS.
Run gauntlet: fresh critic must WIN against that bar. Loop until WIN. Commit after each meaningful fix.

## Done
PR into main titled `foundation: electron scaffold + shared contracts`.

