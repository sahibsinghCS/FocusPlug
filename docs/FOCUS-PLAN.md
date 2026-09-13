# Focus Plan — Design (merged, build-ready)

**Repo:** `/home/user/FocusPlug-gauntlet`, branch `claude/gracious-darwin-94m0fv`. Every path is repo-relative.
**Base:** the integration cut — maximum reuse, smallest contract surface, kill path untouched and uncoupled.
**Doc homes as built:** `docs/FOCUS-PLAN.md` — this design, with the frozen appendix inlined as the [*Frozen contracts*](#frozen-contracts) section at the end rather than split into a second file — plus an append-only `## Focus Plan (Phase 5)` section at the END of `docs/CONTRACTS.md`, below the byte-checked Types fence.

---

## 0. One paragraph, and the three properties everything below protects

The Focus Forecast already knows *when* a student is about to drift. Focus Plan turns that into three things: a **plan recommended before the round starts, with its reasoning in plain language**; a **post-round debrief**; and a tracked **headline metric — minutes until first drift** — that says whether focus is actually improving, and refuses to say so when it cannot. It measures with the definition of "drift" the forecast already ships (`isDriftedDecision` / `findDriftOnsets` / `DRIFT_DEBOUNCE_SEC`), records rounds through a tap that mirrors `withForecast`, stores a compact ledger beside `adaptive-model.json`, and **never enforces anything**.

1. **It says something true on a fresh install.** The ladder in §1 starts inside the current session, off the live risk curve, before any history exists.
2. **It refuses to lie.** Kaplan–Meier returns `null` rather than a confident number; the trend has seven named gates and `slopeMinPerRound` is structurally `null` unless every one of them passes.
3. **It is an offer.** No lock, no block, no kill, and — settled below — **no button on the nudge overlay**. The one live surface is one extra sentence on a nudge that main already fired.

### What already exists, and is reused rather than rebuilt

| Existing | What Focus Plan takes from it |
| --- | --- |
| `src/shared/forecast/labels.ts` — `isDriftedDecision`, `driftTypeFor`, `findDriftOnsets`, `DRIFT_DEBOUNCE_SEC = 30` | **The definition of a drift.** Imported verbatim. Focus Plan never has its own, and §3.2's equivalence test makes that a failing test rather than a promise. |
| `ForecastSnapshot.risk` (EMA-smoothed, Platt-calibrated, ECE **0.0038** in `eval-report.json`) | Peak risk and when it peaked, in the debrief. |
| `ForecastEvent.forecast_nudge` / `forecast_prearm` (median lead **16 s**, p25 11 s) | The within-session "wobble" — an early read that is a *warning*, never a drift. |
| `src/main/forecast/tap.ts` — `withForecast`, including `swallow()` | `withPlan` / `withPlanForecast` are structural mirrors, line for line. |
| `src/main/forecast/monitor.ts` — `guard()` / `trip()` | The recorder's failure containment: first thrown error latches Focus Plan off for the session, writes one `plan · off · <message>` line, session continues. |
| `src/shared/adapt` — `confidence()`, `CONFIDENCE_DRIFTS = 12`, `population.ts`'s seeded `rng()` | The trust-bar idiom, and the gauntlet's sampler (reused, not rewritten). Focus Plan **reads nothing from and writes nothing to** the adaptive model: `adapt` learns P(recover \| fuse), Focus Plan measures time-to-first-drift. Different quantities. |
| `src/main/session/harness.ts` — `MutableClock`, `ScriptedWindowMonitor`, `RecordingKiller`, `createMemoryStore` | Every main-side test. No wall clock anywhere. |
| `src/renderer/src/features/timer/plan.ts` — `TimerPlan`, `SHAPES`, `withEdit`, `LIMITS` | The plan object the recommendation edits, and the break ratio (§4). |
| `src/main/store/appStore.ts` — `writeJsonAtomic`, `loadAdaptiveModel` / `saveAdaptiveModel` | The persistence pattern, copied exactly. |

### The structural fact that shapes everything

`Shell.tsx` arms enforcement per focus segment: `useSessionTimer({ onEnforce })` calls `startSession()` when a focus block begins and `stopSession()` on a break, a pause, or the finish. **One main-process session already equals one focus round.** Focus Plan needs no new lifecycle. Break time is outside every round by construction, so "break time never counts toward your hold" is free rather than a rule we enforce.

---

## 1. What is computed, from what data, and the cold-start ladder

### 1.1 Inputs — every one already on a wire that exists

| Computed | Read from | Reused code |
| --- | --- | --- |
| Drift onsets in a round | `PolicyEvent{type:"status"}.decision` through the session tap | `isDriftedDecision`, `driftTypeFor`, `DRIFT_DEBOUNCE_SEC` |
| Peak risk and when | `ForecastSnapshot.risk` / `.ts` at 1 Hz | the forecast push, wrapped |
| First wobble | `ForecastEvent{type:"forecast_nudge"}` | the escalation reducer's own output |
| Countdowns armed / kills | `PolicyEvent` `start_countdown` / `kill` | same tap |
| Served focus seconds | injected `now()` deltas accumulated while the session is active, each delta clamped to `PLAN_MAX_TICK_GAP_SEC` | the monitor's suspend-clamp idiom |
| Planned focus/break length, round index, whether the plan was accepted | **one new optional argument to `SESSION_START`** (§9.3) | — |

Nothing new is sensed. No process names, no window titles, no frames, no network.

### 1.2 The unit of observation

For one focus round: `holdSec = firstDriftSec ?? servedSec`, and `censored = firstDriftSec === null`.

A clean round is **not** a hold of exactly its length — it is a right-censored observation whose true value is *somewhere past* its length. Treating those two the same is the single easiest way to lie with this metric, and §2 is built around not doing it. It also biases downward **exactly on the good rounds**, which would make the headline metric worse the better the student gets.

### 1.3 The cold-start ladder

Six rungs, evaluated top-down on the estimator window. Every rung has copy; **there is no empty state anywhere in this feature.**

| Rung | Condition | Says | Number |
| --- | --- | --- | --- |
| `no-history` | window empty | "No history. This round is the measurement." | `PLAN_DEFAULT_FOCUS_MIN` = 25 |
| `wobble-only` | zero drift events, **no completed eligible round**, and a live round carrying a forecast wobble | a provisional read off the live risk curve | `floor(wobbleMin)`, clamped by progression |
| `censored-only` | ≥1 eligible round, zero drift events | "Your limit is past X. We do not know where." | `lowerBound + PLAN_STRETCH_MIN` — go looking |
| `single` | exactly 1 drift event | "One round is a mood, not a pattern." | that hold |
| `pair` | exactly 2 | "Two points do not make a line." | KM median of the two |
| `measured` | ≥3 | the real claim | KM median |

**Why `wobble-only` is scoped to a live round with no completed one.** A wobble says "at minute 11 the forecast thought you were about to drift, and you didn't." Given three clean 25-minute rounds that is evidence of nothing much, and recommending 11 to someone who demonstrably holds 25 would be absurd. Given a live round at minute 12 with no history at all, it is the only signal there is. So the provisional reading is **structurally outranked by the first completed round**, and retired entirely by the first real drift. It never enters `events`, never enters the trend window, and can never satisfy a confidence gate. That is the whole discipline of the "worth exactly one observation, never more" idea, kept without a parametric posterior to inject it into.

**Where a judge on a fresh install actually sees it**, in order:
1. **Before the session** — the plan card, rung `no-history`, real copy and a real number. Not empty.
2. **Inside the first round** — the revision line riding the first nudge that fires, driven by the provisional wobble estimate. Not a new surface (decision 5).
3. **At the first break** — the debrief, with a real MUFD.

If the forecast is off, `wobble-only` is unreachable and the copy says so: *"Focus Forecast is off, so there is no early read — this plans from drifts only."* It never fabricates a risk curve.

---

## 2. The estimator and its honesty rules

Pure, deterministic, no clock, no I/O, browser-importable: `src/shared/plan/{survival,trend,estimate}.ts`.

### 2.1 Kaplan–Meier, because the data is censored

Mixed event / right-censored durations with n between 1 and 20. KM is the non-parametric, assumption-free, ~30-line answer, and — critically — **it refuses on its own**: if the survival curve never reaches 0.5, the median is undefined, and undefined is exactly what we want to render.

```
S(t) = Π over event times tᵢ ≤ t of (1 − dᵢ / nᵢ)
```

* **Ties:** events at time *t* are processed before censorings at *t* (standard convention), so a clean round that ended at exactly the minute someone drifted does not leave the risk set early.
* `medianSec = min{ t : Ŝ(t) ≤ 0.5 }`, or `null` when `min Ŝ > 0.5`.
* `lowerBoundSec = max(holdSec)` over the window — the honest floor when the median is `null`.

Worked check against the decided copy: holds 19, 22, 20, all events. `Ŝ(19) = 0.667`, `Ŝ(20) = 0.333`, `Ŝ(22) = 0`. **Median = 20.** (Verified numerically.)

**`typicalMin === null` is not a failure — it is the good outcome.** It means the student drifts in fewer than half their rounds, and the correct advice is a *longer* block, not a shorter one. The copy says **"at least X"** and never a point estimate, and the `censored-only` rung deliberately stretches to go looking for the edge.

*(Rejected: a Weibull-with-Gamma-rate posterior over a shape grid. The maths is correct and the shape story is genuinely nice — "your drift times are clustered, that is a rhythm" — but it costs a shape-marginal-likelihood grid, a mixture-quantile bisection, an offline prior-fitting script and a fitted `prior.json` whose provenance the shipped copy then has to defend. KM is thirty lines and measures the exact quantity we report. The tell that this was the right cut: with no fitted prior there is no "900 simulated study sessions" claim to make on the fresh-install card at all — the cold-start number is the plain pomodoro default, which is more honest, not less.)*

### 2.2 No blending toward the Dial

`adapt`'s `chooseFuse` blends its model toward the Settings value by `confidence(model)`, because a logistic on four samples can run away. Focus Plan does **not** copy that, and the reason is honesty, not laziness: the KM median *is* a direct measurement of the exact quantity being reported, and the number currently in the Dial is not a prior about the person — it is what they happened to pick. Blending would make the headline number unexplainable ("your rounds say 20, so we recommend 23") and would break the decided copy.

`trust = min(1, roundsInWindow / PLAN_CONFIDENCE_ROUNDS)` (mirroring `confidence()` in `adapt/model.ts`) is still computed, and is used for **copy hedging and trend gating only** — never to move the number.

### 2.3 The trend: seven gates, and it names the one that stopped it

`planTrend(samples)` returns `PlanTrend`. Direction is `"flat"` or `"unknown"` and confidence is not `clear` unless **all seven** pass:

| # | Gate | Rule | Why | Confidence on failure |
| --- | --- | --- | --- | --- |
| 1 | `too-few-events` | ≥ 6 **uncensored** observations | never fit a line through two points | `none` |
| 2 | `too-few-days` | those events span ≥ 3 distinct **local calendar days** | three rounds in one evening are one evening's mood | `none` |
| 3 | `lopsided-halves` | older and newer half each have ≥ 3 events | a direction needs two comparable sides | `none` |
| 4 | `censoring-limited` | censored rounds ≤ 50% of the window | if most rounds ran clean, the drifts you *did* see are a biased short subsample | `none` |
| 5 | `below-noise` | `\|newer − older\| ≥ max(2 min, 0.5 × IQR)` | the change must beat the student's own spread | `weak` |
| 6 | `sign-disagreement` | the half-split delta agrees in sign with the **Theil–Sen** slope over `(index, holdMin)` | median of all pairwise slopes: robust, deterministic, ten lines, no dependency | `weak` |
| 7 | `unstable` | **leave-one-out**: drop each observation in turn, recompute the delta; no single removal may flip the sign or push it under the noise floor | one lucky night must not be able to make the claim | `weak` |

Gate 7 is the graft that replaces a 1000-resample seeded bootstrap. It is deterministic, needs no seed, costs ten lines, and produces a sentence a student immediately understands: *"drop any single round and the direction changes, so that is noise, not a trend."*

**Like-for-like rounds (the confound nobody else would have caught).** Round 4 of a pomodoro is systematically harder than round 1, so a window mixing them measures window layout as much as attention. Before gating: if the window holds ≥ `PLAN_TREND_ROUND1_MIN_EVENTS` round-1 drift events, the trend is computed on **round-1 rounds only** and `method` says so; otherwise it uses all rounds and `method` carries the caveat out loud. `PlanTrend.roundOneOnly` records which happened.

**Rendering rules that fall out of this, structurally:**
* `slopeMinPerRound` is `null` unless confidence is `clear`. The UI has no code path to a direction it has not earned.
* The sparkline draws **dots only** unless *all seven* gates pass — not merely below 6 events. No line, no shaded band, no "projected".
* `blockedBy` is carried to the UI so the copy names **the gate that actually stopped this trend**, not the first one in the list. Both surfaces do it from the same field: the card's sentence (`trendLine`) and the debrief's caption (`holdSparkCaption`), so a window with 8 drifts on 8 days refused by `below-noise` is told the change is inside its own spread — never that it is short of history.

### 2.4 Provisional estimates never harden silently

An estimate from `wobble-only` sets `provisional: true`, always renders with the word *provisional* and a one-line explanation of what a wobble is, is **excluded from the trend window entirely**, and **can never move the target** (§4: provisional never steps). A trend across warnings would be a trend across the forecast's own operating point, not across the student.

### 2.5 The bias we cannot remove, stated out loud

Censoring here is **informative**: the plan chooses the round length, and the round length is what censors. Run only 15-minute rounds and a 30-minute limit is unobservable. KM assumes censoring independent of survival time; that assumption is violated by construction. It cannot be removed. Two partial mitigations, both disclosed:

* the `censoring-limited` gate refuses a direction when the window is majority-clean;
* the `censored-only` rung deliberately **stretches** to go looking for the limit rather than sitting inside it.

The debrief says it in English when it applies: *"You did not drift, so this round tells us your limit is past 25 minutes and nothing more precise."*

### 2.6 The numbered honesty contract

Every one of these is a named test in §11.

- **H1** — A censored round is never reported as a drift time. Its number appears only as "held N, no drift".
- **H2** — When the KM median is unreached the copy says **"at least X"**, never a point estimate.
- **H3** — No direction below 6 drift events across 3 distinct local days, both halves populated, window not majority-censored.
- **H4** — A direction is claimed only when the delta beats the student's own spread, agrees with Theil–Sen, and survives leave-one-out.
- **H5** — `slopeMinPerRound === null` for every confidence below `clear`. The renderer cannot display an unearned number because the number does not exist.
- **H6** — The method is named on screen, verbatim from `PlanEstimate.method` / `PlanTrend.method`.
- **H7** — A forecast warning is not a drift. "Wobbled" and "drifted" are distinct words with distinct counts, and a wobble that stood down is reported as a stand-down.
- **H8** — Later rounds are not compared with first rounds as if equal; when they must be, the method string says so.
- **H9** — Every ineligible round is disclosed with its reason (§6.3). A student who sees 5 rounds in the ledger and 3 in the reasoning can always find the other two.
- **H10** — Every number in a rendered sentence exists in the model that produced it (enforced by the digit-membership fuzz test, §11.1).
- **H11** — The debrief's `theNumber` line is non-nullable. There is no debrief without an honest statement of what was and was not measured.

---

## 3. The headline metric: minutes until first drift

### 3.1 Definition

> **MUFD** = minutes of *served focus time* from the start of a focus round to the first drift onset in that round.

* **Served, not wall.** Pause time is excluded; each `now()` delta is clamped to `PLAN_MAX_TICK_GAP_SEC` so a suspend or a coffee break cannot inflate it. This is the only definition under which the number means "how long you can work".
* **Drift onset** is the forecast's definition, imported not re-implemented: the policy's own `Decision` entering `DISTRACTED` (`tab_out`) or `AWAY` (`walk_away`) from a non-drifted state, with onsets inside `DRIFT_DEBOUNCE_SEC` (30 s) of the previous kept onset merged into it.
* **Clean rounds are censored**, not zero-drift maxima.

### 3.2 One definition of drift, pinned by a test

The recorder sees a stream, not an array, so `src/shared/plan/drift.ts` ships a streaming reducer built on the shared primitives:

```ts
export interface OnsetState { last: Decision | null; onsetsSec: number[] }
export const INITIAL_ONSET_STATE: OnsetState;
export function stepOnset(state: OnsetState, decision: Decision, tSec: number): OnsetState;
```

**The headline test:** folding `stepOnset` over any `DecisionFrame[]` produces exactly `findDriftOnsets(frames).map(o => o.t)`, over a table of hand-written sequences including flaps, a session that starts drifted, and two onsets 29 s apart (merged) vs 31 s apart (kept). If the forecast ever changes what a drift is, that test fails and Focus Plan follows it. There is one definition of drift in this product and this test is what keeps it that way.

**Started drifted.** A round always opens on `IDLE`, so locking with Discord already in front produces an onset at roughly t = 0. For the forecast that is a genuine miss and it should say so; for Focus Plan "you drifted 0.2 minutes in" measures window layout, not attention. So the *round* is marked ineligible without touching the *drift* definition: `startedDrifted = (first onset < PLAN_STARTED_DRIFTED_SEC) && (the first non-IDLE decision observed was already drifted)`. `findDriftOnsets` still finds the onset; the round contributes nothing to the estimator and is disclosed in the evidence list.

### 3.3 What counts and what does not

| Situation | `status` | Enters estimator |
| --- | --- | --- |
| Round ran to its planned end, drifted | `completed` | yes, as an **event** |
| Round ran to its planned end, clean | `completed` | yes, **censored** at `plannedFocusSec` |
| Ended early (Hold to end / Skip round), drifted before the end | `aborted` | yes, as an **event** — a drift you saw is a drift |
| Ended early, clean, `servedSec ≥ PLAN_MIN_ROUND_SEC` (300 s) | `aborted` | yes, **censored** at `servedSec` |
| Ended early, clean, `servedSec < 300 s` | `discarded` | no — five minutes is not a measurement |
| Started drifted | `aborted`/`completed` + `startedDrifted: true` | no |
| Never produced a `status` event (crash, monitor dead) | `discarded` | no |
| Wall clock jumped: `servedSec > 3 × plannedFocusSec` | `discarded` | no |
| Break segment | not recorded at all | — |

The asymmetry in rows 5–6 is deliberate and tested: a short round **with** a drift is real, informative data; a short round **without** one is noise. Throwing away all short rounds would silently delete the worst nights and flatter the trend.

`status` is decided in main with no extra IPC: `completed` iff `servedSec ≥ plannedFocusSec − PLAN_COMPLETE_SLACK_SEC`, else `aborted`, with the two `discarded` overrides.

### 3.4 Pause, resume, and round identity

`roundKey = "<plan startedAtMs>-<segment index>"`, supplied by the renderer in the arm context. A pause emits `stopSession()` and the resume emits `startSession()` with the **same** `roundKey`; the recorder merges consecutive sessions sharing a key into one `PlanRound`, summing `servedSec` and keeping the earliest drift across them. Without this, every pause would manufacture two short bogus rounds and fragment a pauser's real hold. `end()` clears `startedAtMs`, so a fresh run is a fresh key namespace.

---

## 4. The progression rule

`recommend(...)` → `PlanRecommendation`, pure, in `src/shared/plan/progression.ts`.

```
// 1. the base is the measurement, unmodified
base =
  estimate.medianMin                                  // measured, or provisional
  ?? (estimate.lowerBoundMin !== null
        ? (stretchEnabled && completedRounds >= PLAN_CENSORED_STRETCH_MIN_ROUNDS
             ? estimate.lowerBoundMin + PLAN_STRETCH_MIN   // never drifted → go looking
             : estimate.lowerBoundMin)
        : PLAN_DEFAULT_FOCUS_MIN)                          // cold

// 2. the ratchet — a rule, not a model, so it can be explained in one line
heldToTarget(r)  = r.firstDriftSec === null
                   && r.servedSec >= r.plannedFocusSec - PLAN_COMPLETE_SLACK_SEC
driftedEarly(r)  = r.firstDriftSec !== null
                   && r.firstDriftSec < PLAN_EARLY_DRIFT_FRACTION * r.plannedFocusSec  // 0.8

step =
  !stretchEnabled                                   -> "hold"
  estimate.provisional || estimate.medianMin === null -> "hold"
  newest two eligible rounds both heldToTarget      -> "stretch"   // +3
  newest two eligible rounds both driftedEarly      -> "ease"      // −3
  otherwise                                         -> "hold"      //  0

// 3. clamp, and refuse fantasy jumps
focusMin = clamp(round(base + delta), PLAN_MIN_FOCUS_MIN=10, PLAN_MAX_FOCUS_MIN=90)
if bestHeldMin !== null:
    focusMin = max(PLAN_MIN_FOCUS_MIN, min(focusMin, bestHeldMin + PLAN_MAX_REACH_MIN=10))

// 4. the break follows the shipped house ratio
breakMin = clamp(round(focusMin / PLAN_BREAK_RATIO=5), PLAN_MIN_BREAK_MIN=3, PLAN_MAX_BREAK_MIN=15)
```

`bestHeldMin` = `max(holdMin)` over the window (event or censored). The `+10` cap means the plan can climb but cannot leap: someone whose best is 20 minutes is never handed 45.

**Rounds are never recommended.** The plan touches `focusMin` and `breakMin` only; how many rounds you have time for is a fact about your afternoon, not about your attention. Saying so is cheaper and more honest than guessing.

**Ease-off is symmetric and says so.** Two rounds that drift before 80% of target drop the target three minutes, and the copy promises the way back: *"It goes back up as soon as you hold two in a row."* A plan that only ratchets upward is a plan students quit. No streak counter is displayed and no round is ever labelled a failure.

### The one place this design deliberately diverges from the brief

The brief's illustrative sentence is *"aim for 20, break for 5."* Under `round(focusMin / 5)` a 20-minute block gets a **4**-minute break.

That divisor is not arbitrary: it is the only rule that reproduces **all three shipped shapes exactly** — Classic 25/5, Deep work 50/10, Sprint 15/3 (verified against `SHAPES` in `src/renderer/src/features/timer/plan.ts`). A five-minute floor, chosen so the example reproduces, makes the app's own Sprint shape unreachable by its own recommender. The rule that agrees with the product wins over the rule that agrees with one example sentence, and the design says so out loud rather than quietly fitting to the illustration.

**The lever is one constant.** If the example sentence is the requirement rather than the illustration, `PLAN_MIN_BREAK_MIN = 5` restores it, at the cost of Sprint parity. Nothing else in the design moves.

**All three decided examples otherwise reproduce exactly:**

| Decided example | Path | Result |
| --- | --- | --- |
| fresh install | `no-history` → base 25, step `hold` | **25 / 5** |
| "drifted at 19, 22 and 20 — aim for 20" | KM median 20, mixed outcomes → `hold` | **20** / 4 |
| "held 18 last week, try 21 this week" | median 18, last two `heldToTarget` → +3 | **21** / 4 |
| (P2's worked case) 3 clean 25-min rounds | `censored-only`, 25 + 3, cap 25+10 | **28 / 6** |

---

## 5. Persistence

### 5.1 The ledger

`<userData>/focus-plan.json` — a sibling of `adaptive-model.json`, and for the same stated reason: derived data that can always be thrown away and relearned, and losing it must never take settings or the log with it.

```jsonc
{ "v": 1, "lifetimeRounds": 37, "rounds": [ /* PlanRound, oldest first, cap 200 */ ] }
```

One `PlanRound` is ~200 bytes; the cap is ~40 KB. Written atomically through the store's existing `writeJsonAtomic`, on round close only — roughly once every 25 minutes, which is nothing next to the session log's per-event write.

Two new **optional** methods on `SessionStore`, mirroring the adaptive-model pair exactly, so `createMemoryStore`, `probe.ts` and the smoke scripts are untouched and keep passing:

```ts
loadPlanLedger?(): unknown;
savePlanLedger?(value: unknown): void;
```

Revive is defensive in the house style: wrong `v`, non-array `rounds`, NaN offsets, negative `servedSec`, or any malformed record ⇒ that record is dropped, or the ledger starts empty. No throw ever reaches a session start. A failed write disables recording for the session (`plan · off · …`) and never the session.

### 5.2 Why a ledger, when the session log nearly has this

It very nearly does — `decision`, `session`, `countdown`, `kill` and `forecast` rows are all there, and `ledgerFromSessionLog(events)` in `ledger.ts` is a pure reducer that **can** rebuild the ledger from a `SessionEvent[]`. A test asserts it agrees with the live recorder for rounds still in the log, and the browser demo and `mockApi` use exactly that path, so they get a real data path for free.

But `MAX_SESSION_LOG = 1000` trims **oldest first** — precisely the history a 28-day trend needs. The ledger is cheap insurance, and it makes the log the audit trail rather than the database.

### 5.3 Privacy, structurally

`PlanRound` contains only numbers, enums, one opaque `roundKey` and a `"YYYY-MM-DD"` local day string. No process name, no window title, no frame, no free text. `localDay` is stamped **in main at write time**, precisely so `src/shared/plan/**` never touches `Date` — which is what keeps the pure core environment-agnostic and testable without clock injection. Nothing leaves the machine, and the purity fence (§10) forbids network modules in the shared core.

### 5.4 Reset and the off switches

* **Settings → Focus Plan → "Forget my focus history (37 rounds)"**, behind the existing `ConfirmAction` component. Calls `PLAN_RESET`, writes `{v:1,lifetimeRounds:0,rounds:[]}`, appends one `plan · history cleared (37 rounds)` line, pushes the empty state. The panel names the file path and states plainly what reset does **not** touch: the adaptive fuse model (separate file, separate concern), the session log, and settings.
* `focusPlanEnabled: false` — master switch. Nothing recorded, no card, no debrief, no revision. Off reproduces today's screens exactly, and there is a test for it.
* `focusPlanStretchEnabled: false` — keeps the measurement, removes progression entirely.
* `FOCUSPLUG_NO_PLAN=1` — the filming pin, mirroring `FOCUSPLUG_NO_ADAPT=1` exactly: that one does not remove the fuse, it pins the fuse to the un-personalised Settings value, and this one does the same thing one layer up. Focus Plan stays **switched on** and the plan card stays on screen showing the `no-history` rung, while `focus-plan.json` is neither read, written, nor added to — `PLAN_RESET` is refused too, so a filming switch can never delete a student's history. A scripted demo is then not at the mercy of yesterday's rounds. It is **not** the master switch: `focusPlanEnabled: false` is what takes the cards away. The debrief has nothing to show under the pin, because nothing is recorded. `recorder.test.ts` asserts all of that, including that the pinned state, run through the estimator the renderer calls, produces the `no-history` rung.

---

## 6. The start-of-session plan card

### 6.1 Placement

A `PlanCard` on `SetupPage`, directly under the hero (*"50m of work, done by 16:40."*) and **above** the face picker — it is the first thing you read, before you touch a dial. It is an `fp-card` using `fp-stencil` kickers and `Chip` exactly as `ForecastPanel` does, with one primary control and one disclosure. The existing `fp-rise` animation delays below it shift by one step.

The renderer composes **no sentences**. `PlanCardCopy` arrives fully formed from `src/shared/plan/copy.ts`, so every string is unit-testable without a DOM, and `npm run plan:stills` renders the identical words in a plain browser off the named fixtures. The `demo/` bundle does not import the plan core today (§10 says why the fence allows it and the demo declines it).

```
┌ FOCUS PLAN ──────────────── measured · 6 rounds ·  Why this? ▾ ┐
│                                                                │
│   20 minutes of work, then 4 off.                              │  fp-display
│                                                                │
│   Your last three rounds drifted at 19, 22 and 20 minutes —    │  the reasoning
│   the middle of that is 20. Half of your rounds get past       │
│   20 minutes clean.                                            │
│                                                                │
│   Up 4 minutes over three weeks — 20 now against 16 then,      │  trend line
│   across 9 drifts on 7 days.                                   │
│                                                                │
│   [ Use this plan ]   Or set your own below — nothing here     │
│                       is enforced.                             │
└────────────────────────────────────────────────────────────────┘
```

`Use this plan` calls `timer.setPlan(withEdit(timer.plan, { focusMin, breakMin }))`. The Dial below stays fully editable; when it disagrees with the recommendation the card shows a quiet `Chip tone="mute"` reading **"your plan: 30 / 8"** and nothing else happens. **No nag, no re-prompt, no second confirmation.** If the plan already matches, the button disappears and the card says so.

### 6.2 Real copy, every rung

Every block below is the string `src/shared/plan/copy.ts` actually emits, pasted from a run, with the named ledger in `src/shared/plan/fixtures.ts` it came from. Reproduce any of them with `recommend({ rounds: selectWindow(<fixture>.rounds, …), forecastEnabled: true, stretchEnabled: true })`; `copy.test.ts` pins the decided beats and the refusal properties, and `npm run plan:stills` renders them in a browser.

**`no-history` — fresh install, the judge's first screen** · fixture `fresh`

> **FOCUS PLAN · no history yet**
> ### Start with 25 minutes, then 5 off.
> No history yet, so this is the pomodoro default and not a reading of you. FocusPlug measures one thing while you work: how many minutes you hold before your first drift. Start short — 25 minutes is short enough that this round produces a number.
> `[ Use this plan ]` Or set your own below. Nothing here is enforced.

**`wobble-only` — still inside the first round, and the forecast has flagged one** · fixture `fresh` + live round `liveWobble`

> **FOCUS PLAN · provisional**
> ### Provisional: try 11 minutes, then 3 off.
> Nothing has finished yet, so this reading is provisional. A wobble is the forecast warning that a drift was coming — it flagged one 11 minutes into this round, and you did not drift. That is a warning, not a drift, so it is worth exactly one reading and no more: the first completed round replaces it.

**`censored-only` — rounds exist, none drifted** · fixture `clean3`

> **FOCUS PLAN · limit unknown**
> ### Try 28 minutes, then 6 off.
> 3 rounds so far and no drifts in any of them. What we can say is that you have held at least 25 minutes — we do not know where the limit is, because no round has run long enough to find out. This adds 3 minutes to go looking for it.

**`single`** · fixture `single`

> **FOCUS PLAN · one drift measured**
> ### Try 19 minutes, then 4 off.
> One measurement so far: you drifted 19 minutes into your last round. One round is a mood, not a pattern, so nothing is being extrapolated from it — this simply plans the length you actually did.

**`pair`** · fixture `pair`

> **FOCUS PLAN · two drifts measured**
> ### Try 19 minutes, then 4 off.
> Two rounds, drifting at 19 and 22 minutes. Two points do not make a line, so no direction is being claimed — this is the middle of what you have done. One more round and it starts trending.

**`measured`, step `hold`** — the decided beat · fixture `drift19_22_20`

> **FOCUS PLAN · measured · 3 rounds**
> ### 20 minutes of work, then 4 off.
> Your last rounds drifted at 19, 22 and 20 minutes — the middle of that is 20. Half of your rounds get past 20 minutes clean.

**`measured`, step `stretch`** · fixture `stretchReady`

> **FOCUS PLAN · stretch · 6 rounds**
> ### Stretch: 21 minutes, then 4 off.
> You held your target clean twice in a row, so this adds 3 minutes. Your median before the first drift is 18 minutes across 6 rounds.

**`measured`, step `ease`** · fixture `easeReady`

> **FOCUS PLAN · easing off · 5 rounds**
> ### Ease back: 17 minutes, then 3 off.
> The last two rounds drifted at 11 and 13 minutes, short of what they planned. A round you finish beats a round you plan, so this drops 3 minutes. It goes back up as soon as you hold two in a row.

**Trend line** — appended to the reasoning, one sentence, never a chart claim. Each refusal names the gate constant that stopped it, so the sentence says what is missing rather than shrugging; the counts in the examples are whatever that window held.

| confidence / gate | copy, verbatim |
| --- | --- |
| `none` · `too-few-events`, nothing at all yet | No drifts recorded yet, so there is no direction to call. It needs 6 drifts on 3 different days before it will draw a line. |
| `none` · `too-few-events` | Not enough history to call a direction yet — 4 drifts across 2 days. It needs 6, on 3 different days, before it will draw a line. |
| `none` · `too-few-days` | All 7 drifts landed on 1 day. That is one stretch of time, not a trend — it needs 3 different days. |
| `none` · `lopsided-halves` | One half of your history has too few drifts to compare against the other — it needs 3 on each side. |
| `none` · `censoring-limited` | Most of your rounds ran clean, so the ones that drifted are the short ones. That is a biased sample and no direction is being read from it. |
| `weak` · `below-noise` | Roughly flat: the change (1 min) is smaller than your round-to-round spread (±4 min), so it is noise, not progress. |
| `weak` · `sign-disagreement` | Your first and last halves disagree with the overall slope, so nothing is being claimed either way. |
| `weak` · `unstable` | Drop any single round and the direction changes, so that is noise rather than a trend. |
| `clear` · fixture `improving` | Up 7 minutes: 21 minutes now against 15 earlier, across 20 drifts on 10 days. Comparing first rounds only — later rounds of a plan are systematically harder. |

**Sparkline caption** — the debrief prints the trend as a single caption under *The number* (§7.3), and on that surface it is the *only* thing said about direction. It therefore names the same gate as the sentence above, with the same counts, and it is produced by `holdSparkCaption` in `copy.ts` rather than by the renderer's geometry — composing it next to the SVG is precisely how it once came to give one gate's reason for all seven.

| gate | copy, verbatim |
| --- | --- |
| `too-few-events`, nothing at all yet | dots only — no drifts recorded yet — a line needs 6, on 3 different days. |
| `too-few-events` | dots only — 4 drifts so far — a line needs 6, on 3 different days. |
| `too-few-days` | dots only — 7 drifts, but on 1 day — a line needs 3. |
| `lopsided-halves` | dots only — one half has fewer than 3 drifts to compare against the other. |
| `censoring-limited` | dots only — most rounds ran clean, so the ones that drifted are a biased sample. |
| `below-noise` | dots only — the change is smaller than your round-to-round spread. |
| `sign-disagreement` | dots only — your two halves and the overall slope disagree. |
| `unstable` | dots only — drop any single round and the direction changes. |
| all seven passed | Theil–Sen line — the direction the gates cleared. |

**Method caveat.** The like-for-like caveat is always available under *Why this?* and rides the tail of the clear trend line rather than sitting under it as a footnote. The `clear` row above carries the round-1 variant; the same window compared across mixed rounds reads:

> Up 7 minutes: 21 minutes now against 15 earlier, across 20 drifts on 10 days. Mixing first and later rounds, which are not equally hard.

**Forecast-off note**, appended whenever `forecastEnabled === false`:

> Focus Forecast is off, so there is no early read and no risk curve in the debrief — this plans from drifts only.

### 6.3 "Why this?" — the evidence disclosure

The single most auditable thing on screen, and a hard requirement rather than a nicety. One row per round in the window, **ineligible rounds shown greyed with their exclusion reason**, and the method string printed verbatim underneath:

```
Mon 21:04   round 1   25 min planned   drifted at 19:12   →  Discord
Mon 21:34   round 2   25 min planned   drifted at 22:40   →  left the desk
Tue 19:10   round 1   25 min planned   no drift           →  held all 25
Tue 19:41   round 2    2 min served    —                  →  too short to count
Wed 20:02   round 1   25 min planned   —                  →  started with a blocked app already open

Method: Kaplan–Meier median of 3 rounds (2 drifts, 1 clean) over the last 28 days.
        First 3 drifts against the last 3, first rounds only.
```

A student who reads "5 rounds" in their history and "3 rounds" in the reasoning must be able to find the other two. That table is what converts the honesty story from copywriting into something a judge can audit on screen.

### 6.4 Copy rules (a checklist the reviewer applies)

1. Never an imperative with a consequence attached. *"Aim for 21"*, never *"You must stop at 21"*.
2. Never "you failed", "you lost focus". The verb is **drifted**, and it is always paired with a number.
3. Every claim names its evidence in the same sentence or the next one.
4. The student's own number is always an equal choice, at equal visual weight.
5. When the system does not know, that goes in the body — never in grey 11 px.
6. No exclamation marks. No emoji. No "Great job!". A number that went up is the celebration.
7. Numbers never render as `—`, `0`, `NaN` or `undefined`. If there is nothing to say, the rung copy says there is nothing to say.

### 6.5 Accessibility

The card is a `<section aria-label="Focus plan">`; the headline is an `<h2>`; the reasoning is prose in one `<p>`, not a row of chips, so it can be read aloud. No animation on the number — it changes when a round ends, not while you look at it.

---

## 7. The post-session debrief

### 7.1 Three homes, one component, no new route

`DebriefCard` renders in three existing places. No modal, no interruption.

1. **`LockPage`, break panel** (`onBreak === true`, lock already released) — the compact form. The natural home: the break is exactly when you want to know how the round went.
2. **`LockPage`, done panel** (`timer.status === "done"`, inside the existing `Finished` component under its headline) — the full form, plus a session roll-up. The existing *Back to the panel* button is unchanged.
3. **`SetupPage`**, under the plan card, when the newest ledger round ended within `PLAN_DEBRIEF_FRESH_MS` (30 min) and has not been dismissed — so a judge who closed the app mid-break still sees it, and so one still can show the card and the debrief together.

### 7.2 Real copy

**Drifted round, forecast on** — the full form

> **ROUND DEBRIEF** · round 2 of 4
> ### You held 19 minutes.
>
> **Where it went** Risk peaked at 78% about 14 minutes in — four minutes before you tabbed out to Discord.
> **The rhythm** Three drifts, at 19, 26 and 31 minutes. Once it started, roughly every 6 minutes.
> **What it cost** One fuse burned at 20:14. Discord force-quit. Nothing else was touched.
> **The number** Minutes to first drift: **19**. Your median is 20 across 6 rounds.
> **Next round** 20 minutes, then 4 off — the middle of your last three.
>
> `[ Use this plan ]` · Nothing here left this machine.

**Clean round**

> ### 25 minutes, no drift.
> **Where it went** Risk peaked at 41% about 18 minutes in and came back down on its own. No nudge, no fuse.
> **The number** You did not drift, so this round tells us your limit is past 25 minutes and nothing more precise.
> **Next round** 28 minutes, then 6 off — three more, to go find the edge.

**Aborted round, under five minutes**

> ### Round ended after 3 minutes.
> Too short to measure — this one is not counted. Nothing about your plan changed.

**Round that started drifted**

> ### This round started with a blocked app already up.
> There is no "minutes until first drift" to record when the drift is minute zero. That measures your window layout, not your attention, so it is recorded and left out of the estimate.

**Forecast off**

> **Where it went** Focus Forecast is off, so there is no risk curve for this round. The drift times below are from the policy engine, which is always on.

**Wobble that stood down** (H7)

> **Where it went** The forecast flagged a wobble 11 minutes in and stood down on its own two minutes later. That is a warning, not a drift — it is not counted as one.

**First-ever debrief — the cold-start guarantee at the far end**

> ### First round logged. You held 18 minutes.
> That is your baseline, from one round. Run one more and I can tell you whether 18 is you or was just tonight. Risk crossed the warning line at 16:20; the strongest signal at that moment was **grey-app time (64% of the last 60 s)**.
> **Next round** 18 minutes, then 4 off.

Phrased *"the strongest signal at that moment was"*, never *"because"* — the attribution is an occlusion delta, and the forecast's own panels already say so. The phrase itself comes from `featurePhrase` in `src/renderer/src/features/forecast/copy.ts`; there is no second copy table for features.

**Session roll-up** (done panel only, appended)

> **Session** 4 rounds, 1 h 40 m of work served. First drift at 19, 24, 17 and 22 minutes. Median 20.5. One kill.

### 7.3 The sparkline

A 120 × 28 px inline SVG under *The number*, reusing the geometry idiom of `sparklineView` in `features/forecast/model.ts`: one mark per round in the window, x by index, y by `holdMin`. Censored rounds are **open** circles with a small upward tick (the standard censoring mark); events are filled dots. A horizontal rule at the current median. **A trend line is drawn only when `trend.confidence === "clear"`**, and it is the Theil–Sen line, not least-squares. Otherwise there is no line at all, and the caption — the ONLY thing this surface says about direction — names the gate that stopped it: `holdSparkCaption(trend, hasLine)` in `copy.ts`, one sentence per gate, quoted verbatim and byte-checked in §6.2. It is not composed here beside the SVG, and `model.test.ts` fails the build if it ever is again. Colours come from the existing `Tone` tokens; no new palette.

---

## 8. Mid-session revision, on the nudge surface that already ships

### 8.1 The revision is computed in the renderer, and main is untouched

The nudge already exists end to end: main decides (`NudgeTracker`, `applyPolicyEvent`), main brings the window forward (`revealWindow`), main pushes `NudgeEvent`, and `NudgeOverlay` renders kicker / title / big clock / encouragement, dismissing on click, Escape, or 12 s.

Focus Plan adds **one sentence** to that overlay. It does not add a channel, a timer, a toast, a sound, a countdown, or a second dialog.

The revision needs the plan's segment clock (`timer.position`), the live risk (`app.forecast`), the forecast events (`app.forecastEvents`) and the estimate — and **all four already live in the renderer**. Computing it there means:

* `src/shared/nudge.ts` is **untouched** — no new field on `NudgeEvent`, no change to `nudgeCopy`, and `nudge.test.ts` stays green unchanged;
* `src/main/**` is untouched by this surface entirely;
* nothing about the plan can reach the enforcement loop, because it never enters main.

The alternative — computing it in main — would require pushing plan segment timings into the main process on a tick and would couple the coaching layer to the loop that decides kills. Rejected on those grounds alone.

### 8.2 The rule

`reviseBreak(input): PlanRevision | null` in `src/shared/plan/revise.ts`, pure, no imports outside `src/shared/plan`:

```
if estimateMin === null            -> null   // never invent a comparison
if countdownActive                 -> null   // a nudge during a burning fuse is about the fuse

earlier  when wobbled
         and elapsedSec   >= PLAN_REVISE_MIN_ELAPSED_FRACTION (0.6) * estimateMin * 60
         and remainingSec >= PLAN_REVISE_MIN_DELTA_SEC (180)
         -> suggestedBreakInSec = min(remainingSec, PLAN_REVISE_EARLY_SEC = 180)

later    when risk !== null and risk < PLAN_REVISE_CALM_FRACTION (0.6) * nudgeRisk
         and elapsedSec   >= estimateMin * 60 + PLAN_REVISE_LATE_SEC (120)
         and remainingSec <= PLAN_REVISE_MIN_DELTA_SEC
         -> suggestedBreakInSec = remainingSec + PLAN_REVISE_EXTEND_SEC (300)

otherwise -> null
```

**`countdownActive` is a hard guard, and it is the most important line in this section.** `wobbled` requires a real `forecast_nudge` or `forecast_prearm` this block — a bare risk reading is not enough.

The suggested early break is never "now": a break offered at the exact instant of a drift is indistinguishable from an escape hatch, and this product does not offer one. Three minutes is a break you walk to, not a fuse you dodge.

No cooldown is needed — the overlay only appears when main fires a nudge, and `NUDGE_REPEAT_MS` (30 s) already rate-limits that.

### 8.3 The rendered line

One `<p>` beneath the existing `copy.line`, inside the existing `aria-live="polite"` region, in the muted zinc the overlay already uses:

**earlier**
> *Plan — you are hitting your limit early. Break in 3 minutes instead of 9? Skip round takes it now; nothing moves unless you move it.*

**later**
> *Plan — you are 4 minutes past your usual limit and still calm. Your break is in 2 minutes. Skip it and push to 25 if you are in it; your call.*

### 8.4 Why there is no button — settled, and verified against the code

**Focus Plan adds no control to the nudge overlay.** "Skip round" names a control that already exists on `LockPage` (`<Quiet onClick={timer.skip}>Skip round</Quiet>`), one screen away.

This is not squeamishness. Trace the real path: the `blocked` nudge is emitted by the controller at `start_countdown` — `this.nudges.blocked(armedAt); await this.nudge("blocked", …)` — i.e. **while the fuse is burning**. `timer.skip()` on a focus block advances to the break, `armed` goes false, Shell calls `stopSession()`, and `SessionController.stop()` calls `clearFuse()`. A one-click "Break now" on that overlay is therefore a **one-tap cancel of a live countdown, offered at the exact moment the fuse is lit**. That is a new, prominent escape hatch from the product's only enforcement, and the product's identity is that the kill is the one thing it does not negotiate.

The existing Skip is already there for anyone who wants it. It is deliberately not under the cursor at the worst possible moment.

### 8.5 What the revision cannot do

It cannot change `armed`, cannot call `startSession`/`stopSession`, cannot alter `countdownSec`, cannot touch settings, and cannot re-enter main. **It returns a string.** A unit test asserts `reviseBreak` is a pure function of its input, and the purity fence forbids it from importing anything outside `src/shared/plan`.

### 8.6 The direction that gets no live message

A student holding *longer* than planned only hears from the plan if a nudge happens to fire while they are calm — which is the `later` branch, and it is rare by construction. That is correct: nothing should interrupt someone who is doing well. "You could go longer" belongs to the debrief and the next proposal, and that is where it is.

---

## 9. Integration seams (why they are these and not others)

### 9.1 `SESSION_START` gains one optional argument — and the controller never sees it

Focus Plan needs `plannedFocusSec` (the denominator for `completed`/`aborted` and for `driftedEarly`), `roundKey` (pause/resume merging), `round`/`roundsTotal` (like-for-like), and whether the offer was accepted. That is renderer state; main cannot know it.

The seam is one optional argument on `SESSION_START`, and it is consumed **in `src/main/index.ts`, not in the controller**:

```ts
ipcMain.handle(IPC_INVOKE.SESSION_START, async (_event, context?: unknown) => {
  focusPlan.declareRound(context);   // validates untrusted input; never throws
  return controller.start();
});
```

Three things fall out of this, all of them wins over every proposal on the table:

* **`SessionControllerOptions` gains no plan-shaped key at all**, and a compile-time `Exclude<keyof SessionControllerOptions, …>` assertion plus a runtime `Object.keys` check pins that (§11.2). Focus Plan has no seam into the fuse authority, by construction rather than by discipline.
* **`controller.start()` is unchanged** and `src/main/session/adaptiveFuse.ts` is **untouched** (see 9.2).
* **There is no accept/start race.** `declareRound` runs synchronously immediately before `controller.start()` in the same handler, so the recorder always has the context before the first `sessionState` push arrives. No pending-block adoption machinery, no grace window, no ordering test to write.

The renderer half: `useSessionTimer`'s `onEnforce` widens to `(armed: boolean, arm: SessionArmContext | null) => void`. The hook supplies what the run clock knows (`roundKey` from `startedAtMs` + segment index, round, roundsTotal, planned focus/break seconds); `Shell` merges in what Focus Plan offered (`recommendedFocusSec`, `acceptedRecommendation`) via `planContextFor(arm, recommendation)` and calls `startSession(context)`. Two small honest pieces, and it avoids the circular dependency that would follow from Shell reading `timer.position` inside the callback it hands to `useSessionTimer`.

### 9.2 `ASSUMED_SESSION_MIN` stays exactly as it is

The same argument *could* be forwarded to `AdaptiveFuse.startSession` and retire the admitted `ASSUMED_SESSION_MIN = 25` wart. **It is not, and that is a deliberate reversal of the integration cut's own proposal.**

`sessionLeft` is one feature of seventeen in a model that is already learned and on disk for every existing install. Feeding it the real number changes that feature's distribution — and therefore the fuse lengths people get — without a layout bump to discard the stale weights. Gating it behind `focusPlanEnabled` (as the base proposal did) makes it worse, not better: a coaching toggle would silently change enforcement timing. The correct home for that change is a `FEATURE_LAYOUT` bump in `src/shared/adapt/model.ts`, which discards every model on disk and relearns, with its own `gauntlet:adapt` run to justify it.

**Consequence:** `src/main/session/adaptiveFuse.ts` is on the UNTOUCHED list, `resolveFuse` has no new input, and the containment test's "byte-identical enforcement with the plan on and off" assertion is trivially true rather than argued. It is also a follow-up written down in the doc, not a wart quietly left.

### 9.3 The tap

`src/main/focusplan/tap.ts` is a structural mirror of `src/main/forecast/tap.ts`: forward to the base push **first**, then mirror, and `swallow()` anything that escapes. `withPlan(SessionPush, PlanTap)` and `withPlanForecast(ForecastPush, PlanTap)`. `runtime.ts` composes:

```ts
push: withForecast(withPlan(options.push, plan.sessionTap), forecast.monitor)
// and
createForecast({ …, push: withPlanForecast(options.forecastPush ?? silentForecastPush(), plan.forecastTap) })
```

The recorder itself is `guard()`-ed exactly like `ForecastMonitor`: the first thrown error latches Focus Plan off for the session, writes one `SessionEvent{kind:"plan", detail:"off · <message>"}`, and the session proceeds untouched.

### 9.4 The log

New `SessionEvent.kind = "plan"` — free, because `SessionEvent.kind` is a bare `string` in the byte-locked `types.ts`.

```
plan · round 1 — first drift at 19.3 min (planned 25)
plan · round 2 — no drift in 25.0 min (censored, completed)
plan · round 3 — not counted, started with a blocked app already open
plan · history cleared (37 rounds)
plan · off · <message>
```

Add `{ id:"plan", label:"Focus Plan", kinds:["plan"], always:false }` to `KIND_FILTERS` in `features/logs/filters.ts` and `plan: "Focus Plan"` to `KIND_LABELS` in `features/logs/eventModel.ts`.

**Do NOT add `"plan"` to `PREVIEW_KINDS`** in `features/session/model.ts`. The console timeline is about the enforcement chain — cause, countdown, consequence, recovery — and coaching rows dilute it. The rows are findable in *Log*, which is where a reviewer goes to audit them. `classifySessionEvent` needs no branch (an unknown kind already defaults to `"cause"`, and `isEnforcementEvent` already returns false for kinds outside `PREVIEW_KINDS`).

---

## 10. File layout and the purity fence

### NEW — shared (pure core, browser-importable)

```
src/shared/plan/
  types.ts        every contract        constants.ts    every tunable, one file
  drift.ts        stepOnset + round classification            (+ .test.ts)
  survival.ts     kaplanMeier, median, lowerBound             (+ .test.ts)
  trend.ts        theilSen, median, iqr, leaveOneOut, planTrend (+ .test.ts)
  ledger.ts       normalizeRound, reviveLedger, selectWindow,
                  samplesFrom, ledgerFromSessionLog           (+ .test.ts)
  estimate.ts     the ladder → PlanEstimate                   (+ .test.ts)
  progression.ts  → PlanRecommendation                        (+ .test.ts)
  debrief.ts      PlanRound + window → PlanDebrief            (+ .test.ts)
  revise.ts       reviseBreak                                 (+ .test.ts)
  copy.ts         EVERY user-visible string                   (+ .test.ts)
  fixtures.ts     named ledgers: fresh, liveWobble, liveQuiet, single,
                  clean3, drift19_22_20, pair, improving, stationary20,
                  stretchReady, easeReady, censorHeavy, mixedRounds,
                  abortedWithDrift, abortedShort, cleanOnly
  gauntlet.ts     npm run gauntlet:plan
  index.ts        barrel
  purity.test.ts  the forecast fence, pointed here
  docs.test.ts    §6.2's quotes, checked against the real copy
```

`purity.test.ts` is a verbatim adaptation of `src/shared/forecast/purity.test.ts` — same forbidden-module list, same comment/string stripping, **same positive controls** so a green run means the checker still works. Plus one extra forbidden list for this feature: nothing under `src/shared/plan` may import `../policy`, `../../main`, or anything named `kill`. That is what lets `npm run plan:stills` render the real cards in a plain browser off the named fixtures, with no Electron anywhere, and what would let `demo/` import the plan core (`@shared` is already aliased in `demo/vite.config.ts`) — which it does not do today. The demo stays the forecast's scripted stream; the fence is kept so extending it is a choice rather than a rewrite.

### NEW — main

```
src/main/focusplan/
  recorder.ts     PlanRecorder — tap handlers, round open/merge/close,
                  declareRound, ledger write, guard/trip        (+ .test.ts)
  tap.ts          withPlan, withPlanForecast                    (+ .test.ts)
  ledger.ts       main-side ledger seam: revive, append/merge,
                  planStateWindow, localDayStamp
  harness.ts      the plan's OWN test doubles, kept out of
                  src/main/session/harness.ts on purpose
  index.ts        createFocusPlan() → { sessionTap, forecastTap,
                  declareRound, getState, reset }
  integration.test.ts   real SessionController + harness, incl. the uncoupling test
```

### NEW — renderer

```
src/renderer/src/features/focusplan/
  PlanCard.tsx      DebriefCard.tsx    Evidence.tsx    HoldSparkline.tsx
  model.ts          view-model, pure                             (+ .test.ts)
  context.ts        planContextFor()                             (+ .test.ts)
  scenes.ts         the mockApi / plan:stills scenes             (+ .test.ts)
  useFocusPlan.ts   fetch + subscribe
  plan.css          index.ts
  evidence/         the stills plan:stills writes
```

### NEW — scripts / docs

```
scripts/plan-stills.mjs
docs/FOCUS-PLAN.md          the design + the frozen-contracts appendix
```

### MODIFIED (exhaustive)

| file | change |
| --- | --- |
| `src/shared/ipc.ts` | 2 invoke channels, 1 push channel, 3 map entries, widened `sessionStart`, 3 new api methods, 2 settings keys, re-exports |
| `src/shared/defaults.ts` | 2 defaults |
| `src/main/store/appStore.ts` | 2 `normalizeSettings` clamps; `loadPlanLedger`/`savePlanLedger` on `FocusPlugStore` writing `focus-plan.json` via the existing `writeJsonAtomic` |
| `src/main/session/controller.ts` | `SessionStore` gains the two optional ledger methods; `requirePatch` gains 2 boolean validators. **Nothing else** — not `start`, not `evaluateOnce`, not `resolveFuse`, not `applyPolicyEvent`, not `buildPolicyInput`, not `SessionControllerOptions` |
| `src/main/session/runtime.ts` | construct `createFocusPlan`, compose the two taps, return it on `FocusPlugRuntime` |
| `src/main/session/evidence/golden-path.json` | the settings snapshot gains the 2 new keys. The policy events, states, kill calls and countdown seconds it pins are **unchanged**, which is the point |
| `src/main/index.ts` | 2 invoke handlers, 1 broadcast, `SESSION_START` forwards the optional context to `focusPlan.declareRound` before `controller.start()` |
| `src/preload/index.ts` | 3 methods (`planGetState`, `planReset`, `onPlanRound`) and the widened `sessionStart(context?)`. `index.d.ts` is **unchanged** — it only declares `window.focusplug: FocusPlugApi`, and that type moved in `ipc.ts` |
| `src/renderer/src/lib/mockApi.ts` | plan state from `fixtures.ts`, `?scene=plan-cold` / `plan-measured` / `plan-mixed` / `debrief-drifted` / `debrief-clean` / `debrief-flat` / `nudge-revision` |
| `src/renderer/src/state/AppState.tsx` | `startSession(context?)` — one optional argument, and **nothing else**. The plan state, the reset and the `onPlanRound` subscription live in `features/focusplan/useFocusPlan.ts`, deliberately outside the session loop's own state |
| `src/renderer/src/features/timer/useSessionTimer.ts` | `onEnforce(armed, arm)` — one added argument, `arm` non-null only when arming |
| `src/renderer/src/components/Shell.tsx` | build the context in `onEnforce`; pass `revision` to `NudgeOverlay` |
| `src/renderer/src/features/nudge/NudgeOverlay.tsx` | optional `revision?: PlanRevision` prop, one `<p>`. **No new control** |
| `src/renderer/src/pages/SetupPage.tsx` | `<PlanCard>` under the hero + fresh `<DebriefCard>`; shift the later `animationDelay` values |
| `src/renderer/src/pages/LockPage.tsx` | `<DebriefCard>` in the break panel and inside `Finished` |
| `src/renderer/src/pages/SettingsPage.tsx` | Focus Plan section: 2 toggles, file path, `ConfirmAction` reset |
| `src/renderer/src/features/logs/filters.ts` | `plan` kind filter |
| `src/renderer/src/features/logs/eventModel.ts` | `plan: "Focus Plan"` in `KIND_LABELS` |
| `scripts/check-contracts.mjs` | generalised from one hard-coded fence to a list, so the appendix's two "complete source" fences are byte-checked by the build rather than by eye |
| `vitest.config.ts` | `"src/main/focusplan/**/*.test.ts"` added to `include` — without it the three main-side test files are silently outside `npm test` |
| `package.json` | `test:plan`, `gauntlet:plan`, `plan:stills` |
| `docs/CONTRACTS.md` | append-only `## Focus Plan (Phase 5)` section **below** the frozen Types fence |
| `README.md` | one subsection under "The AI that is actually in it" |

`src/main/session/harness.ts` is **not** on this list, and an early draft of it was wrong to be: the plan's test doubles live in the new `src/main/focusplan/harness.ts` instead, precisely so `PushTrace` and `createMemoryStore` stay untouched — the uncoupling test deep-equals two traces, and an extra field would make that assertion fail for the wrong reason.

The list covers source. Running `npm run demo:verify` or `npm run plan:stills` also rewrites the PNGs under `demo/evidence/` and `src/renderer/src/features/focusplan/evidence/`; the demo stills are re-rendered by that command rather than changed by this feature, and their bytes differ run to run.

### UNTOUCHED (asserted by tests / CI)

`src/shared/types.ts` (byte-locked) · `src/shared/nudge.ts` · `src/shared/policy/**` · `src/shared/forecast/**` · `src/shared/adapt/**` · `src/main/session/push.ts` · `src/main/session/fuseAuthority.ts` · **`src/main/session/adaptiveFuse.ts`** · `src/main/kill/**` · `src/main/desk/**` · `src/main/plugs/**` · `src/main/forecast/**` · the `docs/CONTRACTS.md` Types fence.

---

## 11. Test plan

House idiom throughout: `vitest`, deterministic, `MutableClock` and the scripted monitors from `src/main/session/harness.ts`, no wall clock, no sleeps, no DOM snapshots.

### 11.1 Pure core

**`drift.test.ts` — the highest-value test in the suite.**
* **Equivalence:** folding `stepOnset` over an arbitrary `DecisionFrame[]` equals `findDriftOnsets(frames).map(o => o.t)`, over ~12 hand-written sequences including flaps, a session that starts drifted, and onsets 29 s apart (merged) vs 31 s apart (kept).
* `AWAY` yields `driftType: "walk_away"`; `DISTRACTED` yields `"tab_out"`.
* Every row of the §3.3 table.
* `startedDrifted` fires at 19 s and not at 21 s; and not at 5 s when a non-drifted, non-IDLE decision was seen first.
* A 2-minute clean round is `discarded`; a 2-minute round **with** a drift is an event.

**`survival.test.ts`**
* `[19, 22, 20]` all events → curve `0.667 / 0.333 / 0`, median **20**. (Pins the decided copy.)
* All censored → median `null`, `lowerBound = max`.
* One event at 12, three censored at 25 → `Ŝ` never reaches 0.5 → median `null`. **This is the case that must not silently return 12.**
* Ties: an event and a censoring at the same t → event first; assert the exact survival value.
* Empty input → empty curve, median `null`, no throw.

**`trend.test.ts`**
* Each of the seven gates fails in isolation and `blockedBy` names it: 5 events; 6 events on 2 days; 6 split 5/1; 60% censored; delta 1 min against IQR 6; a series whose halves disagree with Theil–Sen; a series where dropping one point flips the sign.
* All gates pass on a monotone rise → `up`, `clear`, positive slope.
* One wild outlier added to a flat series → Theil–Sen stays flat where least-squares would not (**assert both**, so the estimator choice is documented by test rather than by comment).
* `slopeMinPerRound === null` for every non-`clear` confidence — fuzzed over 500 random windows.
* Round-1 restriction fires at 6 round-1 events and the method string says so; below that the caveat string is present.

**`estimate.test.ts`** — one test per rung from `fixtures.ts`, asserting `rung`, `medianMin`, `provisional`, `refusal`.
* Fresh install, live round at 8 min, no wobble → `no-history` (no completed round, no wobble) with `lowerBoundMin` populated from the live round.
* Fresh install, live round, one `forecast_nudge` at 11 min → `wobble-only`, `medianMin: 11`, `provisional: true`.
* **Three clean 25-min rounds that each wobbled at 11 → `censored-only`, NOT `wobble-only`.** The ordering rule, pinned.
* Forecast off, no drifts → `refusal: "forecast-off"` on the wobble path, rung falls through.
* One real drift → the provisional reading is gone: `provisional === false`, `events === 1`.

**`progression.test.ts`**
* The decided examples produce 25/5, 20/4, 21/4 — and the test **names the 20 → 4 divergence in its own description**, so a future reader finds the reasoning rather than filing a bug.
* Break rule reproduces `SHAPES`: 25→5, 50→10, 15→3. 90→15 (cap), 10→3 (floor).
* Stretch fires only on two consecutive `heldToTarget`; one held + one drifted → `hold`.
* Ease fires on two consecutive `driftedEarly`; recovery to `hold` after one held round.
* `provisional` estimates never step.
* `bestHeldMin + 10` cap binds: median 20, best held 20, `censored-only` stretch cannot exceed 30.
* `censored-only` with one completed round does not stretch; with two, it does.
* `focusPlanStretchEnabled: false` ⇒ `step` always `hold`.

**`revise.test.ts`**
* `estimateMin: null` ⇒ `null`. **`countdownActive: true` ⇒ `null`** (the guard, tested first).
* `earlier` fires at 0.6 × estimate with a wobble and ≥3 min left; not at 0.5 ×; not without a wobble.
* `later` fires only when calm, past the estimate, and near the block's end.
* The suggested early break is never < 60 s and never "now".

**`ledger.test.ts`**
* Revive rejects wrong `v`, non-array rounds, NaN offsets, negative `servedSec` — each ⇒ empty ledger, no throw.
* `selectWindow` respects both `PLAN_WINDOW_ROUNDS` and `PLAN_WINDOW_DAYS`, and drops `discarded`.
* `ledgerFromSessionLog(log)` reproduces the recorder's rounds for a scripted `SessionEvent[]` — the log/ledger agreement test.

**`copy.test.ts` — the honesty harness.** Over the cross-product of `{rung} × {step} × {trend confidence} × {blockedBy}` and every debrief branch:
* Every string non-empty; no `NaN`, `null`, `undefined`, `Infinity`, `—`, or a bare `0` minute count.
* **The digit-membership fuzz (H10):** regex-extract every number in a rendered sentence and assert set-membership in the model that produced it, over 5 000 random `PlanRecommendation` / `PlanDebrief` values. Copy physically cannot invent a figure.
* `no-history` copy contains the words "no history"; `wobble-only` copy contains "provisional" and the sentence explaining what a wobble is.
* Every confidence below `clear` carries an explicit refusal clause, and no such string contains "up", "down", "improving" or "worse" outside the refusal itself.
* `PlanDebriefCopy.theNumber` is non-empty in every branch (H11).
* Every card variant carries the never-enforced line.

**`purity.test.ts`** — the forecast fence with its positive controls, pointed at `src/shared/plan`, plus the extra forbidden imports.

**`docs.test.ts`** — §6.2 above is titled *Real copy, every rung*, so it is read back off disk and every quoted blockquote line and trend-table cell has to be a string the copy layer really emits, over the named fixtures and every gate. It carries a positive control: a plausible near-miss sentence must NOT be found. A doc quote that has drifted from the code is the one documentation error this feature cannot afford, and `npm run check:contracts` covers the two frozen source fences for the same reason.

### 11.2 Main

**`recorder.test.ts`** — `MutableClock`, scripted taps, no controller:
* One clean round → `completed`, censored, `firstDriftSec: null`.
* Drift at +19 min → `firstDriftSec: 1140`, `firstDriftType: "tab_out"`.
* Two onsets 20 s apart → merged by `DRIFT_DEBOUNCE_SEC` into one.
* Pause/resume with the same `roundKey` → one round; `servedSec` excludes the gap; a drift after the resume is stamped in **served** seconds.
* Clock jumps 4 h mid-round → the per-delta clamp holds `servedSec` sane; a 3× over-run marks `discarded`.
* First status `DISTRACTED` inside 20 s → `startedDrifted: true`, no MUFD.
* `declareRound` with a malformed payload → context ignored, round still recorded, no throw.
* `focusPlanEnabled: false` → zero ledger writes, zero pushes, `getState().enabled === false`, and the estimator chain the renderer runs returns `null`, which is what makes both cards render nothing.
* `FOCUSPLUG_NO_PLAN=1`, over a store holding twelve real rounds → `getState()` is exactly `{v:1, enabled:true, rounds:[], lifetimeRounds:0}`; `loadPlanLedger` is called **zero** times and `savePlanLedger` zero times; the twelve rounds are still on disk afterwards; a full round records, pushes and logs nothing; `reset()` returns the cold state and writes nothing; and that state, run through `selectWindow` + `recommend` exactly as `usePlanRecommendation` does, produces `rung: "no-history"` with the fresh-install headline. The pin and the master switch are asserted against each other in the same block, because their difference is the whole reason the pin exists.
* A throwing `savePlanLedger` → one `plan · off` line, the round still pushes, no exception escapes.

**`tap.test.ts`** — mirror of `src/main/forecast/tap.test.ts`: every base channel forwarded first and exactly once, even when the plan handler throws on each; the untapped channels (`sessionEvent`, `nudge`) still forward.

**`integration.test.ts` — the uncoupling test, and it must never be deleted.** Real `SessionController` via `harness.ts`, `RecordingKiller`, `ScriptedWindowMonitor`/`ScriptedDeskMonitor`, `tickIntervalMs: 0`, driven by `flush()`:
* Golden path (docs → Discord → countdown → kill → docs → unlock) run twice: once with no plan, once with a `PlanRecorder` whose every method throws.
* Assert `trace.policies`, `trace.states`, `trace.focus`, `trace.desk` and `killer.calls` are **deep-equal**, `trace.events` deep-equal after filtering `kind === "plan"`, and every `start_countdown.seconds` identical.
* Assert `SessionControllerOptions` has **no plan-shaped key** — a compile-time `Exclude<keyof SessionControllerOptions, KnownKeys>` assertion plus a runtime `Object.keys` check on a constructed options object, so a future seam fails the build.
* `PLAN_RESET` mid-session does not perturb the running round's enforcement.
* A happy-path run with a working recorder asserts the exact `PlanRound` end to end.

### 11.3 Renderer

* `model.test.ts` — every rung yields a view with a non-empty headline and non-empty reasoning; **no view ever renders an empty state**. `alreadyMatches` behaviour. The evidence list includes ineligible rows with their reason (H9).
* `context.test.ts` — `planContextFor` produces a stable `roundKey` across pause/resume, and distinct keys across segments and across plan restarts.
* Sparkline geometry: 3 points, 1 censored → 3 marks, 1 open, **0 line elements**; 7 points with `clear` trend → exactly 1 line element.

### 11.4 Screens

`npm run plan:stills` drives `preview:renderer` at `?scene=plan-cold`, `plan-measured`, `plan-mixed`, `debrief-drifted`, `debrief-clean` and `debrief-flat`, writing PNGs to `src/renderer/src/features/focusplan/evidence/`. **The cold-start still is the artifact that proves rung 0 is not an empty state**, and it is the one to put in the README. `debrief-flat` is the other one worth looking at: twenty rounds over ten evenings from a student who is not improving, where every volume gate passes and the trend is refused by `below-noise` — the card and the caption both have to say *that*, and a screenshot is the cheapest way to check they do. The script asserts the card is actually on the page before it saves each PNG and exits non-zero if it is not, so "not an empty state" cannot rot into a screenshot of a blank panel.

`nudge-revision` is deliberately **not** photographed. The revision line needs a live focus block — `liveRoundFor` returns null without one — and a URL scene cannot start the renderer's run clock, so a still would mean replaying the hold gesture the way `scripts/readme-stills.mjs` does. It is asserted by test instead: `revisionFor` in `model.test.ts` and `reviseBreak` in `revise.test.ts`, including the guard that keeps it silent while a fuse is burning.

### 11.5 `npm run gauntlet:plan`

Mirrors `gauntlet:adapt` in spirit and in disclosure, and **reuses `src/shared/adapt/population.ts`'s seeded `rng()` rather than writing a second sampler.** It replays synthetic students through the ledger reducer, the estimator and the progression rule, and prints:

* rounds completed without a drift under Focus Plan vs a fixed 25/5;
* total focus minutes served under each;
* rounds needed before the estimator's median landed within ±3 min of the student's true limit;
* median absolute error of the median with and without censoring handling — **the second number must be visibly worse**, which is the evidence that Kaplan–Meier is earning its place rather than decorating the doc;
* **the CI gate, and the point of the whole script:** on a *stationary* population (no true improvement), the trend must report `clear` in **under 5%** of runs. A trend detector that finds trends in noise is worse than no trend detector. The build fails if it does.

Printed with the disclaimer `gauntlet:adapt` carries verbatim in spirit: *this is a simulation against simulated students; the per-install measurement is the real claim, and it has no number until it has watched you work.*

### 11.6 CI

`npm run typecheck` (which already byte-checks `types.ts`), `npm test` — whose `vitest.config.ts` `include` covers `src/main/focusplan/**/*.test.ts`, so the main-side tests are in the default run and not only in the focused one — `npm run test:plan`, and `npm run gauntlet:plan` for the false-trend gate.

---

## 12. Risks and cut lines

### Risks

1. **Informative censoring biases the estimate.** The plan picks the round length; the round length is what censors. Cannot be removed. Mitigated by the `censoring-limited` gate and the `censored-only` stretch, and disclosed verbatim in the debrief copy.
2. **`DEFAULT_PLAN` is 50/10/1 and rung 0 recommends 25/5.** A fresh user is offered a materially shorter round than the app's own default. Deliberate — a 25-minute round produces a measurement tonight — and the copy owns it ("start short … short enough that this round produces a number"). It is an offer; the Dial is untouched unless they press the button.
3. **The Dial steps in 5s and the plan recommends whole minutes.** `clampPlan` accepts any integer 5–120, so 21 is a legal, persistable plan; but the Dial's arrows from 21 land on 26. Accepted: the primary path is *Use this plan*, and manual editing behaves exactly as today.
4. **The break ratio diverges from the brief's illustrative example** (20 → 4, not 5). Deliberate, argued in §4, flagged in the copy tests, and reversible with one constant.
5. **Pause/resume fragmentation.** Handled by `roundKey` merging (§3.4) and directly tested. If the renderer ever stops driving `startSession` per segment, the merge rule breaks first — the integration test pins it.
6. **Forecast off ⇒ no wobble rung, no peak risk.** The ladder degrades to drift-only and the copy says so. It never fabricates a risk curve.
7. **Two learned systems now read the same rounds.** `adapt` learns P(recover \| fuse); Focus Plan measures time-to-first-drift. Neither reads the other's output, and Focus Plan writes nothing into the fuse authority. The integration test asserts `resolveFuse` output is byte-identical with the plan on and off; if that ever fails, coupling has been introduced accidentally.
8. **The metric is gameable through grey apps.** Tabbing to an app on neither list is not a drift by policy's definition, so a student could "hold 40 minutes" while reading Reddit. We do **not** redefine drift — that would put Focus Plan and the forecast into visible disagreement on the same screen. **This one is unmitigated, and nothing on screen says otherwise.** `PlanRound` carries no off-list field: `tap.ts` deliberately never subscribes to `focusSnapshot`, so the recorder has no grey-time datum to name even if the copy wanted to. Closing it means a new field on the round, a new subscription in the tap, and a new sentence in `copy.ts` — a change with a real cost to the "the tap only listens" property in §9, which is why it is a stated residual risk here rather than a claimed mitigation.
9. **A ledger file is a new thing that can be corrupt.** Revived defensively (empty on any violation), written atomically through the existing helper, exactly like `adaptive-model.json`.
10. **The plan could be read as pressure.** Every escalation is paired with a symmetric, explicitly promised de-escalation; no streak is displayed; no round is ever labelled a failure; `focusPlanStretchEnabled: false` removes progression while keeping the measurement.
11. **A judge sees the debrief before any round completes.** It renders only when a `PlanRound` exists; before that the plan card alone is on screen, and it always has copy.

### Cut lines, in the order they should be cut

1. **The mid-session revision (§8).** Removes `revise.ts`, the `NudgeOverlay` prop and the Shell wiring. Focus Plan becomes plan + debrief. Zero residual risk to the nudge surface; the feature still demos completely.
2. **The sparkline and the trend UI.** Keep `PlanTrend` in the model and render it as the one sentence in §6.2. Removes `HoldSparkline.tsx` and its geometry test.
3. **The "Why this?" evidence disclosure.** Painful — it is the best auditable artifact in the feature — but it is one component and one type, and the method string alone still discharges H6.
4. **The trend entirely.** Ship the rungs, the metric and the ratchet; `planTrend` always returns `unknown` / `blockedBy: "too-few-events"`. Progression then never stretches. The honesty story gets *simpler*, not weaker.
5. **The ledger file.** Derive the window from `logGet()` via `ledgerFromSessionLog` and accept that history older than 1 000 events is gone. Removes the two store methods, `PLAN_RESET`, and `focus-plan.json`.
6. **The `SESSION_START` context argument.** Every round is censored at `servedSec`, the `completed`/`aborted` distinction is lost, and `PLAN_MIN_ROUND_SEC` carries the filtering alone. Cuts one contract change.
7. **Everything except the debrief.** `DebriefCard` on the break and done panels, computed from the just-closed round alone, no ledger, no estimator, no trend: *"You held 19 minutes. Risk peaked at 78% four minutes before you tabbed out."* One card, no persistence, no new settings — and still the most quotable thing in the feature.

### Never cut

* **The `no-history` card copy and the within-round wobble read.** A judge on a fresh install seeing an empty state is the failure this whole design exists to prevent.
* **The `drift.test.ts` equivalence test.** It is what makes "one definition of drift in this product" a failing test rather than a promise.
* **The uncoupling test and the `SessionControllerOptions` assertion.** They are the reason this feature is safe to ship next to a process killer.
* **H1 and H2** — censored rounds are never reported as drift times, and an unreached median says "at least". Get these wrong and the headline metric lies about exactly the students it is supposed to be celebrating.
* **The `countdownActive` guard, and the absence of a button on the nudge overlay.**

---

## 13. Follow-ups, explicitly out of scope

* **Retire `ASSUMED_SESSION_MIN = 25`.** The `SESSION_START` context now carries the real planned length in main, so `adaptiveFuse.ts` could stop guessing. It changes the distribution of the `sessionLeft` feature for every `adaptive-model.json` already on disk, so it belongs behind a `FEATURE_LAYOUT` bump in `src/shared/adapt/model.ts` — a separate change with its own `gauntlet:adapt` run and its own log line (`adapt · session length now known: 25m (was assumed)`).
* **Browser demo integration.** `src/shared/plan` is inside the purity fence and `@shared` is already aliased in `demo/vite.config.ts`, so `demo/` can render the cold-start card before the 94-second scripted run and the debrief after it, from the same code and the same words. One afternoon, after the app ships. That is the entire reason the purity test exists.

## 14. The four questions a reviewer will ask, answered in one line each

* **Where does the drift definition come from?** `src/shared/forecast/labels.ts`, imported. One definition in the product, pinned by an equivalence test.
* **What talks to the kill path?** Nothing. Focus Plan is a push observer and a JSON file. `SessionControllerOptions` has no plan-shaped key — a compile-time assertion enforces it — and a test asserts enforcement is byte-identical with the feature throwing on every call.
* **What does it do on a fresh install?** Recommends 25/5, says it has no history and why, and starts measuring; inside the first round it reads the live risk curve and gives a provisional number off the first wobble, which reaches the student on the nudge that already fires; at the first break it produces a real MUFD.
* **When does it refuse?** When Kaplan–Meier's median is undefined, when fewer than 6 drifts on 3 days exist, when the halves are lopsided, when the window is majority-censored, when the change is inside the student's own spread, when the halves disagree with the slope, or when dropping any single round flips the direction — and in every one of those cases it names the reason in the copy instead of showing a number.

---

## Frozen contracts

# Focus Plan — Frozen-Contracts Appendix (exact)

`src/shared/types.ts` receives **zero** changes; `npm run check:contracts` stays green. Everything below is additive and outside the byte-locked fence, exactly as the forecast did it. `SessionEvent.kind` is a bare `string` in the locked types, so `kind: "plan"` needs no contract edit, and `AppSettings` lives in `src/shared/ipc.ts`, so the two new settings keys are safe.

---

## 1. New shared types — `src/shared/plan/types.ts` (complete source)

```ts
import type { Decision, SessionEvent } from "../types";
import type { DriftType } from "../forecast/types";

/* ────────────────────────────────────────────────────────────────────────
 * Session arm context — what the renderer tells main when a focus block
 * arms enforcement. Rides SESSION_START as one optional argument, and is
 * consumed in src/main/index.ts by FocusPlan.declareRound — the session
 * controller never sees it, so Focus Plan has no seam into the fuse.
 * ──────────────────────────────────────────────────────────────────────── */

/** What the run clock knows. Supplied by useSessionTimer's onEnforce. */
export interface SessionArmContext {
  /** `${plan startedAtMs}-${segment index}`. Pause/resume reuse the same key. */
  roundKey: string;
  /** 1-based focus block inside the plan. */
  round: number;
  roundsTotal: number;
  /** This block's planned work, in seconds. */
  plannedFocusSec: number;
  /** The break after it, in seconds; 0 when this block ends the plan. */
  plannedBreakSec: number;
}

/** SessionArmContext plus what Focus Plan offered, if it offered anything. */
export interface SessionPlanContext extends SessionArmContext {
  /** What Focus Plan recommended for this block, or null if it did not. */
  recommendedFocusSec: number | null;
  /** True when the Dial matched that offer when the switch was thrown. */
  acceptedRecommendation: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * The recorded round — the unit of observation
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanRoundStatus = "completed" | "aborted" | "discarded";

/**
 * One focus round, as measured. ALL offsets are SERVED seconds (pause time
 * excluded, each tick delta clamped to PLAN_MAX_TICK_GAP_SEC), never wall
 * seconds — that is the only definition under which the number means "how
 * long you can work".
 */
export interface PlanRound {
  v: 1;
  roundKey: string;
  /** Epoch ms of the first arm. */
  startedAt: number;
  /** Epoch ms of the last disarm. */
  endedAt: number;
  /** Local "YYYY-MM-DD" of startedAt, stamped in MAIN so the pure core
   *  never touches Date. The trend's day-spread key. */
  day: string;
  /** Local hour 0-23 of startedAt, also stamped in main. */
  hour: number;
  status: PlanRoundStatus;
  servedSec: number;
  plannedFocusSec: number;
  round: number;
  roundsTotal: number;
  recommendedFocusSec: number | null;
  acceptedRecommendation: boolean;
  /** MUFD in served seconds; null when the round ran clean (censored). */
  firstDriftSec: number | null;
  firstDriftType: DriftType | null;
  /** Every kept onset, debounced by DRIFT_DEBOUNCE_SEC, capped at
   *  PLAN_MAX_DRIFTS_PER_ROUND. */
  driftsSec: number[];
  /** First forecast_nudge in this round. A WARNING, never a drift. */
  firstWobbleSec: number | null;
  wobbles: number;
  /** Pre-arms that cleared without a drift — reported as stand-downs. */
  standDowns: number;
  /** null when the forecast was off or never warmed. */
  peakRisk: number | null;
  peakRiskSec: number | null;
  /** forecast_hit lead, when the forecast called this round's first drift. */
  firstDriftLeadSec: number | null;
  countdowns: number;
  kills: number;
  /** The round began with a blocked app already up: measures window layout,
   *  not attention. Recorded, disclosed, excluded from the estimator. */
  startedDrifted: boolean;
  forecastOn: boolean;
}

/**
 * The round currently running, built in the RENDERER from timer.position and
 * AppState.forecast/forecastEvents. Never persisted, never pushed from main.
 * Its only job is to make the wobble rung reachable inside the first round of
 * a fresh install, which is what feeds `reviseBreak`.
 */
export interface LivePlanRound {
  roundKey: string;
  startedAt: number;
  plannedFocusSec: number;
  servedSec: number;
  firstDriftSec: number | null;
  firstWobbleSec: number | null;
  peakRisk: number | null;
  peakRiskSec: number | null;
  forecastOn: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * Streaming drift detection — equivalent to findDriftOnsets, by test
 * ──────────────────────────────────────────────────────────────────────── */

export interface OnsetState {
  last: Decision | null;
  onsetsSec: number[];
  /** True once a non-IDLE, non-drifted decision has been seen. */
  sawClean: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * The estimator
 * ──────────────────────────────────────────────────────────────────────── */

/** One (t, δ) pair. The Kaplan-Meier estimator sees only these. */
export interface HoldSample {
  /** Minutes held: MUFD when uncensored, served minutes when censored. */
  minutes: number;
  /** True when the round ended with no drift — the true hold is >= minutes. */
  censored: boolean;
  /** Local calendar day key, for the trend's day-spread gate. */
  day: string;
  /** 1-based focus round inside its plan, for the like-for-like rule. */
  round: number;
  /** Round start, epoch ms — the ordering key for the split-half. */
  at: number;
}

export interface SurvivalStep {
  minutes: number;
  events: number;
  atRisk: number;
  survival: number;
}

export interface SurvivalCurve {
  steps: SurvivalStep[];
  /** min{ t : S(t) <= 0.5 }, or null when the curve never reaches a half. */
  medianMin: number | null;
  /** Longest observed hold, event or censored. The honest floor. */
  lowerBoundMin: number | null;
  events: number;
  censored: number;
}

export type PlanRung =
  | "no-history"
  | "wobble-only"
  | "censored-only"
  | "single"
  | "pair"
  | "measured";

export type PlanRefusal = "no-rounds" | "all-censored" | "forecast-off";

export interface PlanEstimate {
  rung: PlanRung;
  /** Kaplan-Meier median in minutes; null = refused. */
  medianMin: number | null;
  /** Longest observed hold (event or censored); null when nothing observed. */
  lowerBoundMin: number | null;
  /** Derived from a forecast wobble, not a drift. Never steps the target,
   *  never enters the trend window, never satisfies a confidence gate. */
  provisional: boolean;
  /** min(1, roundsInWindow / PLAN_CONFIDENCE_ROUNDS), mirroring adapt's own
   *  bar rather than inventing a second. REPORTED FOR INSPECTION ONLY — no
   *  surface reads it today: the copy hedges off `rung`, the trend gates off
   *  its own counts, and it never moves the number. */
  trust: number;
  /** Eligible rounds in the window (excludes discarded and startedDrifted). */
  rounds: number;
  /** Completed eligible rounds — the `censored-only` stretch gate reads this. */
  completedRounds: number;
  /** Uncensored observations. */
  events: number;
  censored: number;
  /** Distinct local calendar days represented by the events. */
  days: number;
  /** Last <= 5 uncensored holds, chronological, for the reasoning sentence. */
  recentHoldsMin: number[];
  /** max(holdMin) over the window — feeds the +PLAN_MAX_REACH_MIN cap. */
  bestHeldMin: number | null;
  refusal: PlanRefusal | null;
  /** Named method, rendered verbatim on screen. Never empty. */
  method: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * The trend — seven gates, and it names the one that stopped it
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanTrendDirection = "up" | "down" | "flat" | "unknown";
export type PlanTrendConfidence = "none" | "weak" | "clear";

export type PlanTrendGate =
  | "too-few-events"        // < PLAN_TREND_MIN_EVENTS            -> none
  | "too-few-days"          // < PLAN_TREND_MIN_DAYS              -> none
  | "lopsided-halves"       // a half has < PLAN_TREND_MIN_HALF   -> none
  | "censoring-limited"     // censored fraction > the max        -> none
  | "below-noise"           // |delta| under the noise floor      -> weak
  | "sign-disagreement"     // half-split disagrees with Theil-Sen-> weak
  | "unstable";             // leave-one-out flips the direction  -> weak

export interface PlanTrend {
  direction: PlanTrendDirection;
  confidence: PlanTrendConfidence;
  /** Theil-Sen slope, minutes per round. STRUCTURALLY NULL unless
   *  confidence === "clear": the UI has no path to an unearned direction. */
  slopeMinPerRound: number | null;
  olderMedianMin: number | null;
  newerMedianMin: number | null;
  /** IQR of the window's holds — the student's own noise floor. */
  spreadMin: number | null;
  events: number;
  days: number;
  /** True when the comparison used round-1 rounds only (like-for-like). */
  roundOneOnly: boolean;
  /** The first gate that failed, or null when all seven passed. */
  blockedBy: PlanTrendGate | null;
  /** Named method, rendered verbatim. Carries the like-for-like caveat. */
  method: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * The recommendation
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanStep = "stretch" | "hold" | "ease";

/** One row of the "Why this?" disclosure. Ineligible rows are shown greyed
 *  with their reason: 5 rounds in history and 3 in the reasoning must always
 *  reconcile on screen. */
export interface PlanEvidenceRow {
  at: number;
  day: string;
  round: number;
  plannedFocusMin: number;
  /** MUFD when drifted, served minutes when censored. */
  heldMin: number;
  censored: boolean;
  driftType: DriftType | null;
  counted: boolean;
  /** Why it does not count. Null exactly when counted is true. */
  excludedBecause: string | null;
}

export interface PlanRecommendation {
  focusMin: number;
  breakMin: number;
  step: PlanStep;
  /** The base before the step was applied. */
  baseMin: number;
  estimate: PlanEstimate;
  trend: PlanTrend;
  /** Nothing here is measured from this user. */
  cold: boolean;
  evidence: PlanEvidenceRow[];
  copy: PlanCardCopy;
}

/* ────────────────────────────────────────────────────────────────────────
 * The debrief
 * ──────────────────────────────────────────────────────────────────────── */

export interface PlanDebrief {
  round: PlanRound;
  /** Recomputed WITH this round folded in. */
  next: PlanRecommendation;
  /** MUFD in minutes, or null when censored. */
  heldMin: number | null;
  censored: boolean;
  /** Median gap between onsets; null with fewer than 2. */
  rhythmMin: number | null;
  /** Not counted toward history (too short / started drifted / discarded). */
  notCounted: boolean;
  /** Sparkline series: the window's holds, oldest first. */
  series: Array<{ at: number; minutes: number; censored: boolean }>;
  copy: PlanDebriefCopy;
}

/* ────────────────────────────────────────────────────────────────────────
 * The mid-session revision — computed in the RENDERER; src/shared/nudge.ts
 * and src/main/** are untouched by this surface. It returns a string.
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanRevisionKind = "earlier" | "later";

export interface PlanReviseInput {
  /** Seconds into the current focus block. */
  elapsedSec: number;
  /** Seconds left in the current focus block. */
  remainingSec: number;
  estimateMin: number | null;
  /** A real forecast_nudge or forecast_prearm fired this block. */
  wobbled: boolean;
  /** Smoothed risk, or null when the forecast is off. */
  risk: number | null;
  /** settings.forecastNudgeRisk. */
  nudgeRisk: number;
  /** HARD GUARD: a nudge during a burning fuse is about the fuse. */
  countdownActive: boolean;
}

export interface PlanRevision {
  kind: PlanRevisionKind;
  plannedBreakInSec: number;
  suggestedBreakInSec: number;
  copy: PlanRevisionCopy;
}

/* ────────────────────────────────────────────────────────────────────────
 * Copy — every user-visible string is produced in src/shared/plan/copy.ts,
 * so it is testable without a DOM and identical in the browser demo.
 * ──────────────────────────────────────────────────────────────────────── */

export interface PlanCardCopy {
  /** "FOCUS PLAN · measured · 6 rounds" */
  kicker: string;
  /** "20 minutes of work, then 4 off." */
  headline: string;
  reasoning: string;
  /** One sentence, or null when there is nothing to say about direction. */
  trendLine: string | null;
  /** Present whenever settings.forecastEnabled is false. */
  forecastNote: string | null;
  /** Rendered verbatim under "Why this?". Never empty. */
  method: string;
  acceptLabel: string;
  /** The never-enforced line. Present in every variant. */
  overrideLine: string;
}

export interface PlanDebriefCopy {
  kicker: string;
  headline: string;
  /** null when the forecast was off or never warmed. */
  whereItWent: string | null;
  /** null when fewer than 2 onsets. */
  rhythm: string | null;
  /** Fuses burned / apps killed; null when nothing burned. */
  cost: string | null;
  /** ALWAYS present — the metric and what was and was not measured. */
  theNumber: string;
  nextRound: string;
  /** Present exactly when notCounted is true. */
  notCountedLine: string | null;
}

export interface PlanRevisionCopy {
  line: string;
}

/* ────────────────────────────────────────────────────────────────────────
 * Wire + main-process shapes
 * ──────────────────────────────────────────────────────────────────────── */

export const PLAN_LEDGER_VERSION = 1;

/** On-disk shape of <userData>/focus-plan.json. */
export interface FocusPlanLedger {
  v: typeof PLAN_LEDGER_VERSION;
  lifetimeRounds: number;
  /** Oldest first, capped at PLAN_LEDGER_CAP. */
  rounds: PlanRound[];
}

/** PLAN_GET_STATE payload. Closed rounds only — the live round is built
 *  renderer-side, so main never has to stream one. */
export interface FocusPlanState {
  v: 1;
  /** False exactly when focusPlanEnabled is off — the surfaces render nothing.
   *  NOT the filming pin: FOCUSPLUG_NO_PLAN=1 reports enabled with an empty
   *  window, so the cards stay up on the cold-start rung. */
  enabled: boolean;
  /** The estimator window, oldest first. Empty under the filming pin. */
  rounds: PlanRound[];
  /** Rounds ever recorded, for the Settings reset offer. 0 under the pin,
   *  which never reads the ledger it is hiding. */
  lifetimeRounds: number;
}

/** Main-process fan-out. SessionPush and ForecastPush are NOT modified. */
export interface PlanPush {
  round(round: PlanRound): void;
}

/** The push-facing handlers of the recorder (structural, test-friendly),
 *  mirroring ForecastTap in src/main/forecast/tap.ts. */
export interface PlanTap {
  onSessionState(state: import("../ipc").SessionState): void;
  onPolicyEvent(event: import("../types").PolicyEvent): void;
  onForecastSnapshot(snap: import("../forecast/types").ForecastSnapshot): void;
  onForecastEvent(event: import("../forecast/types").ForecastEvent): void;
}

/** Pure reducer that rebuilds a ledger from the session log, so the browser
 *  demo and mockApi get a real data path and the log is the audit trail. */
export type LedgerFromSessionLog = (events: readonly SessionEvent[]) => FocusPlanLedger;
```

---

## 2. Constants — `src/shared/plan/constants.ts` (complete source)

```ts
export const PLAN_MODEL_VERSION = "fp-1";

/* ── estimator window ───────────────────────────────────────────────── */
export const PLAN_WINDOW_ROUNDS = 20;
export const PLAN_WINDOW_DAYS = 28;
export const PLAN_LEDGER_CAP = 200;

/* ── what counts as a round ─────────────────────────────────────────── */
/** Five minutes is not a measurement. Applies to CLEAN rounds only —
 *  a short round WITH a drift is real, informative data and is kept. */
export const PLAN_MIN_ROUND_SEC = 300;
export const PLAN_COMPLETE_SLACK_SEC = 5;
/** Per-tick clamp: a suspend or a coffee break cannot inflate servedSec. */
export const PLAN_MAX_TICK_GAP_SEC = 5;
export const PLAN_MAX_DRIFTS_PER_ROUND = 12;
/** A first onset inside this window, with no clean non-IDLE decision before
 *  it, means the round STARTED drifted. This is a ROUND-ELIGIBILITY rule;
 *  the drift definition itself is untouched. */
export const PLAN_STARTED_DRIFTED_SEC = 20;
/** servedSec beyond this multiple of the plan means the clock jumped. */
export const PLAN_RUNAWAY_FACTOR = 3;

/* ── trust (mirrors adapt's own bar, rather than inventing a second) ── */
export const PLAN_CONFIDENCE_ROUNDS = 6;

/* ── trend gates ────────────────────────────────────────────────────── */
export const PLAN_TREND_MIN_EVENTS = 6;
export const PLAN_TREND_MIN_DAYS = 3;
export const PLAN_TREND_MIN_HALF = 3;
export const PLAN_TREND_MIN_DELTA_MIN = 2;
export const PLAN_TREND_NOISE_FACTOR = 0.5;
export const PLAN_TREND_MAX_CENSORED_FRACTION = 0.5;
/** Round-1 events needed before the trend compares like with like. */
export const PLAN_TREND_ROUND1_MIN_EVENTS = 6;

/* ── progression ────────────────────────────────────────────────────── */
export const PLAN_DEFAULT_FOCUS_MIN = 25;
export const PLAN_MIN_FOCUS_MIN = 10;
export const PLAN_MAX_FOCUS_MIN = 90;
export const PLAN_STRETCH_MIN = 3;
export const PLAN_BACKOFF_MIN = 3;
export const PLAN_STRETCH_STREAK = 2;
export const PLAN_EARLY_DRIFT_FRACTION = 0.8;
/** The plan can climb but never leap: best held + 10, hard cap. */
export const PLAN_MAX_REACH_MIN = 10;
/** Completed rounds needed before `censored-only` goes looking for the edge. */
export const PLAN_CENSORED_STRETCH_MIN_ROUNDS = 2;

/* ── break: SHAPES parity ────────────────────────────────────────────
 * round(focusMin / 5) clamped [3, 15] reproduces all three shipped shapes
 * exactly — Classic 25/5, Deep work 50/10, Sprint 15/3. It gives a 20-minute
 * block a 4-minute break, not the 5 in the brief's illustrative sentence.
 * That divergence is deliberate and argued in the design doc: a 5-minute
 * floor makes the app's own Sprint shape unreachable by its own recommender.
 * Setting PLAN_MIN_BREAK_MIN = 5 restores the example, at that cost.
 * ──────────────────────────────────────────────────────────────────── */
export const PLAN_BREAK_RATIO = 5;
export const PLAN_MIN_BREAK_MIN = 3;
export const PLAN_MAX_BREAK_MIN = 15;

/* ── mid-session revision ───────────────────────────────────────────── */
export const PLAN_REVISE_MIN_ELAPSED_FRACTION = 0.6;
export const PLAN_REVISE_MIN_DELTA_SEC = 180;
/** The suggested early break is never "now": three minutes is a break you
 *  walk to, not a fuse you dodge. */
export const PLAN_REVISE_EARLY_SEC = 180;
export const PLAN_REVISE_LATE_SEC = 120;
export const PLAN_REVISE_EXTEND_SEC = 300;
export const PLAN_REVISE_CALM_FRACTION = 0.6;

/* ── debrief ────────────────────────────────────────────────────────── */
export const PLAN_DEBRIEF_FRESH_MS = 30 * 60_000;

/* ── gauntlet ───────────────────────────────────────────────────────── */
export const PLAN_GAUNTLET_SEED = 20260913;
/** CI gate: on a STATIONARY population the trend must report "clear" in
 *  fewer than this fraction of runs, or the build fails. */
export const PLAN_GAUNTLET_MAX_FALSE_TREND = 0.05;
```

---

## 3. IPC additions — `src/shared/ipc.ts` (exact strings)

```ts
// IPC_INVOKE additions
PLAN_GET_STATE: "focusplug:plan:getState",   // args: [] -> FocusPlanState
PLAN_RESET:     "focusplug:plan:reset",      // args: [] -> FocusPlanState

// IPC_PUSH addition
PLAN_ROUND:     "focusplug:plan:round",      // PlanRound, on round close

// IpcInvokeChannelMap entries
"focusplug:plan:getState": { args: []; result: FocusPlanState };
"focusplug:plan:reset":    { args: []; result: FocusPlanState };

// IpcInvokeChannelMap — SESSION_START widens by ONE optional argument.
// Backwards compatible: every existing caller (probe.ts, the smoke script,
// mockApi, AppState before the change) still typechecks and still works.
"focusplug:session:start": { args: [context?: SessionPlanContext]; result: SessionState };

// IpcPushChannelMap entry
"focusplug:plan:round": PlanRound;

// FocusPlugApi additions
sessionStart(context?: SessionPlanContext): Promise<SessionState>;   // widened
planGetState(): Promise<FocusPlanState>;
planReset(): Promise<FocusPlanState>;
onPlanRound(cb: (round: PlanRound) => void): () => void;
```

`src/shared/ipc.ts` re-exports `FocusPlanState`, `PlanRound`, `PlanRecommendation`, `PlanEstimate`, `PlanTrend`, `PlanDebrief`, `PlanRevision`, `SessionArmContext` and `SessionPlanContext` from `./plan/types`.

**The context never reaches the session controller.** `src/main/index.ts`:

```ts
ipcMain.handle(IPC_INVOKE.SESSION_START, async (_event, context?: unknown) => {
  focusPlan.declareRound(context);   // validates untrusted input; never throws
  return controller.start();
});
```

`declareRound` runs synchronously immediately before `controller.start()`, so there is no accept/start race and no adoption machinery. `SessionControllerOptions` gains **no plan-shaped key**, and a compile-time `Exclude<keyof SessionControllerOptions, KnownKeys>` assertion in `src/main/focusplan/integration.test.ts` fails the build if one is ever added.

Preload (`src/preload/index.ts` — `index.d.ts` needs no edit, it only declares `window.focusplug: FocusPlugApi`) and `src/renderer/src/lib/mockApi.ts` mirror the existing channel plumbing. There is no plan settings invoke — settings flow through the existing `focusplug:settings:set` patch.

**Renderer-side plumbing that follows:**

```ts
// src/renderer/src/features/timer/useSessionTimer.ts — one added argument.
// `arm` is non-null exactly when armed === true.
onEnforce: (armed: boolean, arm: SessionArmContext | null) => void;

// src/renderer/src/features/focusplan/context.ts
export function planContextFor(
  arm: SessionArmContext,
  recommendation: PlanRecommendation | null,
): SessionPlanContext;

// src/renderer/src/state/AppState.tsx
startSession: (context?: SessionPlanContext) => Promise<void>;
```

---

## 4. Settings keys — `AppSettings` in `src/shared/ipc.ts` (flat, house style)

| key | type | default | `normalizeSettings` clamp (`src/main/store/appStore.ts`) |
| --- | --- | --- | --- |
| `focusPlanEnabled` | boolean | `true` | `typeof === "boolean" ? raw : DEFAULT` |
| `focusPlanStretchEnabled` | boolean | `true` | `typeof === "boolean" ? raw : DEFAULT` |

```ts
  /** Focus Plan master switch. Off reproduces today's screens exactly. */
  focusPlanEnabled: boolean;
  /** Let progression raise or lower the target. Off keeps the measurement
   *  and the debrief, and plans to the estimate with no step. */
  focusPlanStretchEnabled: boolean;
```

`DEFAULT_SETTINGS` in `src/shared/defaults.ts` gains both. `requirePatch` in `src/main/session/controller.ts` gains two boolean validators in the existing idiom. `src/renderer/src/lib/mockApi.ts` mirrors both.

**No thresholds are exposed.** The estimator's gates are honesty properties, not preferences; a user-tunable "how many rounds before you claim a trend" is a user-tunable lie.

Environment pin, mirroring `FOCUSPLUG_NO_ADAPT=1`:

```
FOCUSPLUG_NO_PLAN=1   # feature stays ON; ledger not read, not written, reset refused;
                      # the plan card renders the `no-history` rung
```

---

## 5. Persistence shape — `<userData>/focus-plan.json`

Written atomically through the existing `writeJsonAtomic` in `src/main/store/appStore.ts`, on round close only. One `PlanRound` is ~200 bytes; the cap is ~40 KB.

```jsonc
{
  "v": 1,
  "lifetimeRounds": 37,
  "rounds": [
    {
      "v": 1,
      "roundKey": "1789412400000-0",
      "startedAt": 1789412400000,
      "endedAt": 1789413900000,
      "day": "2026-09-13",
      "hour": 20,
      "status": "completed",
      "servedSec": 1500,
      "plannedFocusSec": 1500,
      "round": 1,
      "roundsTotal": 4,
      "recommendedFocusSec": 1200,
      "acceptedRecommendation": false,
      "firstDriftSec": 1152,
      "firstDriftType": "tab_out",
      "driftsSec": [1152, 1401],
      "firstWobbleSec": 840,
      "wobbles": 2,
      "standDowns": 1,
      "peakRisk": 0.78,
      "peakRiskSec": 828,
      "firstDriftLeadSec": 14,
      "countdowns": 1,
      "kills": 1,
      "startedDrifted": false,
      "forecastOn": true
    }
  ]
}
```

**Store seam** — two new **optional** methods on `SessionStore` (`src/main/session/controller.ts`), mirroring the `loadAdaptiveModel` / `saveAdaptiveModel` pair exactly, so `createMemoryStore`, `src/main/session/probe.ts` and the smoke scripts are untouched and keep passing:

```ts
  /** Optional: stores that cannot persist the plan ledger just forget it. */
  loadPlanLedger?(): unknown;
  savePlanLedger?(value: unknown): void;
```

`FocusPlugStore` implements both against `join(directory, "focus-plan.json")`.

**Revive is defensive:** wrong `v`, non-array `rounds`, NaN offsets, negative `servedSec`, or any malformed record ⇒ that record is dropped, or the ledger starts empty. No throw ever reaches a session start. A failed write disables recording for the session (one `plan · off · <message>` line) and never the session.

**Reset** (`PLAN_RESET`) writes `{ "v": 1, "lifetimeRounds": 0, "rounds": [] }`, appends `plan · history cleared (37 rounds)`, and pushes the empty state. It touches neither `adaptive-model.json`, nor `session-log.json`, nor `settings.json`, and the Settings panel says so and names the file path.

**Privacy, structurally:** only numbers, enums, one opaque `roundKey`, and a `"YYYY-MM-DD"` day string. No process name, no window title, no free text. `day` and `hour` are stamped **in main at write time**, so `src/shared/plan/**` never imports `Date` — which is what keeps the pure core environment-agnostic and inside the purity fence.

**Log lines** (`SessionEvent{kind:"plan"}` — free, `kind` is a bare `string` in the locked types):

```
plan · round 1 — first drift at 19.2 min (planned 25)
plan · round 2 — no drift in 25.0 min (censored, completed)
plan · round 3 — not counted, started with a blocked app already open
plan · history cleared (37 rounds)
plan · off · <message>
```

`features/logs/filters.ts` gains `{ id: "plan", label: "Focus Plan", kinds: ["plan"], always: false }`; `features/logs/eventModel.ts` gains `plan: "Focus Plan"` in `KIND_LABELS`. **`"plan"` is deliberately NOT added to `PREVIEW_KINDS`** in `features/session/model.ts` — the console timeline stays about the enforcement chain, and `isEnforcementEvent` already excludes unknown kinds, so no other change is needed there.

---

## 6. npm scripts — `package.json` (exact)

```json
"test:plan":     "vitest run src/shared/plan src/main/focusplan src/renderer/src/features/focusplan",
"gauntlet:plan": "tsx --tsconfig tsconfig.node.json src/shared/plan/gauntlet.ts",
"plan:stills":   "node scripts/plan-stills.mjs"
```

`vitest.config.ts` `include` gains `"src/main/focusplan/**/*.test.ts"` (the `src/shared/**/*.test.ts` and `src/renderer/src/**/*.test.ts` globs already match the rest).

`gauntlet:plan` lives in `src/shared/plan/` for symmetry with `src/shared/adapt/gauntlet.ts`, reuses that module's seeded `rng()` rather than writing a second sampler, and stays inside the purity fence. Its CI gate: on a **stationary** population the trend must report `clear` in **under 5%** of runs, or the build fails.

`plan:stills` drives `preview:renderer` at `?scene=plan-cold`, `plan-measured`, `plan-mixed`, `debrief-drifted`, `debrief-clean` and `debrief-flat`, and fails if any of them renders no card. The `plan-cold` still is the artifact that proves rung 0 is not an empty state. `nudge-revision` needs a live run clock and is covered by test rather than by screenshot — see §11.4.

---

## 7. Definitive new-file list

### NEW — shared (pure core, browser-importable via the `@shared` alias `demo/vite.config.ts` already sets)

```
src/shared/plan/types.ts
src/shared/plan/constants.ts
src/shared/plan/drift.ts            stepOnset, round classification      + drift.test.ts
src/shared/plan/survival.ts         kaplanMeier, median, lowerBound      + survival.test.ts
src/shared/plan/trend.ts            theilSen, median, iqr, leaveOneOut,
                                    planTrend                            + trend.test.ts
src/shared/plan/ledger.ts           normalizeRound, reviveLedger,
                                    selectWindow, samplesFrom,
                                    ledgerFromSessionLog                 + ledger.test.ts
src/shared/plan/estimate.ts         the rung ladder -> PlanEstimate       + estimate.test.ts
src/shared/plan/progression.ts      -> PlanRecommendation                 + progression.test.ts
src/shared/plan/debrief.ts          PlanRound + window -> PlanDebrief     + debrief.test.ts
src/shared/plan/revise.ts           reviseBreak                          + revise.test.ts
src/shared/plan/copy.ts             EVERY user-visible string            + copy.test.ts
src/shared/plan/fixtures.ts         fresh, liveWobble, liveQuiet, single, clean3, drift19_22_20,
                                    pair, improving, stationary20, stretchReady,
                                    easeReady, censorHeavy, mixedRounds,
                                    abortedWithDrift, abortedShort, cleanOnly
src/shared/plan/gauntlet.ts         npm run gauntlet:plan
src/shared/plan/index.ts            barrel
src/shared/plan/purity.test.ts      the forecast fence + its positive controls
src/shared/plan/docs.test.ts        §6.2's quoted copy, checked against the code
```

### NEW — main

```
src/main/focusplan/recorder.ts           PlanRecorder: tap handlers, round open/
                                    merge/close, declareRound, ledger write,
                                    guard/trip                            + recorder.test.ts
src/main/focusplan/tap.ts                withPlan, withPlanForecast            + tap.test.ts
src/main/focusplan/ledger.ts             revive/append/merge, planStateWindow,
                                    localDayStamp
src/main/focusplan/harness.ts            the plan's own test doubles, deliberately
                                    NOT added to src/main/session/harness.ts
src/main/focusplan/index.ts              createFocusPlan() -> { sessionTap, forecastTap,
                                    declareRound, getState, reset }
src/main/focusplan/integration.test.ts   real SessionController + harness;
                                    THE UNCOUPLING TEST
```

### NEW — renderer

```
src/renderer/src/features/focusplan/PlanCard.tsx
src/renderer/src/features/focusplan/DebriefCard.tsx
src/renderer/src/features/focusplan/Evidence.tsx        the "Why this?" disclosure
src/renderer/src/features/focusplan/HoldSparkline.tsx
src/renderer/src/features/focusplan/model.ts            pure view-model        + model.test.ts
src/renderer/src/features/focusplan/context.ts          planContextFor()       + context.test.ts
src/renderer/src/features/focusplan/scenes.ts           mockApi / stills scenes + scenes.test.ts
src/renderer/src/features/focusplan/useFocusPlan.ts     fetch + subscribe
src/renderer/src/features/focusplan/plan.css
src/renderer/src/features/focusplan/index.ts
src/renderer/src/features/focusplan/evidence/          the stills
```

### NEW — scripts and docs

```
scripts/plan-stills.mjs
docs/FOCUS-PLAN.md                  the design, with this appendix at its end
```

### MODIFIED (exhaustive)

`src/shared/ipc.ts` (2 invokes, 1 push, 3 map entries, widened `sessionStart`, 3 new api methods, 2 settings keys, re-exports) · `src/shared/defaults.ts` (2 defaults) · `src/main/store/appStore.ts` (2 `normalizeSettings` clamps; `loadPlanLedger`/`savePlanLedger` on `FocusPlugStore`) · `src/main/session/controller.ts` (`SessionStore` +2 optional methods; `requirePatch` +2 booleans — **and nothing else**) · `src/main/session/runtime.ts` (construct + compose the two taps + return on `FocusPlugRuntime`) · `src/main/session/evidence/golden-path.json` (the settings snapshot gains the 2 new keys; every pinned event, state, kill and countdown second is unchanged) · `src/main/index.ts` (2 handlers, 1 broadcast, `SESSION_START` forwards the context to `declareRound`) · `src/preload/index.ts` (3 methods + the widened `sessionStart`; `index.d.ts` unchanged) · `src/renderer/src/lib/mockApi.ts` (plan state + 6 scenes) · `src/renderer/src/state/AppState.tsx` (`startSession(context?)` only) · `src/renderer/src/features/timer/useSessionTimer.ts` (`onEnforce(armed, arm)`) · `src/renderer/src/components/Shell.tsx` · `src/renderer/src/features/nudge/NudgeOverlay.tsx` (optional `revision` prop, one `<p>`, **no new control**) · `src/renderer/src/pages/SetupPage.tsx` · `src/renderer/src/pages/LockPage.tsx` · `src/renderer/src/pages/SettingsPage.tsx` · `src/renderer/src/features/logs/filters.ts` · `src/renderer/src/features/logs/eventModel.ts` · `scripts/check-contracts.mjs` (generalised to a list of frozen source fences; this appendix's two are now byte-checked by the build) · `vitest.config.ts` · `package.json` · `docs/CONTRACTS.md` (append-only `## Focus Plan (Phase 5)` **below** the frozen Types fence) · `README.md`

### UNTOUCHED (asserted by tests / CI)

`src/shared/types.ts` (byte-locked) · `src/shared/nudge.ts` · `src/shared/policy/**` · `src/shared/forecast/**` · `src/shared/adapt/**` · `src/main/session/push.ts` · `src/main/session/fuseAuthority.ts` · **`src/main/session/adaptiveFuse.ts`** (`ASSUMED_SESSION_MIN` stays; retiring it belongs behind a `FEATURE_LAYOUT` bump, as a named follow-up) · `src/main/kill/**` · `src/main/desk/**` · `src/main/plugs/**` · `src/main/forecast/**` · the `docs/CONTRACTS.md` Types fence.
