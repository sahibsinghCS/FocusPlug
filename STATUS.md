# FocusPlug MVP

## Status (2026-09-11T09:12Z)
- **Foundation** merged to `main` (PR #1).
- **window-monitor** merged to `main` (PR #4). Critic WIN.
- **process-kill** merged to `main` (PR #2). Critic WIN (25/25).
- **desk-ai** merged to `main` (PR #6). Critic WIN.
- **policy-engine** merged to `main` (PR #5). Critic WIN.
- **ui-shell** merged to `main` (PR #3). Critic WIN.
- **session-wiring** merged to `main` (PR #7). Critic WIN.
- **polish-hyperbloom** ready for review — PR #9 `polish: Hyperbloom packaging` on `agent/polish-hyperbloom` (undrafted, MERGEABLE). Owns README + `docs/DEMO-SCRIPT.md` + `docs/AI-DISCLOSURE.md` + this file. App logic untouched.

## polish-hyperbloom gauntlet (Hyperbloom judge)

Bar: Impact / AI-ML / Demo clarity. Blind A/B vs a weak Pomodoro/focus-timer README. Ours must win as enforcement + on-device desk presence (kill is the consequence). README 200–500 words. Demo script 2–3 min filmable golden path. AI disclosure template. Screenshot placeholders.

| Round | Verdict | Largest gap |
| --- | --- | --- |
| 1 | LOSE | Screenshot names were prose only — no `![alt](path.png)` slots |
| 2 | **WIN** | none |

Round 2 inspectable facts:
- `README.md` whitespace-splits to **476** words (inside 200–500). Lead + “Not a Pomodoro.” Desk AI labels `at_desk` / `away` / `uncertain` as a kill input.
- Blind A/B: **B wins** — local allowlist/blocklist enforcer (window + Desk AI → fuse → force-quit). A is a timer with a decorative smiling webcam buddy.
- `docs/DEMO-SCRIPT.md` timed **2:00–3:00**: Docs → Discord overlay countdown → kill → return/unlock → cover-camera Away → Demo Kill.
- `docs/AI-DISCLOSURE.md` separates in-product MediaPipe BlazeFace/TFJS from build-time Cursor Cloud Agents; `⟦ ⟧` are team blanks, not an empty stub.
- Five markdown slots `docs/screenshots/01-on-task.png` … `05-demo-kill.png` in README (stills table in the demo script). PNGs are filming leftovers, not a packaging fail.

Exit: WIN. Do not merge from this stream; PR is undrafted for human review.
