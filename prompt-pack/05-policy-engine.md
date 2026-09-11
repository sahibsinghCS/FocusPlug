# Prompt — agent/policy-engine

Repo: https://github.com/sahibsinghCS/FocusPlug · branch `agent/policy-engine`.

## Goal
Pure `PolicyEngine.step(input) → PolicyEvent[]` implementing MVP policy in docs/MVP.md + CONTRACTS. Heavy unit tests (happy, distract, away, uncertain, cancel countdown, strict mode).

## Owns
`src/shared/policy/**` and tests only.

## Gauntlet bar
Table-driven tests covering: OFF no kill; blocked→countdown→kill; return cancels; uncertain no desk-only kill; strict mode requires both. Critic reviews tests + code blind. Any missing critical case = LOSE.

## Gauntlet
Loop until WIN. Commit often.

## Done
PR `policy-engine: pure policy + tests`.

