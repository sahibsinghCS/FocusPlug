# Prompt — agent/ui-shell

Repo: https://github.com/sahibsinghCS/FocusPlug · branch `agent/ui-shell` from latest main (after foundation merged, or from main if foundation already present).

## Goal
Polished dark study UI: Session home with Start/Stop, live cards for Window / Desk AI / Decision, countdown overlay, Demo Kill (danger), Allowlist/Blocklist/Settings/Log routes. Tailwind, product-quality — not science fair.

## Owns
`src/renderer/**` only. Consume IPC types from `src/shared/ipc.ts`. Mock IPC if main not ready.

## Gauntlet bar
Side-by-side vs a serious dark productivity app aesthetic (Linear/Raycast-level density). Critic does blind "which looks more shippable for Devpost screenshots?". Must show all live status affordances + Demo Kill. WIN only if countdown overlay is unmistakable.

## Gauntlet
Fresh harsh critic each round; fix largest gap; loop until WIN. Commit often.

## Done
PR `ui-shell: polished session UI + overlays`.

