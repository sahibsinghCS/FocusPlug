# Reconciling this branch with `main`

`claude/gracious-darwin-94m0fv` branched at `8b496d7`. Since then `main` moved 63
commits and built, independently, a feature that reaches for the same seam this
branch reaches for. This document started as the plan for putting them together;
**the merge has since landed**, so it now reads as both — the design argument,
and the record of what was actually done.

Measured, not guessed: `git merge origin/main` into this branch conflicted in
**30 files** (`git diff --diff-filter=U --name-only`). Three more that needed a
decision — `.gitignore`, `package.json` and `src/main/window/win32.ts` — git
merged cleanly on its own; they are listed below anyway, because "no conflict
marker" is not the same as "no choice made". Nothing here is speculative; every
claim was checked against both trees, and the sections marked *as shipped*
describe the code in the tree rather than an intention.

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

### The resolution, as shipped

> This section describes what is in the tree, not a proposal. The sketch that
> stood here was `min(personal, prearmFuse)`; it was **replaced by scaling**
> before landing, for the reason below.

`src/main/session/fuseAuthority.ts` is the whole rule, and it is pure:

```ts
// prearmed ? clamp(round(personal × 0.5), MIN_FUSE_SEC, personal) : personal
export function composeFuse({ personalSec, prearmed }: FuseInputs): number {
  if (!prearmed || !Number.isFinite(personalSec)) {
    return personalSec;
  }
  const scaled = Math.round(personalSec * PREARM_SCALE);
  return Math.min(personalSec, Math.max(MIN_FUSE_SEC, scaled));
}
```

`SessionController.resolveFuse` is its only caller: it asks `AdaptiveFuse` for
the personalised length, asks the `ForecastHook` whether it has pre-armed, and
composes. `buildPolicyInput` no longer decides anything — it is handed the
answer.

**Why scaling beats replacement.** Under `min(personal, prearmFuse)` the pre-arm
throws the personalisation away exactly when it matters: a slow recoverer who has
earned 20 s and a fast one who has earned 8 s both collapse to the same 5 s the
moment the needle crosses, and adapt's contract — *the fuse must clear
`RECOVERY_TARGET` for **this** person* — is not bent but broken. Scaling keeps the
ordering (20 → 10 still beats 8 → 4): everyone loses the same *fraction* of their
fair shot, which is a defensible price for a warning that has earned its pre-arm.
With the shipped 10 s default and a cold model it is arithmetically identical to
the demo beat the branch already had: 10 s → 5 s.

Two consequences worth stating plainly:

- The clamp is ordered so a pre-arm can only ever **shorten**. The `MIN_FUSE_SEC`
  floor lifts a scaled fuse back to 3 s but never past the personal length, so a
  deliberately short fuse is never handed a second it did not have.
- `forecastPrearmFuseSec` no longer sets the pre-armed length — the composition
  does. The setting still floors the forecast's own advisory snapshot, which is
  what the pre-arm chip renders; the two agree whenever the personal fuse equals
  the Settings fuse (every install until the model has learned something) and can
  differ afterwards. Reconciling the chip with the composed number is a follow-up
  in the renderer, not in the authority.

The two invariants this branch already tested now apply to the composed value,
and both live in `resolveFuse`:

1. **The latch** — a burning countdown never changes length mid-burn, no matter
   what either model now says. Both models are still *ticked* every evaluate (the
   adaptive fuse tracks the moment; `beforeStep` is where the forecast closes its
   1 Hz frames), but while the latch is set their answers are discarded. A
   Settings change still retimes a plain Settings fuse — today's behaviour, with
   its own tests — but it cannot stretch a fuse a model chose. This *closes* a
   latch hole on `main`, where a personalised fuse silently reverted to
   `settings.countdownSec` on the tick after arming, so the countdown on screen
   and the countdown the engine enforced were different numbers; several `main`
   tests measured the old timing and were updated.
2. **Never throw** — the whole composed computation sits inside one `try` at the
   kill-path call site. It is the one place two learned models reach the
   deterministic kill path: if either threw, `evaluateOnce` would die before
   `policy.step` and enforcement would stop entirely — no status, no countdown,
   no kill. On a throw the authority falls back to the latched value, or to the
   Settings fuse.

