# Prompt — agent/process-kill

Repo: https://github.com/sahibsinghCS/FocusPlug · branch `agent/process-kill`.

## Goal
Windows process killer: terminate by process name matchers from blocklist. Never touch allowlisted study processes. Safe error reporting.

## Owns
`src/main/kill/**`

## Gauntlet bar
Documented probe: start a harmless stand-in process (or Discord if present), kill via API, verify exit. Hard fail if allowlist names can be killed. Critic checks safety invariants in code.

## Gauntlet
Loop until WIN. Commit often.

## Done
PR `process-kill: windows blocklist terminator`.

