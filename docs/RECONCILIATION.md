# Reconciling this branch with `main`

`claude/gracious-darwin-94m0fv` branched at `8b496d7`. Since then `main` has moved
63 commits and built, independently, a feature that reaches for the same seam this
branch reaches for. This document is the plan for putting them together. It is a
plan, not a merge — the branch is deliberately left unmerged so its work can be
judged on its own.

Measured, not guessed: `git merge origin/main` into this branch conflicts in
**25 files**. Nothing here is speculative; every claim below was checked against
both trees.

## The one real conflict

Both sides decide how long the fuse burns, and both write it through the same
field — `countdownSec`, the single number the pure policy engine already asks for.
Neither side changed the policy engine, which is why this is a clean design
question rather than a mess.

| | `main` | this branch |
|---|---|---|
| Name | `AdaptiveFuse` (`src/main/session/adaptiveFuse.ts`, `src/shared/adapt/**`) | `ForecastHook` (`src/shared/forecast/**`, `src/main/forecast/**`) |
| Question it answers | *How long does **this person** need to self-correct?* | *Is a drift coming in the next 30 s?* |
| Learning | Online, per-install, in the user's data dir; cancel = positive, kill = negative | Offline, shipped weights; 900-session held-out eval with CIs |
| Wiring | Constructed inside the controller; `this.adaptive.fuseFor(...)` at the `buildPolicyInput` call | Injected option; `forecast.beforeStep(now, base)` returning `number \| null` |

**They are not rivals — they answer different questions.** The adaptive fuse sets a
*personalised base length*. The forecast *shortens* that length when it has
pre-armed. Composing them is a two-line rule, and the branch's seam is already the
right shape to host it, because `ForecastHook` is an interface rather than a
concrete member.

### Recommended resolution

Make `ForecastHook` the single fuse authority and let `AdaptiveFuse` implement it:

```ts
// src/main/session/fuseAuthority.ts  (new, small)
export function composeFuse(adaptive, forecast): ForecastHook {
  return {
    beforeStep(now, baseSec) {
      const personal = adaptive.fuseFor(snapshots, baseSec, now) ?? baseSec;
      const prearm = forecast.prearmFuseSec(now);        // null unless pre-armed
      return prearm == null ? personal : Math.min(personal, prearm);
    },
  };
}
```

Then keep the two invariants this branch already tests, now applied to the
composed value:

1. **The latch** — a burning fuse never changes length mid-burn. Both systems can
   change their answer between ticks; the countdown must not.
2. **Never throw** — the composed hook stays inside the `try/catch` at the
   kill-path call site (`src/main/session/controller.ts`), so neither model can
   disturb enforcement.

### The subtle bug to avoid

`AdaptiveFuse` learns from outcomes: a cancelled countdown is a positive label, a
kill is a negative one. If the forecast shortens a fuse, that drift is more likely
to end in a kill — through no fault of the person. Left alone, the adaptive model
would read pre-armed drifts as *"this user needs longer"* and drift upward, and
the two systems would slowly fight.

Fix it one of two ways, both cheap:

- **Exclude** pre-armed drifts from `observeDrift`, or
- **Record** the fuse actually granted as a feature of the `DriftMoment`, so the
  learner conditions on it.

The second is better if there is time; the first is safe and is one `if`.

## File-by-file

**Take both, mechanical (3):** `.gitignore`, `package.json` (script lists are
additive — keep every `forecast:*`, `demo:*`, `test:store` and `adapt:*` entry),
`STATUS.md` (rewrite once at the end rather than resolving hunks).

**Take either, same fix twice (1):** `src/main/window/win32.ts`. Both sides found
and fixed the read-only `$pid` PowerShell bug that left the Windows foreground
sensor permanently blind — `main` renamed it `$fgPid`, this branch `$procId`. Keep
one, delete the other. Do not lose the fix.

**Union, both additive (4):** `src/shared/ipc.ts`, `src/preload/index.ts`,
`src/main/index.ts`, `src/renderer/src/lib/mockApi.ts`. Each side adds channels,
settings keys and mock methods; concatenate and keep both sets. `mockApi` must
mirror whatever the union ends up being, or `typecheck:web` fails.

**The design merge (2):** `src/main/session/controller.ts`,
`src/main/session/runtime.ts`. Apply the composition above. This is the only
place that needs thought.

**Behaviour merge, read both (4):** `src/main/desk/{camera.ts,monitor.ts,camera.test.ts}`,
`src/main/desk/model/your-model.ts`. This branch fixed a hidden-window leak on
failed camera start, warm-up races and a stuck `sourceStarted`; `main` added the
second attention head. Both belong. Land the branch's lifecycle fixes first, then
re-apply the head on top.

**Behaviour merge, read both (2):** `src/main/plugs/{kasa.ts,kasa.test.ts}`. This
branch added IPv6-loopback hard-deny and honest `err_code` handling; `main` added
the lamp-on plug mode. Both belong.

**UI, prefer `main` then re-apply (9):** `Shell.tsx`, `FlightFace.tsx`,
`KillOverlay.tsx`, `SensorRail.tsx`, `SessionClock.tsx`, `SessionPage.tsx`,
`features/session/model.ts` + `model.test.ts`, `useSessionElapsed.ts`. `main`'s
faces work is newer and larger here. Take `main`'s version, then re-apply this
branch's additions: the fourth sensor card, the pre-arm plate and `10s → 5s` chip,
the forecast rows in the timeline (`PREVIEW_KINDS` needs `"forecast"`), and the
lead-time receipt on the kill overlay.

## Suggested order

1. Branch off `main`, not off this branch — `main` is the larger, newer tree.
2. Cherry-pick the isolated wins first: `src/shared/forecast/**`,
   `src/main/forecast/**`, `scripts/forecast/**`, `demo/**`. These are new
   directories and conflict with nothing.
3. Do the union files (ipc, preload, index, mockApi). Run `npm run typecheck`.
4. Do the composition in `controller.ts` / `runtime.ts`. Run
   `npx vitest run src/main/session src/main/forecast`.
5. Re-apply the UI additions onto `main`'s components.
6. Re-apply the desk and plug fixes.
7. Run everything: `npm run typecheck && npm test && npm run test:forecast &&
   npm run demo:verify`.

## What each side is worth keeping for

From this branch: the forecast model and its evidence (900-session held-out corpus,
17-model bake-off with paired CIs, the CI gate), the browser judge demo, the audit
fixes, and the try/catch that makes enforcement structurally safe from model errors.

From `main`: the faces work, the nudge-and-lamp product direction, and the
Adaption-Labs-labelled attention head — which is the honest sponsor-tool story,
including its own disclosure that it is not yet reliable (56.6 % held-out against a
65.7 % always-focused baseline).