Both escape hatches survive: `FOCUSPLUG_NO_ADAPT=1` pins the personal length to
Settings, `forecastEnabled` / `forecastPrearmEnabled` gate the pre-arm, and with
both off the fuse is exactly `settings.countdownSec` — tested, including at 1 s,
which is *below* the adaptive floor and so could not survive an adaptive fuse
that was still awake.

### The subtle bug, and which fix shipped

`AdaptiveFuse` learns from outcomes: a cancelled countdown is a positive label, a
kill is a negative one. A pre-armed fuse is half the length the learner asked
for, so it kills more often through no fault of the person. Left alone, the
adaptive model reads pre-armed drifts as *"this user needs longer"*, the pre-arm
halves the longer fuse, and the two systems ratchet against each other for the
life of the install.

Of the two fixes, **recording** the granted fuse turned out to be already done by
`main`: `armed(seconds)` stamps the fuse actually handed out onto the
`DriftMoment`, `fuseLength`/`fuseOverN` are features, and `examplesFor` censors
every candidate longer than a kill's fuse. That handles the fuse-length confound
— but not the **selection** one: a pre-arm fires on high-risk moments, and with
no pre-arm feature the model charges their low recovery rate to the person.
Adding that feature means a new `FEATURE_NAMES` entry, a new prior weight and a
`FEATURE_LAYOUT` bump across `src/shared/adapt`, which discards every model
already on disk.

So the shipped fix is **exclusion**, one `if` in the controller with no change to
anything shared: a pre-armed drift never calls `adaptive.armed(...)`, so it never
becomes an `ActiveDrift` and the later `recovered`/`killed` are no-ops. The log
says so out loud (`adapt · 5s — forecast pre-armed, scaled from your 10s · not
learned from`). The honest statement is that the fuse this drift was given is not
the fuse the learner chose, so its outcome does not measure what the learner is
trying to measure. Unforecast drifts are still learned from normally — the guard
is not a blanket off switch, and there is a test for each half.

## File-by-file

**Take both, mechanical (3):** `.gitignore`, `package.json` (script lists are
additive — keep every `forecast:*`, `demo:*`, `test:store` and `adapt:*` entry),
`STATUS.md` (rewrite once at the end rather than resolving hunks). The first two
merged cleanly; only `STATUS.md` conflicted.

**Take either, same fix twice (1):** `src/main/window/win32.ts` — merged cleanly,
but only because the two sides edited different lines of the same fix. Both found
and fixed the read-only `$pid` PowerShell bug that left the Windows foreground
sensor permanently blind, and each renamed the out-param: `main` to `$fgPid`, this
branch to `$procId`. **`$fgPid` shipped**, so the branch's `$procId` is gone. That
rename is the one thing a clean merge could not finish: this branch's audit test
in `src/main/window/match.test.ts` names the variable literally, and asserting the
deleted name made a *passing-by-construction* test into a false one — `npm run
test:window` is a `node:test` suite, so `npm test` (vitest) never saw it. It now
pins `$fgPid`, matching `main`'s stronger name-agnostic guard in
`src/main/window/win32.test.ts`, which pins the same name.

**Docs and stills, rewrite over both (8):** `README.md`, `docs/AI-DISCLOSURE.md`,
`docs/DEMO-SCRIPT.md`, `src/renderer/src/index.css`,
`src/main/desk/evidence/gauntlet-run.json`, and the three still-capture scripts
`scripts/{console-stills,session-stills,session-actions-smoke}.mjs`. The prose
files conflicted because both sides rewrote the same pitch, and are rewritten
once against the merged tree rather than hunk-resolved; `index.css` is a union
(see the `Tone` note below). The three scripts are a **delete/modify**: `main`
deleted them, this branch had edited them. They are **kept**, because merged
`package.json` still exposes them as `console:stills`, `session:stills` and
`smoke:session-actions`, and the session stills they produce are what
`src/renderer/src/features/session/evidence/` holds. Deleting the files while
keeping the scripts would have left three `npm run` entries that fail on a fresh
clone.

**Union, both additive (4):** `src/shared/ipc.ts`, `src/preload/index.ts`,
`src/main/index.ts`, `src/renderer/src/lib/mockApi.ts`. Each side adds channels,
settings keys and mock methods; concatenate and keep both sets. `mockApi` must
mirror whatever the union ends up being, or `typecheck:web` fails.

