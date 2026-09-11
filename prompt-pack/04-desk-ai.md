# Prompt — agent/desk-ai

Repo: https://github.com/sahibsinghCS/FocusPlug · branch `agent/desk-ai`.

## Goal
Load-bearing on-device desk presence: webcam + lightweight model (MediaPipe face/pose or equivalent) → `DeskSnapshot` {at_desk|away|uncertain, confidence}. Enable/disable webcam. Visible for Hyperbloom AI/ML rubric.

## Owns
`src/main/desk/**`

## Gauntlet bar
Live run (or recorded fixture frames): covering camera / leaving frame yields `away` or `uncertain` (not stuck `at_desk`); facing camera yields `at_desk` with confidence ≥ threshold. Critic sees raw labels over time — not builder claims. Fake random labels = automatic LOSE.

## Gauntlet
Loop until WIN. Commit often.

## Done
PR `desk-ai: on-device desk presence monitor`.

