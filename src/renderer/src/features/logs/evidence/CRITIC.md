# logs-demo-story critic

**Verdict:** WIN  
**Blind A/B:** Variant A = pre-Phase-3 flat Session log (clock | KIND | truncated detail, single filter box). Variant B = this branch’s causal timeline + 90s path. Critic was not told which was new.

**Bar:** Fresh harsh critic at 1280×800 (DevTools closed, 100% zoom) picks which log a judge can read as sensor → decision → countdown → kill/plug off → unlock/plug on in one glance.

**Chosen:** B

**Largest gap on the loser:** Variant A is a newest-first KIND|string syslog — no chapters, no title/why, no kind/status chips, no golden-path film — so a judge cannot read the enforcement chain without narration.

**Why B:**

- Groups real `SessionEvent` rows into causal chapters (`Distracted → Countdown → Kill → Plug off → Unlock → Plug on`) instead of a reversed dump of `DECISION` / `KILL` / `PLUG_OFF`.
- Kind + Status chips (with counts) make filtering obvious; A’s lone “Filter events” box does not.
- Title + why (e.g. App kill / Blocked focus + raw `kind`/`detail`) and readable clocks; A is one truncated string per scream-case kind.
- Right rail is a 90s golden path with real product labels (Start session, Distracted, Countdown, Kill, Unlock, Demo Kill). Checks mark events already in this log — no fake FPS/latency.
- Empty state teaches the chain (“Start session to record the enforcement chain”) instead of collapsing to a blank table.
- Same dense titlebar + sidebar chrome as Session; A still looks like a leftover admin table.
- Tight at 1280×800 (help rail + chapters) with no horizontal overflow. Density is a ding, not a loss.

**Haven / AGPL:** original FocusPlug UI. No Haven source or assets.

**Gauntlet:** `npm run typecheck` and `npm test` (218) pass after rebase onto `679d158`. Browser: `#/log` empty, `?scene=golden#/log` full chain, `?scene=recovered#/log` unlock/plug-on, Kill chip, `/` search `blocked_focus`, Escape, hide/show 90s path. Keyboard: Tab + arrow keys on kind toolbar.

**Rebase:** onto `679d158` (session command center #18 + shell chrome #21 + configuration UX #19). Log surface unchanged by #19. Shared `vitest.config.ts` unions renderer tests via `src/renderer/src/**/*.test.ts` (lib + session + config + logs). `urlScene` / `mockApi` keep `live` / `away` / `recovered` **and** `golden`.
