# Focus Forecast — Final Design (merged, implementable)

**Predict the tab-out before it happens. Show the model thinking. Pre-arm the fuse for real. Never touch the kill path's determinism.**

> **AMENDED TWICE. Read this box before trusting any architecture number below.**
> The tuning log is `scripts/forecast/GAUNTLET.md`; the engineering notes are
> `docs/FORECAST.md`. Nothing is quietly edited away — the superseded decisions
> are kept because the corrections are only legible next to them.
>
> **Round 8 (bake-off, 48 held-out sessions).** Five model families on one fixed
> dataset, one metric, one reducer. No non-linear model beat the strongest
> linear result by a margin that eval set could resolve, and a plain
> 19-parameter logistic already beat the MLP this document specified. So §1.2's
> `TinyMLP 18→12→1` (241 params) was replaced by an L2 logistic regression over
> the features plus all pairwise products (190 params), and §4.5's gate — "beat
> a SINGLE-feature logistic by ≥ 0.03", a strawman — was re-anchored to the
> FULL multivariate logistic with a required margin of 0.
>
> **Round 11 (the same contest, 900 sessions).** The round-8 comparison was not
> wrong, it was **underpowered**: the paired session-clustered SE of a
> model-vs-model lead-AUC difference on 48 sessions is ≈ 0.009, and every margin
> on offer was 0.4–0.7 of one SE. On an 18.75× larger corpus (SE 0.0018) the
> answer inverts, and **the GLM fails the gate round 8 built** (0.9208 against a
> plain 24-feature logistic's 0.9259). Shipped instead: a **tanh MLP
> `mlp24-36-1`, 937 params** — three `24→12→1` members on disjoint CV folds,
> collapsed exactly into one dense layer — at **+0.0071 [+0.0035, +0.0107]**
> over the same baseline. So §1.2 is a hidden layer again, wider than the one
> this document specified and selected rather than guessed.
>
> Also amended: the operating point is **nudge 0.50 / pre-arm 0.65** (§5.2's
> 0.55/0.80 was chosen by hand; both axes are now re-derived by the trainer on
> cross-fitted train sessions under stated budgets), and §11's "last-resort
> model downgrade to logistic regression" has been taken and then un-taken —
> it was the right model for the evidence round 8 had, and the wrong one for
> the evidence round 11 has.
>
> Everything else — the features, the ring, the extractor, the labeler, the
> censoring, the escalation reducer, the latch, the receipt, the UI — is
> unchanged and shipped as written.

This is the winning demo-first design merged with the three judge-flagged grafts, all contradictions resolved:

1. **The receipt** (winner, unanimous steal): `forecast_hit` / `forecast_miss` events with lead seconds, rendered on the countdown overlay — misses displayed as loudly as hits.
2. **Real pre-arm** (grafted from P1): pre-arm now genuinely shortens the fuse 10 s → 5 s through the one knob the codebase already exposes — `stepPolicy` re-derives countdown duration from `input.countdownSec` on every step (verified: `durationMs()` in `src/shared/policy/engine.ts` line 131) — with a latch rule so a burning fuse never mutates. The winner's cosmetic pre-arm is gone.
3. **Anti-fraud eval** (grafted from P1): AUC@lead≥20s + eligibility censoring — score only frames whose nearest drift onset is far away, structurally proving *prediction*, not last-seconds detection. Plus a visible Platt calibration step.
4. **Anti-if-else structure** (grafted from P2): the `research_churn` adversarial archetype (heavy switching entirely inside the allowlist, no drift) and a CI baseline gate — `forecast:eval` exits nonzero unless the shipped head beats the FULL multivariate logistic **on the same feature basis it sees** on held-out lead-censored ROC-AUC *(amended round 8: the original bar was ≥ 0.03 over a SINGLE-feature logistic, which the round-7 MLP passed while losing to the full one. Amended round 11: the bar has since failed for real and replaced a shipped head.)*.
5. **Product-native surfaces** (grafted from P2): fourth sensor card (Foreground · Desk AI · Forecast · Plugs), forecast events threaded into the existing cause→countdown→consequence timeline, the `golden-path.json` disabled-equals-identical regression test, and `forecastPrearmEnabled=false` as a zero-risk nudge-only mode.

**Two winner errors corrected** (both judge-verified): (a) the telemetry ring does **not** fill in observe-only mode — `SessionController.stop()` stops both monitors, so the ring resets at session start and the meter shows a 15 s warm-up; (b) no self-owned 1 Hz timer — the forecast ticks from the controller's existing evaluate loop with the injected `now()` clock, matching the repo's deterministic-test house style.

Grounding (verified in `/home/user/FocusPlug-gauntlet`): `scripts/check-contracts.mjs` byte-compares `src/shared/types.ts` to the CONTRACTS.md Types fence — **types.ts is never edited**. `SessionPush` (`src/main/session/push.ts`) has exactly `sessionState / policyEvent / focusSnapshot / deskSnapshot / sessionEvent`, so the wrapper tap is method-complete. In `evaluateOnce()`, `push.policyEvent(event)` runs **before** `applyPolicyEvent(event)` — the tap sees `start_countdown` in time to latch. `SessionEvent.kind` is a plain `string` (kind `"forecast"` needs no type change), but `PREVIEW_KINDS` in `features/session/model.ts` gates the timeline preview and must gain `"forecast"`. Settings are flat keys through `normalizeSettings` (appStore) and `requirePatch` (controller) — the merged design uses flat keys, not a nested block. `src/main/session/harness.ts` exports `ScriptedWindowMonitor`, `ScriptedDeskMonitor`, `MutableClock`, `createRecordingPush`, `createMemoryStore`, `docsFocus`/`discordFocus`; `src/main/session/evidence/golden-path.json` exists. Both tsconfigs alias `@shared/*` and set `resolveJsonModule` — a pure-TS core + JSON weights under `src/shared/forecast/` compiles for Electron main, the React console, and a plain-browser Vite build (`scripts/faces-preview.vite.ts` precedent). `scripts/desk-model/train.ts` is the hand-rolled trainer precedent (`mulberry32`, Adam, committed weights + metrics JSON).

---

## 1. Model

### 1.1 Task
Binary probabilistic prediction: **P(drift onset within the next 30 s)**, where a *drift onset* is the policy's own decision entering `DISTRACTED` (blocked focus, drift_type `tab_out`) or `AWAY` (high-confidence desk-away, drift_type `walk_away`) from a non-drifted state — exactly the transitions `classify()` in `src/shared/policy/evaluate.ts` produces. The 30 s horizon stays (judges: crisper in-demo verification than 60 s). Output every second during an active session.

### 1.2 Architecture — ~~`TinyMLP 18→12→1`, 241 params~~ → ~~GLM `lr18+pairwise`, 190 params~~ → **MLP `mlp24-36-1`, 937 params** (amended twice: rounds 8 and 11)

Hand-rolled forward pass in pure TypeScript, no new deps (mirrors the hand-rolled desk head — part of the pitch):

```
x ∈ R^24 (encoded features, §1.3)
h = tanh(W1·x + b1)        W1 36×24 + b1 36                      → 900
z = w2·h + b2              w2 36 + b2 1                          → 37
risk_raw = σ(a·z + b)      Platt calibration (a,b fit on held-out sessions) → 2 (stored, not counted in "937")
total trainable: 937 params ≈ 15 KB JSON on disk, 900 multiply-accumulates + 36 tanh per tick (~3.1 µs)
```

The 36 hidden units are three independently-fitted `24→12→1` members, blended
affinely and **collapsed exactly** into one layer (asserted to 1e-15 before the
artifact is written), so the runtime sees a plain two-layer net and not an
ensemble loop. The z-score standardizer is folded into `W1`/`b1`, so the
shipped payload really is 937 floats plus the Platt pair — no hidden 48-float
scaler beside an understated parameter count.

*The superseded heads, for the record:*
- *`lr18+pairwise` (round 8): 189 basis terms + intercept = 190 params, 324
  MACs at the 24-feature width, convex, one global optimum. It ships no more
  because it lost its own gate at 0.9208 vs 0.9259 — 324 pairwise products on
  133 k train rows overfit where 189 did not.*
- *`TinyMLP 18→12→1` (round 7): `h = tanh(W1·x + b1)` with W1 12×18 + b1 (228)
  and `z = w2·h + b2` (13) — **241 params, 228 multiply-accumulates plus 12
  tanh** per tick. (An earlier version of this document said "~450"; it was
  wrong, and the GLM that replaced it was never as much cheaper as that number
  implied. All three heads are sub-microsecond-to-few-microsecond per tick and
  the cost argument between them was never the deciding one — it decides only
  against the 14 899-parameter temporal CNN at 301 µs/tick.)*

- The two added features over the winner's 16 are **title-churn** (in-browser tab flicking via FNV-1a title hashes) — the real signal judges flagged the winner for skipping, captured without ever storing a title string. Six more (§1.3 trend block) were appended in round 9.
- Calibration is a real, separate, **visible** step (grafted from P1): the internals panel prints `logit z = +0.48 → σ(a·z+b), a=2.09 b=−5.80 → risk 0.62`. ECE reported in eval.
- Forward pass = 900 multiply-accumulates + 36 tanh + one `exp` for the Platt
  sigmoid. Occlusion attribution re-uses the cached hidden pre-activations and
  shifts each by `W1_jf·(m_f − x_f)`, so all 24 attributions cost 864 MACs and
  864 tanh rather than 24 full forward passes — the whole tick is ≪ 0.1 ms.
  tfjs stays where it is (Desk AI).
- ~~Why not LR: kept as baseline + last-resort fallback (§11); the MLP must beat it by the CI gate or it doesn't ship.~~ *Amended twice: the round-7 MLP did not beat it, so LR shipped and the gate was anchored to it (round 8); on a corpus with the power to decide it, a TUNED MLP does beat it by a resolved margin and LR does not clear its own bar, so a hidden layer ships again (round 11).* Why not a GRU: the windowed features encode time already — and a causal 1-D CNN over the raw 1 Hz stream (bake-off contender `temporal`) with ZERO hand-engineered features scored 0.9340 on 48 sessions, above the then-shipped MLP. On 900 sessions its best variants land at 0.9245 and 0.9173, *below* a 25-parameter plain logistic, at 14 899 params and 301 µs/tick. Still recorded as the open question — both corpora come from the same simulator, which is exactly where a raw-stream advantage would be hidden — but the evidence now points away from it.

### 1.3 Input feature vector (exact, `FORECAST_FEATURE_KEYS` order)
Computed by `extractFeatures(ring, ts)` in `src/shared/forecast/features.ts` — **the identical pure function runs in the trainer, the simulator's dataset build, and runtime inference** (train/serve skew killed by construction). `focusKind()` / `deskPresence()` are imported from `@shared/policy` — the forecast sees the world exactly as policy does. All encodings land in [0,1]; missing data encodes to defined neutrals, never NaN. `L(x,c) = log1p(x)/log1p(c)` clamped to 1.

| # | key | meaning | window | encoding |
|---|-----|---------|--------|----------|
| 0 | `switch15` | foreground process switches | 15 s | `min(n/8, 1)` |
| 1 | `switch60` | foreground process switches | 60 s | `min(n/20, 1)` |
| 2 | `switchAccel` | `(rate15+ε)/(rate60+ε)`, switches/s | 15 vs 60 s | `clamp(x/4, 0, 1)` |
| 3 | `dwellCur` | seconds on current window | now | `L(s, 600)` |
| 4 | `fracAllow60` | fraction of frames with allow focus | 60 s | identity |
| 5 | `fracOther60` | fraction on grey apps (not allow, not block) | 60 s | identity |
| 6 | `otherDwell30` | seconds on grey apps | 30 s | `s/30` |
| 7 | `distinct60` | distinct process keys focused | 60 s | `min(n/8, 1)` |
| 8 | `sinceBlock` | s since block focus last seen (600 if never) | session | `1 − L(min(s,600), 600)` |
| 9 | `streak` | uninterrupted allow-focus streak (s) | session | `L(s, 1800)` |
| 10 | `deskPresent30` | fraction of frames `present` | 30 s | identity; **0.5 when webcam off** |
| 11 | `deskConfMean30` | mean desk confidence | 30 s | identity; 0.5 when webcam off |
| 12 | `deskConfStd30` | confidence wobble (fidget proxy) | 30 s | `min(4σ, 1)`; 0 when webcam off |
| 13 | `deskFlicker60` | presence-label transitions | 60 s | `min(n/6, 1)`; 0 when webcam off |
| 14 | `sessionMin` | minutes into session (fatigue) | session | `min(m/50, 1)` |
| 15 | `priorDrifts` | drift onsets already this session | session | `min(n/5, 1)` |
| 16 | `titleChurn30` | title-hash changes, same process (tab flips) | 30 s | `min(n/12, 1)` |
| 17 | `titleChurn60` | same | 60 s | `min(n/24, 1)` |

Normalization: per-feature `(x − mean)/scale` learned on the train split, shipped in `weights.json`. Runtime asserts `weights.featureKeys` deep-equals `FORECAST_FEATURE_KEYS`; any mismatch ⇒ `ready:false`, forecast silent, session identical to today (fail closed).

### 1.4 Output semantics + visible internals
Each inference produces a `ForecastSnapshot` (exact type in the Contracts appendix):
- `rawRisk` = calibrated σ(a·z+b); `risk` = EMA-smoothed (α = 0.5 per 1 Hz tick) for a stable needle; `logit` = z for the calibration readout.
- `features[18]`: per feature `raw` (human units), `value` (encoded), and `attribution` — occlusion delta `risk(x) − risk(x with feature i at its training mean)`. 18 extra forward passes/s — free. Signed; labeled "contribution estimate" in the panel tooltip (occlusion deltas don't sum to the logit — say so).
- `hidden[36]` *(amended twice)*: the shipped net's hidden-layer activations, `tanh` of each unit's pre-activation. The contract is "a `number[]` of whatever length the architecture has" and the UI reads its length — it was 12 anonymous units (round 7), then 18 named term groups (round 8), and is now 36 anonymous units again. The panel labels them positionally (`h01`…) and says they are a learned basis, because they are; the NAMED signed numbers are the occlusion bars beside the strip.
- `band`: `"calm" | "elevated" | "prearm"` per §5 thresholds; `prearmedAt`, `effectiveFuseSec`, `baseFuseSec` so the UI can render the 10s→5s chip from data, not guesswork.
- `ready`: false until ≥ 15 real seconds after session start (meter renders "warming up · n/15 s"). The ring is **empty at session start** — monitors do not run between sessions.
- `modelVersion`, `paramCount` (937 — every float the forward pass reads, standardizer folded in): on-screen provenance.

### 1.5 Inference cadence — no new timers
The forecast is ticked by the controller's existing evaluate loop: `ForecastHook.beforeStep(now, baseCountdownSec)` is called once per `evaluateOnce()` (the 250 ms session ticker, plus every monitor-snapshot-triggered evaluate). The monitor closes one telemetry frame per wall second of the injected clock and runs inference on frame close (1 Hz); a `focusKind` change additionally forces an immediate recompute (rate-capped 4 Hz) — since every focus snapshot already enqueues an evaluate, the needle moves within ≤ 250 ms of an alt-tab with zero timers of our own. Everything is synchronous, sub-millisecond, try/caught, and can never delay `PolicyEngine.step` or a kill.

---

## 2. Telemetry

### 2.1 Capture: push-wrapper tap + one minimal hook
Telemetry capture needs **zero edits to controller internals** — the winner's wrapper, verified method-for-method against `push.ts`:

```ts
// src/main/forecast/tap.ts
export function withForecast(base: SessionPush, forecast: ForecastMonitor): SessionPush {
  return {
    sessionState: (s) => { base.sessionState(s); forecast.onSessionState(s); },
    policyEvent:  (e) => { base.policyEvent(e);  forecast.onPolicyEvent(e); },
    focusSnapshot:(f) => { base.focusSnapshot(f); forecast.onFocus(f); },
    deskSnapshot: (d) => { base.deskSnapshot(d);  forecast.onDesk(d); },
    sessionEvent: (e) => base.sessionEvent(e),
  };
}
```
Base push always first; every forecast handler body try/caught (first thrown error ⇒ state `off` for the session, one log line, `beforeStep` returns null forever). Because `evaluateOnce` pushes each `PolicyEvent` **before** `applyPolicyEvent`, the tap sees `start_countdown` in time to latch the fuse (§5.3). `status` events (emitted every step) give the monitor the authoritative `Decision` — the forecast never re-derives policy's verdicts.

The **only** controller diffs (exhaustive):
1. `SessionControllerOptions.forecast?: ForecastHook` (optional — every existing test compiles and behaves unchanged).
2. In `evaluateOnce()`: `const fuse = this.forecast?.beforeStep(this.now(), settings.countdownSec) ?? null;` and `buildPolicyInput(true, settings, fuse)`.
3. `buildPolicyInput` gains an optional `countdownOverrideSec: number | null = null` third parameter: `countdownSec: countdownOverrideSec ?? resolved.countdownSec`. The override is only ever passed on the active-session path — `stop()`'s `buildPolicyInput(false)` is untouched.

Wiring in `createSessionRuntime` (~12 lines): construct `createForecast({ loadSettings: () => store.loadSettings(), appendLog, push: forecastPush })` where `appendLog` writes a `SessionEvent{kind:"forecast"}` via `store.appendSessionLog` **and** `options.push.sessionEvent`; pass `withForecast(options.push, forecast.monitor)` as the controller's push and `forecast.hook` as `options.forecast`. Reading settings per tick makes thresholds live-tunable during demo rehearsal (grafted from P2) with no rebuild.

### 2.2 Ring buffer (`src/shared/forecast/ring.ts`, pure TS)
Preallocated, O(1) writes, ~45 KB total:
1. **Frame ring** — 1 Hz `TelemetryFrame`, capacity 600 (10 min): `{ ts, focusKind, processKey /* raw, memory only */, titleHash, deskPresence, deskConfidence, webcamEnabled }`. `commit(ts)` coalesces the latest 4 Hz snapshots into one frame per second (last-writer-wins).
2. **Transition list** — last 128 transitions `{ ts, kind: "proc" | "title", fromKey, toKey, toFocusKind }` — exact switch/churn counts (1 Hz frames under-count fast alt-tabbing); `"title"` entries are same-process title-hash changes (FNV-1a 32-bit of lowercased title; the string itself is never stored).
3. Scalar session state: `sessionStartTs`, `lastBlockFocusTs`, `driftCount`, `streakStartTs` — updated from `status` policy events.
`reset()` on session start (`onSessionState` with `sessionActive` flipping true). Handlers no-op while no session is active — there is **no** between-session filling.

### 2.3 Session recorder (training-data path, privacy-preserving)
`src/main/forecast/recorder.ts`, dev-only behind `FOCUSPLUG_FORECAST_RECORD=1`: one JSONL line per committed frame to `<userData>/forecast-sessions/<sessionId>.jsonl`. On disk, `processKey` and titles appear **only as FNV-1a hashes** plus `focusKind` (grafted from P2 — hashes preserve switch/distinctness signals losslessly for every feature). No titles, no raw names, no images; never leaves disk. A unit test regex-asserts no `windowTitle` string ever appears in recorder output.

---

## 3. Labels + dataset

### 3.1 JSONL schema
Exact schema with an example line in the Contracts appendix. One object per 1 Hz frame; each row also carries `prompt`/`completion` serializations so **the same file** uploads to Adaption Labs with `column_mapping {prompt, completion}` — no second format (grafted from P2).

### 3.2 Label derivation + eligibility censoring (the prediction-not-detection discipline)
Offline in `scripts/forecast/build-dataset.ts`, replaying each raw session stream through the shared ring + extractor + a `classify()`-equivalent labeler (`src/shared/forecast/labels.ts`, also used by the runtime hit/miss ledger):
- **Drift onset** = first frame where decision ∈ {`DISTRACTED`, `AWAY`} after ≥ 1 frame outside that set; onsets within 30 s of the previous merge (debounce).
- `label = 1` iff `0 < secs_to_drift ≤ 30`.
- **Excluded frames** (dropped from train AND eval — this censoring is what makes the task prediction, grafted from P1): frames during an active drift; frames while a policy countdown would be active; the 10 s after recovery/unlock; the first 15 s of a session (runtime `ready:false` anyway); **right-censoring** — the final 30 s of a session with no onset ahead (future unknown).
- Everything else `label = 0`. A strict 1-frame gap is enforced (features at `t` use samples ≤ `t`; the onset frame itself is never in its own window) — leakage unit-tested.

### 3.3 Class balance
Raw streams run ~6–12 % positive. (1) Horizon labeling multiplies positives; (2) downsample easy negatives in train only — keep all negatives within 120 s of any drift, sample 25 % of long calm stretches, target ≈ 3:1; (3) class-weighted BCE `w_pos = n_neg/n_pos`; (4) **eval split never rebalanced** — PR-AUC reported at natural prevalence with the base rate printed beside it.

---

## 4. Training pipeline

### 4.1 Layout (mirrors `scripts/desk-model/`)
```
scripts/forecast/
  lib.ts             seeded RNG (mulberry32 pattern), JSONL IO, metrics (ROC/PR-AUC, ECE, lead-time), split utils
  simulate.ts        synthetic-session simulator → raw per-session event streams
  build-dataset.ts   streams → shared ring/extractor/labeler → dataset.jsonl + provenance
  adaption.ts        Adaption Labs client: upload / augment / invent / run / status / evaluation / download
  augment-local.ts   offline fallback augmentation (identical schema, source "augmented:local")
  linear.ts          L-BFGS + weighted-L2 logistic + robust Platt (shared by train + eval)   [round 8]
  mlp.ts             forward/backward + Adam + gradient check, promoted from the winner     [round 11]
  pairwise.ts        the round-8 GLM basis, moved out of the shared core when it stopped     [round 11]
                     shipping — research scripts still fit it
  train.ts           GLM lr18+pairwise → src/shared/forecast/weights.json (+ golden fixture)
  eval.ts            held-out metrics, baselines, ablations, alarm simulation, CI gate → src/shared/forecast/eval-report.json
  adjudicate.ts      independent re-scoring + paired session-clustered bootstrap            [round 8]
  candidates/        the five bake-off contender scripts, kept as the record                [round 8]
  GAUNTLET.md        round-by-round log, desk-model format
```
Data root `data/forecast/` (add `data/` to `.gitignore`). Committed artifacts: `src/shared/forecast/weights.json` and `src/shared/forecast/eval-report.json` (which embeds the provenance object verbatim) — both imported by the UI model card, so shipped claims are the scripts' output, not copy.

### 4.2 Synthetic-session simulator (`simulate.ts`)
Seeded (`--seed`), deterministic; emits 25–45 min sessions as **raw behavior streams** (sub-second focus transitions incl. title-flip events + 4 Hz desk states) — features are never generated directly, so the extractor stays the single source of truth and label leakage is structurally impossible. Semi-Markov chain over {allow-deep, allow-shallow, grey, block, away}; log-normal dwells per archetype; a drift **hazard rate** λ(t) growing with session time, recent grey dwell, and switching burstiness — precursors *cause* drifts in the generator the way they do in life. Desk confidence is an Ornstein–Uhlenbeck process around per-state means with flicker bursts before departures. Title-flip Poisson rate per state, rising in restless phases.

Archetypes (CLI-weighted; defaults):
- **grinder** (20 %) — long allow streaks, ≤ 1 drift/session; calm negatives.
- **wanderer** (20 %) — escalating grey-app loiter → block; the legible ramp.
- **burst_switcher** (20 %) — calm → accelerating alt-tab bursts → Discord; the demo archetype.
- **away_drifter** (15 %) — desk flicker → confidence sag → AWAY; makes desk features matter.
- **research_churn** (15 %, grafted from P2) — **heavy switching + title churn entirely inside the allowlist, no drift**. The anti-if-else archetype: it forces the model to learn interactions and single-handedly kills any "switching = risk" threshold.
- **steady_then_snap** (10 %) — near-zero-warning drifts; keeps recall < 100 % and lead-time claims honest.

Levers: `--sessions --seed`, per-archetype weights, hazard scale, dwell jitter, desk-noise σ, grey vocabulary size, sensor-dropout probability, webcam-off spans. Default: 240 sessions ≈ 536 k raw frames ≈ 133 k train frames — ~40 s to train at 937 params (3 cross-validation folds, ≤ 60 epochs each with early stopping, plus the two-stage operating-point search over the same folds). The EVAL corpus is separate and larger: 900 sessions from a disjoint seed namespace, `npm run forecast:evalset`.

### 4.3 Adaption Labs (sponsor) + offline fallback + provenance
`adaption.ts` reads `ADAPTION_API_KEY` only — never a generic `API_KEY`, which would leak an unrelated credential to a third party; base `https://api.prod.adaptionlabs.ai/api/v1`, `Authorization: Bearer`. Row mapping: `prompt` = compact deterministic JSON of the frame's `raw` stats + context; `completion` = `"DRIFT" | "STAY"`.
1. `POST /datasets` (or `upload/initiate` + `complete` for the large file) with `column_mapping {prompt, completion}` — registers the canonical **train split only**; eval rows are never uploaded (held-out purity).
2. `POST /datasets/{id}/augment` — minority-class expansion biased to `DRIFT` rows; returned rows re-enter as `source:"augmented:adaption"`.
3. `POST /datasets/{id}/invent` — cold-start archetype variety; tagged `invented:adaption`, capped at 10 % of train, never in eval.
4. `POST /datasets/{id}/run` + `GET /status` + `GET /evaluation` — their adaptation job's report stored verbatim in provenance as an independent second opinion; never on the inference path.
5. `GET /datasets/{id}/download` — merged through a strict gate: schema-validate, clamp ranges, **re-label locally** via §3.2 (remote labels never trusted), drop violations with counts recorded. **Adaption-origin rows are train-only** — val/eval are always locally simulated, so held-out metrics can never be inflated by generated data (grafted from P1).

**403 degradation (today's real state):** the default `npm run forecast:data` is fully offline (simulate → build → `augment-local.ts`: seeded jitter + time-warp + archetype remix, identical schema). `npm run forecast:data -- --adaption` attempts the API and on any non-2xx logs the status, **falls back to the local augmenter automatically, exits 0**, and records the truth in the provenance object (embedded in the committed `eval-report.json` and rendered on the UI model card): `{"mode":"offline-fallback","adaption":{"attempted":true,"httpStatus":403,"datasetId":null,...},"counts":{...},"seed":42,"gitCommit":"..."}`. Honest either way; flips to the sponsor path the moment the key works. Zero demo dependency on the network.

### 4.4 Trainer (`train.ts`) — *amended round 8*
L-BFGS (m = 10, Armijo backtracking) on the convex weighted-BCE + L2 objective, λ swept over a warm-started path {1 … 1e-6} and the class-weight power over {0, 0.5, 1}, both selected on train-internal val **lead-censored (≥ 20 s) ROC-AUC** — the same metric the gate uses, on rows eval never sees. val = 10 % of train **sessions**, seed 42; float64 throughout, 8 significant digits shipped. Platt `(a,b)` fit on val logits only, by the robust Newton of Lin–Weng–Keerthi (smoothed targets + line search — the plain Newton pins `a` at ~1e7 on a near-separable slice). The standardizer is folded into the shipped coefficients. The operating point is re-derived on 3-fold cross-fitted TRAIN sessions under a fixed alarm budget. **Committed gradient-check** (grafted from P1's rigor): finite-difference vs the analytic gradient of the REAL objective closure `fitLogisticL2` optimizes, rel. err < 1e-4 — the test that proves the ML is real. *(Superseded: Adam lr 3e-3, batch 256, ≤ 400 epochs, patience 40, and a 4→3→1 toy gradient check.)* Output `src/shared/forecast/weights.json` (shape in Contracts) plus `src/shared/forecast/fixtures/golden.json` (8 input vectors → logit + risk at 1e-6) consumed by a runtime test proving the shipped TS forward pass matches the trainer bit-for-bit.

### 4.5 Evaluation protocol (`eval.ts` — the judge-facing numbers)
- **Split by session_id** (80/20 seeded hash), never by frame (autocorrelation). Eval untouched by train.ts; natural prevalence.
- Frame metrics: ROC-AUC, PR-AUC (base rate beside it), 10-bin ECE + reliability table.
- **AUC@lead≥20s** (grafted from P1, the anti-fraud headline): computed over eligible eval frames with `secs_to_drift` null or > 20 — positives are only frames 20–30 s before onset. Also reported at ≥ 10 s. This proves the model sees drifts *coming*.
- **Alarm simulation** (deployment-faithful): replay held-out sessions through the *shipped* escalation reducer at the *shipped* default thresholds; per drift, hit (pre-arm active at onset or fired within the prior 30 s) + lead time; per session, false pre-arms/hour. Report recall@30s, median + p25 lead, FA/hr.
- **Baselines, one table**: base-rate; the if-else strawman (3-rule heuristic); every single-feature logistic (best chosen adversarially by the gate metric); grey-dwell heuristic; the plain 18-feature level-block logistic; the full 24-feature logistic in two fits; the shipped head. Per-archetype slices (research_churn and steady_then_snap called out). Plus the 17-model bake-off table with paired CIs, embedded non-gating.
- **Per-feature occlusion ablation** on eval — doubles as proof the UI attributions mean something.
- **CI gate** (grafted from P2, softened against the 3 a.m. brick; **amended rounds 8 and 11**): exit nonzero unless shipped-head lead≥20s AUC ≥ the plain FULL-feature logistic's lead≥20s AUC on eval, on the same basis the head sees (required margin 0 — the bar is "must not be beaten", and round 8 could not have demanded more because no positive margin was measurable on 48 sessions). The report now also carries the MEASURED bootstrap interval of that margin: +0.0071 [+0.0035, +0.0107]. The single-feature number and the plain 18-feature number are printed as context, never as the gate. `--gate=off` bypasses but stamps `"gate":{"enforced":false}` into the committed report — the claim can be skipped, never faked. eval.ts also asserts `weights.thresholds` matches the `DEFAULT_SETTINGS` forecast keys (operating-point parity guard).
- Target line, filled with real numbers and the provenance caveat printed with it *(amended to what actually shipped)*: *"900 held-out sessions, 1 230 drift onsets: ROC-AUC 0.9510, AUC@lead≥20s 0.9330, 71 % of drifts get a warning and 57 % get the fuse shortened, median 16 s of lead on those, 0.42 false pre-arms/hour against a budget of two — versus 0.9259 for a full logistic regression on the same features (margin +0.0071, 95 % CI [+0.0035, +0.0107]) and 0.7850 for the best single-signal heuristic. Trained on simulated + locally-augmented archetypes per the provenance block."* Same-seed rerun ⇒ byte-identical report.

---

## 5. Policy / session integration

### 5.1 Separation of powers
`src/shared/policy/**` has **zero diffs**. A kill still requires a real, deterministically classified violation plus a fully elapsed countdown. The forecast's entire authority over enforcement is one number the engine already consumes fresh every step: `input.countdownSec` — bounded to `[3, settings.countdownSec]`, never lengthened, never able to start a countdown, retarget a kill, or suppress one. Forecast output is never any other input to `stepPolicy`. `forecastPrearmEnabled=false` (or `forecastEnabled=false`, or any load/inference failure) reproduces today's behavior event-for-event — regression-tested against `golden-path.json`.

### 5.2 Escalation reducer (`src/shared/forecast/escalate.ts`, pure — `stepPolicy` style)
`stepEscalation(state, input: { ts, risk, ready, decision, countdownActive, policySignal, settings }) → { state, events: ForecastEvent[] }`. Exact rules (all constants exported for tests; thresholds from settings, defaults below):
- **NUDGE**: smoothed risk ≥ `forecastNudgeRisk` (**0.50**, re-derived — §1.2 box) for 3 consecutive 1 Hz ticks; `ready`; decision ∈ {ON_TASK, IDLE}; no active countdown; ≥ 30 s since last nudge/clear → `forecast_nudge` (carries top-3 attribution keys for toast copy).
- **PRE-ARM**: smoothed risk ≥ `forecastPrearmRisk` (**0.65**, re-derived — §1.2 box) for 2 ticks, same gating, `forecastPrearmEnabled` → `forecast_prearm { fuseSec }`; state records `prearmedAt`.
- **CLEAR**: smoothed risk < `forecastNudgeRisk − 0.10` for 5 ticks from any escalated state → `forecast_clear { wasPrearmed }`. A pre-arm that clears without a drift logs `pre-arm stood down · unconfirmed` — **false alarms are as visible as hits**.
- **RECEIPT** (the unanimous steal): on drift onset (decision entering DISTRACTED/AWAY from non-drifted): pre-armed → `forecast_hit { leadSec: ts − prearmedAt }`; not pre-armed → `forecast_miss`. Both logged, both rendered.
- Session start/stop resets. Drifted decision or active countdown ⇒ escalation suppressed (policy owns the moment).

### 5.3 The fuse hook + latch rule
`ForecastHook.beforeStep(now, baseSec)` returns:
- `null` when forecast off/not-ready/not-prearmed (controller uses `resolved.countdownSec` — bytes identical to today);
- while pre-armed: `max(3, min(baseSec, forecastPrearmFuseSec))` (default ⇒ 5);
- **latch**: the moment the tap sees `start_countdown`, the value currently in force freezes and `beforeStep` keeps returning it until `kill` or `cancel_countdown`. `stepPolicy` re-derives `durationMs` from `input.countdownSec` each step (verified), so the latched value behaves exactly as if the setting had been that number — deterministic, replayable, and a pre-arm or stand-down mid-burn never stretches or shrinks a burning fuse.

Effects of events: `forecast_nudge` → toast + amber fuse-plate glow + log; `forecast_prearm` → fuse chip flips `FUSE 10s → 5s` (from `effectiveFuseSec`), plate reads `PRE-ARMED · forecast`, log; `forecast_hit` → CountdownOverlay line **"Forecast pre-armed N s before this fuse"**; `forecast_miss` → internals line "✘ missed — no warning". Optional stretch: one session-owned fun-plug blink on nudge (existing `PlugController`, never the study PC).

### 5.4 Failure containment
Every monitor entry point try/caught; first error ⇒ `off` for the session, base countdown restored, one `forecast` log line, session proceeds exactly as today. All forecast work runs synchronously inside the existing serialized evaluate queue — no new concurrency, no awaits on the kill path.

---

## 6. UI — risk meter + model internals

New renderer feature dir `src/renderer/src/features/forecast/`. Follow the dataviz skill when building the meter/sparkline (tokened colors, light/dark safe).

**Placement (merged):**
1. **Fourth sensor card** (grafted from P2): `forecastSensorCard(snapshot): SensorCardView` in `features/forecast/model.ts` (imports the `SensorCardView` type from `features/session/model`), added to the card list SessionPage passes to `SensorRail` — Foreground · Desk AI · **Forecast** · Plugs. LED tone: ok = calm, warn = elevated, danger = prearm; title `risk 34%`; body = top driver sentence; meta `937-param net · on-device` *(amended twice)*.
2. **`ForecastPanel`** — full width between the DecisionHero/clock grid and the SensorRail (Decision is the verdict; Forecast is the co-star predicting the next verdict).

**Left — `RiskMeter.tsx`:** 180° arc gauge, needle on smoothed risk, big percentage, caption "drift risk · next 30 s". Threshold ticks at the *live settings values*, labeled **nudge** and **pre-arm**, so the judge watches the needle approach a consequence. Bands slate → amber → red. Under the arc: 60 s risk sparkline with nudge ▲ / pre-arm ◆ / drift ✖ markers. Warm-up renders the needle ghosted with "warming up · n/15 s".

**Right — `InternalsPanel.tsx` (watch-it-think):**
- **Why now**: top-5 signed attribution bars, live, plain language from a `copy.ts` key→phrase map — `▲ +0.21 Fast window switching (6 in 15 s)` · `▲ +0.12 Loitering on Spotify (18 s)` · `▲ +0.09 Tab flicking (9 flips in 30 s)` · `▼ −0.14 Solid desk presence (96 %)`. Red pushes up, teal holds down; bars reshuffle as the presenter alt-tabs. (Copy uses the live in-memory process name; nothing hashed on screen.)
- **Calibration readout**, monospace (grafted from P1): `logit +0.48 → σ(a·z+b) a=1.31 b=−0.22 → risk 0.62`.
- **Hidden-layer strip** *(amended twice)*: 36 cells tinted by `tanh` of each hidden unit's pre-activation, labeled "Hidden layer · tanh" and positionally named `h01`…`h36`. Round 8 briefly made this strip one NAMED cell per feature, which was genuinely better; round 11 gave the head a real hidden layer back, so the panel says what it actually computes — anonymous learned units, read as a pattern — rather than keeping a label it no longer earns. The named, signed per-feature numbers live in the occlusion bars beside it, which are exact.
- **Receipt line**: "✔ called it 18 s early" / "✘ missed — no warning" / "◌ pre-arm stood down · unconfirmed".
- **Model card footer** (always visible; fed from imported `weights.json` + `eval-report.json`): `MLP 24→36→1 tanh · 937 params · 15 KB · on-device · 1 Hz · v ff-1 · held-out AUC 0.95 / lead≥20 s 0.93 · ECE 0.004 · data: synthetic + local-aug (Adaption: offline-fallback 403)` *(amended twice)*.

**Escalation surfaces:** `NudgeToast.tsx` (auto-dismiss 8 s, z-index below `CountdownOverlay` — the kill overlay is never obstructed): "Heads up — this matches your pre-tab-out pattern. 6 window switches in 15 s." `SessionClock` fuse plate: amber `pre-armed · forecast` treatment + `10s → 5s` chip (className + one prop). `CountdownOverlay`: optional `forecastLeadSec` prop → one line. **Timeline threading** (grafted from P2): add `"forecast"` to `PREVIEW_KINDS` and a `kind === "forecast" → "cause"` branch in `classifySessionEvent` so nudge → pre-arm → distracted → kill → hit reads as one causal story in the existing cause→countdown→consequence→recovery narrative.

**State:** `AppState.tsx` adds `forecast: ForecastSnapshot | null` (seeded by `forecastGetState()`, updated by `onForecastSnapshot`) and a `forecastEvents` ring via `onForecastEvent`; `lib/mockApi.ts` gains a scripted 1 Hz replay so browser dev/stills work without Electron.

**Web judge demo:** `scripts/forecast-preview.vite.ts` (clone of `faces-preview.vite.ts`) serves a browser page importing the **same** `@shared/forecast` core, replaying a bundled held-out trace with a scrub bar; stretch: interactive buttons (Docs / Wikipedia / Random tab / Discord) feeding the live ring. Dev-tools network tab silent — environment-agnosticism in one URL.

---

## 7. Contracts
See the **Contracts appendix** (returned alongside this doc) for the exact TypeScript of every new shared type, every IPC channel string, every settings key with default and clamp, the JSONL schema with an example line, every npm script, and the definitive file list. Summary: `src/shared/types.ts` untouched (byte-locked); new types in `src/shared/forecast/types.ts` (the `faces.ts` precedent); `docs/CONTRACTS.md` gains a "## Focus Forecast (Phase 4)" section **below** the Types fence; IPC adds one invoke + two push channels; `AppSettings` adds five **flat** keys (house `requirePatch`/`normalizeSettings` style — the nested-block variant is rejected); `SessionPush` is **not** modified.

---

## 8. File layout (ownership map respected)
| Path | Owner | Role |
|---|---|---|
| `src/shared/forecast/types.ts` | shared contracts | appendix types |
| `src/shared/forecast/hash.ts` | shared | FNV-1a 32-bit (ring, recorder, sim) |
| `src/shared/forecast/ring.ts` (+ test) | shared | frame ring, transition list, session scalars |
| `src/shared/forecast/features.ts` (+ test) | shared | `FORECAST_FEATURE_KEYS`, `extractFeatures` — single source for train + serve |
| `src/shared/forecast/labels.ts` (+ test) | shared | drift-onset + label derivation (offline builder & runtime ledger) |
| `src/shared/forecast/model.ts` (+ test) | shared | weights parse/validate (null on bad input), forward, Platt apply, occlusion attribution |
| `src/shared/forecast/escalate.ts` (+ test) | shared | pure escalation reducer + latch + receipt |
| `src/shared/forecast/purity.test.ts` | shared | asserts no `fs`/`path`/`electron`/`window`/`document` under `src/shared/forecast/` |
| `src/shared/forecast/weights.json`, `eval-report.json`, `bake-off.json`, `fixtures/golden.json` | shared artifacts | committed model + metrics(+provenance) + the non-gating bake-off table + parity vectors |
| `src/shared/forecast/index.ts` | shared | barrel |
| `src/main/forecast/monitor.ts` (+ test) | main feature dir | `ForecastMonitor`: tap handlers, frame close, inference, escalation, `ForecastHook`, pushes, log lines |
| `src/main/forecast/tap.ts` (+ test) | main | `withForecast(SessionPush)` |
| `src/main/forecast/recorder.ts` (+ test) | main | env-gated hashed-JSONL recorder |
| `src/main/forecast/integration.test.ts` | main | non-interference, golden-path, pre-arm/latch tests (uses session harness) |
| `src/main/forecast/index.ts` | main | `createForecast({loadSettings, appendLog, push})` |
| `src/main/session/controller.ts` | main (edit, 3 diffs §2.1) | hook option, beforeStep call, buildPolicyInput override param |
| `src/main/session/runtime.ts` | main (edit ~12 lines) | construct forecast, wrap push, pass hook |
| `src/main/index.ts`, `src/preload/index.ts` + `index.d.ts` | main/preload (edits) | channels, handler, api methods |
| `src/shared/ipc.ts`, `src/shared/defaults.ts`, `src/main/store/appStore.ts` | shared/main (edits) | channels + api, five settings keys, normalize clamps; `requirePatch` in controller |
| `src/renderer/src/features/forecast/{ForecastPanel,RiskMeter,InternalsPanel,NudgeToast}.tsx`, `model.ts` (+ test), `copy.ts`, `replay.ts`, `forecast.css` | renderer feature | §6 |
| `src/renderer/src/state/AppState.tsx`, `pages/SessionPage.tsx`, `pages/SettingsPage.tsx`, `features/session/{model.ts,SessionClock.tsx}`, `components/CountdownOverlay.tsx`, `lib/mockApi.ts` | renderer (edits) | wiring, 4th card, PREVIEW_KINDS/classify branch, plate, receipt, settings group, mock |
| `scripts/forecast/{lib,linear,simulate,build-dataset,adaption,augment-local,train,eval,adjudicate}.ts`, `candidates/`, `GAUNTLET.md` | scripts | §4 |
| `scripts/forecast-preview.vite.ts` | scripts | browser demo |
| `data/forecast/` (gitignored via `.gitignore` `data/` entry) | data | datasets, raw provenance |
| `docs/FORECAST.md`; `docs/CONTRACTS.md` append-only section | docs | deep-dive; Phase 4 |

---

## 9. Test plan
1. **Contracts green**: `npm run check:contracts` (types.ts untouched) + `npm run typecheck` (both tsconfigs compile `src/shared/forecast` — environment-agnosticism proven at build time) + purity test.
2. **Shared core (vitest)**: ring wraparound/coalescing/reset/no-between-session-fill; extractor golden vectors for crafted streams (steady allow; 8-switch burst; title-churn-only; desk flicker), warm-up neutrality, no-NaN fuzz (1 k random streams); labels: horizon edges (`secs_to_drift` 30 → 1, 31 → 0), all exclusion zones, 1-frame gap; model forward vs `fixtures/golden.json` @1e-6; **trainer gradient check** (finite diff, rel err < 1e-4); Platt monotone + hand-checked ECE; attribution invariants (baseline feature ⇒ ~0, switch-probe monotonicity); escalation truth table — thresholds, hysteresis, cooldown, suppression during countdown/drift, hit/miss/stood-down emission, latch, determinism.
3. **Non-interference (load-bearing)**: session harness golden script run twice — bare push vs `withForecast(push, monitor-with-throwing-model)` — assert **byte-identical `PolicyEvent` sequences** and kill timing on the recording push; exceptions never propagate.
4. **Disabled == today (grafted from P2)**: replay the `src/main/session/evidence/golden-path.json` scenario with the hook attached and `forecastEnabled:false`, then enabled-but-below-thresholds — event-for-event identical both times.
5. **Pre-arm integration** (MutableClock, `tickIntervalMs: 0` + `flush()` house style): scripted risk ramp above pre-arm, then `discordFocus` ⇒ `start_countdown.seconds === 5` and kill exactly 5 s later; latch: risk collapses mid-burn ⇒ fuse unchanged; stand-down then violation ⇒ 10 s fuse; high risk forever with **no violation ⇒ zero `start_countdown`/`kill` events**; floor: `forecastPrearmFuseSec` below 3 clamps to 3.
6. **Monitor**: frame cadence from `beforeStep` with scripted clock, `ready` gating, `forecastEnabled:false` silence, restart resets, error ⇒ `off` + base fuse.
7. **Recorder**: regex-assert no raw title/process strings in output.
8. **Pipeline smoke**: `simulate --sessions 6 --seed 7` → build (schema + session-split + exclusions asserted) → `train --epochs 3` → `eval` end-to-end offline; same seed ⇒ identical report; `adaption.ts` vs stub server: 403 ⇒ auto-fallback + truthful provenance + exit 0; 200 ⇒ upload/augment/download/re-label with drop counts.
9. **Renderer**: `features/forecast/model.test.ts` (band/tone mapping, attribution ranking + copy, receipt formatting, sensor card); `classifySessionEvent`/`PREVIEW_KINDS` forecast rows; stills at calm/elevated/pre-arm/receipt via the existing preview pattern.
10. **Manual gauntlet**: live alt-tab ramp; nudge ≤ 2 s of threshold; comply ⇒ risk falls; pre-arm ⇒ chip 10s→5s; Discord ⇒ 5 s fuse + kill + receipt; Demo Kill unaffected; webcam off ⇒ neutral desk features, no crash; toggle `forecastEnabled` off ⇒ panel dark, 10 s fuse; 30 min soak ⇒ flat memory.

---

## 10. Demo beat (< 90 s, scripted)
Setup: fuse 10 s, strict on, webcam on, Discord in background, ForecastPanel open, eval card showing held-out numbers.
- **0:00** — "Everything runs on this laptop — 937 parameters, right there in the footer. We ran eight model families against a plain logistic regression twice: the first time on 48 held-out sessions, where nothing separated and we shipped the logistic and said so; the second time on 900, where it separates and the logistic loses its own build gate." Start session in VS Code. ON_TASK, meter ~8 %, teal bars: *solid desk presence*, *on-task streak* holding risk down.
- **0:12** — Drift like a real student: Spotify, back, Chrome tabs, Spotify… Needle 8 → 45 %. Red bars overtake: *fast window switching*, *tab flicking*, *grey-app loiter*. "It's not reacting to Discord — Discord hasn't happened. It's reading the pattern that precedes it."
- **0:25** — Sustained ≥ 0.50 → **NUDGE** toast + amber glow + log. **Comply**: stay in VS Code. Risk visibly decays to ~30 %. *This is the learning-state change, inside 30 seconds — the student pulled back with zero enforcement.*
- **0:40** — Ignore it: resume flicking, faster. Past the pre-arm line (0.65) → **PRE-ARM**: plate reads *PRE-ARMED · forecast*, fuse chip flips **10s → 5s** red. Point at the hidden-layer strip and the calibration readout: "you're watching the network think, and the calibration that makes 0.83 mean 83 %. Both thresholds on that dial were searched on cross-fitted training sessions under a stated alarm budget, not picked by hand."
- **0:52** — *Now* open Discord. The unchanged deterministic policy classifies the violation and the countdown starts — **at 5 seconds**, because the fuse was pre-armed. Overlay carries the receipt: **"Forecast pre-armed 16 s before this fuse."**
- **0:58** — Discord dies (existing kill path — say so out loud). Timeline reads the causal story: nudge → pre-arm → distracted → kill → `hit · called 16 s early`.
- **1:05–1:25** *(amended to the real numbers)* — Close on the model card: "900 held-out sessions, 1 230 drifts: ROC-AUC 0.95, lead-restricted AUC 0.93 — it scores frames twenty-plus seconds out, so it isn't just recognizing the last moment. 71 % of drifts get a warning, 57 % get the fuse actually shortened with a median 16 s of lead, 0.4 false pre-arms an hour against a budget of two — and when it misses or cries wolf, it prints that too. The build fails if this model can't beat a full logistic regression on the same features; the model that shipped last week couldn't, which is why it isn't here. Provenance says exactly what was synthetic and that the sponsor pipeline is one flag away."
Fallback: `forecast:preview` browser replay of the same beat, or the mock-api replay in the console. Thresholds are live settings — tune in rehearsal, no rebuild.

---

## 11. Risks + cut lines
**Risks & mitigations**
- *Trivial proxy ("any switching/grey ⇒ drift")*: research_churn + grinder + steady_then_snap archetypes; CI baseline gate (now the full logistic on the shipped basis, with a measured CI); ablation table; per-archetype slices published; and the whole 17-model bake-off table — eight families at two feature bases, losers and all — published as a non-gating artifact.
- *Detection masquerading as prediction*: eligibility censoring + AUC@lead≥20s headline.
- *Train/serve skew*: one shared `extractFeatures`; golden-fixture parity at 1e-6.
- *Fuse-shortening feels risky*: bounded [3, countdownSec], never lengthens, latch tested, kill still needs a real violation, `forecastPrearmEnabled=false` is a one-key nudge-only mode, disabled==golden-path test.
- *Flapping/false-alarm fatigue*: EMA + consecutive-tick + hysteresis + 30 s cooldown; FA/hr first-class; unconfirmed pre-arms logged loudly.
- *Adaption 403 on demo day*: offline is the default path; `--adaption` degrades automatically with truthful provenance.
- *CI gate bricks the night*: `--gate=off` escape that stamps the bypass into the committed report.
- *Stage nerves*: thresholds are live settings; replay fallbacks; rehearse burst_switcher.

**Cut lines, in order (each leaves a coherent demo):** 1) web preview page (Electron carries it; interactive buttons go first); 2) live Adaption client (keep mapping + provenance + `--adaption` stub recording the attempt); 3) fun-plug blink; 4) Settings-page group (keys still work via `settingsSet` from devtools — `requirePatch`/`normalizeSettings` support stays); 5) hidden-unit strip (attributions are the legibility core, keep them); 6) recorder; 7) fourth sensor card (panel carries the feature); 8) **pre-arm policy effect** — flip `forecastPrearmEnabled` default to false, nudge-only, zero enforcement risk (receipt then reads "forecast flagged this N s early"); 9) ~~**last-resort model downgrade**: MLP → logistic regression on the same features~~ — *taken in round 8 and un-taken in round 11: on 48 sessions the logistic family won the gate's own metric, on 900 it loses it. The cut is still available and still cheap — the plain 25-parameter logistic scores 0.9249 against the shipped 0.9330, and the 313-parameter `mlp24-12-1` scores 0.9288 at 1.2 µs/tick with the best pre-arm recall in the field (0.5919). Either is a coherent product; neither clears the gate by a resolved margin.*

**Never cut:** the shared pure core; held-out eval with baselines + AUC@lead≥20s; the meter + attribution bars; the receipt; the non-interference test; the disabled==golden-path test; the latch test; `check:contracts` green.

**Build order (solo):** shared ring + extractor + tests → simulator + labels → trainer end-to-end + gradient check → eval + gate → tap + monitor + hook + integration tests → panel + card + toast + overlay line → adaption client → settings UI → preview page → polish/rehearse.