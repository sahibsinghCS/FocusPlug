# Prompt — agent/window-monitor

Repo: https://github.com/sahibsinghCS/FocusPlug · branch `agent/window-monitor`.

## Goal
Windows foreground window monitor producing `FocusSnapshot` per CONTRACTS. Allowlist/blocklist matching. Persistence of lists via Store seam.

## Owns
`src/main/window/**` (+ store helpers if missing under `src/main/store/**` for lists only).

## Gauntlet bar
With Discord focused, snapshot.matchedBlock===true within 1s; with Chrome/Docs focused, matchedAllow===true. Unit tests or a small CLI probe script documenting the proof. Critic inspects code + test/probe output only.

## Gauntlet
Loop until WIN. Commit often.

## Done
PR `window-monitor: focus snapshots + list matching`.