**The design merge (2):** `src/main/session/controller.ts`,
`src/main/session/runtime.ts`. Apply the composition above. This is the only
place that needs thought. Landed as: a new pure `src/main/session/fuseAuthority.ts`
plus `SessionController.resolveFuse`; `runtime.ts` is a plain union (the forecast
hook and `revealWindow` both ride the same options object). Two files the merge
left inconsistent were fixed alongside it, because the composed path runs through
them: `src/main/forecast/tap.ts` did not forward `SessionPush.nudge`, which
`main` added — the production wiring is `withForecast(push, monitor)`, so that was
a crash on the first nudge, not a missing chart — and `src/main/session/probe.ts`
arrived from `main` without the branch's forecast settings keys.

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

Landed as, with the three integration snags worth naming:

- **`CountdownOverlay` → `KillOverlay`.** `main` moved the component to
  `features/kill/` and renamed it, keeping the prop shape byte-for-byte, and it
  had already absorbed this branch's `forecastLeadSec` receipt. The demo and the
  forecast preview were still importing the old path; they now import
  `KillOverlay`. No component was resurrected.
- **`DecisionHero` is now shared.** `main` deleted the standalone file and
  `SessionPage` grew a private copy in `main`'s card idiom. Three surfaces render
  the same verdict off the same `decisionHeroCopy` — the console, the forecast
  preview and the demo — so the private copy was lifted back out to
  `features/session/DecisionHero.tsx` with `strictMode`/`usingMock`/`compact`
  optional. `compact` is what drops the consequence line in the two side-by-side
  layouts; the console still renders it.
- **The console got a state it can be in.** `main`'s shell derives lock mode
  from the plan lifecycle (`timer.status !== "setup"`), and this branch's
  console is the only host in the app of the forecast panel, the pre-arm plate,
  the nudge toast, the sensor rail and the enforcement timeline. Composed
  naively those cancel: enforcement is armed only while the plan is `running`,
  `running` forced the full-screen lock, and the console became unreachable —
  it still typechecked, still passed, and still screenshotted, because the
  seeded mock scenes set `sessionActive` without a plan behind them. The fix is
  that the lock is a **view** of a live session, not the session: a pure
  `shellView(status, consoleOpen, sessionActive) -> "plan" | "lock" | "console"`
  in `src/renderer/src/features/timer/view.ts` is the single rule, `Console` in
  the lock bar and `Back to lock mode` in the console are the door, and the
  session keeps running and stays armed across it. `SessionActions` drops
  Start/Stop while a plan owns the session, because a Stop there would disarm
  the main process while the lock face still read *Locked*. Pinned by
  `features/timer/view.test.ts` (every armed state on every plan shape resolves
  to the console, plus a source scan so the shell cannot re-derive the lock from
  the lifecycle) and by a no-`?scene=` leg of `npm run smoke:session-actions`
  that holds the real switch and asserts the instruments are on screen.
- **`features/session/session.css` is gone.** `main` folded the parts still in
  use into `index.css` (`fp-session-fuse-num` among them); the demo and preview
  imports of the deleted file were dropped, and both already pull `index.css`.
- **The `Tone` vocabulary gained `amber` rather than losing it.** `main`
  renamed the palette — `lime` → `focus`, `amber` → `warn` — as part of going
  monochrome, and the forecast surfaces still named the old tokens. `lime` →
  `focus` was a pure rename (`--color-fp-lime` is aliased to `--color-fp-ink`,
  the same `#f2f1ec` `--color-fp-focus` already was), so those went across
  untouched. `amber` did **not**: `--color-fp-amber` survives the merge as a
  real `#e8a13c`, deliberately, because it is the forecast's one step before red
  — pre-armed, fuse shortened, nothing dead yet — and `main`'s `warn` is a
  grey-blue that means *away*. Collapsing the two would have made the pre-arm
  chip grey beside an amber panel border and thrown away the distinction the
  `index.css` comment exists to protect, so `Tone` is now
  `focus | red | warn | amber | mute` and `lib/tone.ts` carries the fifth arm.
  `main`'s own surfaces are untouched by this: nothing that returned `warn`
  before returns `amber` now.

## The order it was done in

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
