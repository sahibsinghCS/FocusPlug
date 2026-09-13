# Focus Forecast — training pipeline engineering notes

How the committed model artifacts (`src/shared/forecast/weights.json`,
`src/shared/forecast/eval-report.json`, `src/shared/forecast/bake-off-power.json`,
`src/shared/forecast/bake-off.json`) are produced, what the dataset schema
means, what every reported metric measures, and exactly how the Adaption Labs
integration degrades when the API refuses us. Design rationale lives in
`docs/FORECAST-DESIGN.md`; frozen contracts in `docs/FORECAST-CONTRACTS.md`;
the round-by-round tuning log in `scripts/forecast/GAUNTLET.md`.

**The shipped head is a 937-parameter tanh MLP, `mlp24-36-1`** — 24 encoded
features → 36 hidden units → 1 logit, Platt-calibrated. It replaced the
190-parameter pairwise logistic regression that round 8 shipped, for one
reason: **that GLM failed this repo's own CI gate** once the evaluation had
enough sessions to measure anything. Both facts below are produced by
`npm run forecast:pipeline`:

| | lead≥20 s AUC | gate baseline (plain 24-feature logistic) | margin |
|---|---|---|---|
| GLM `lr24+pairwise` (round 8–10) | 0.9208 | 0.9259 | **−0.0051 FAIL** |
| MLP `mlp24-36-1` (ships now) | **0.9330** | 0.9259 | **+0.0071 PASS** [+0.0035, +0.0107] |

Round 8 was not wrong to ship the GLM; it was **underpowered**. Its eval set
was 48 sessions / 78 onsets, where the paired session-clustered standard error
of a model-vs-model lead-AUC difference is ≈ 0.009 and every margin in the
five-family bake-off was 0.4–0.7 of one SE. So the honest call was "nothing
beat the simplest model by anything we can measure", and it published that.
The evaluation set has since been grown 18.75× — **900 sessions, 1 230 drift
onsets, 1.58 M scored frames, measured SE 0.0018** — and the same contest,
re-run unchanged, inverts. That corpus is now the official evaluation set:
`npm run forecast:eval` scores it, and the committed report is its output.

## Pipeline usage

```
npm run forecast:pipeline          # simulate → data → evalset → train → eval, fully offline
npm run forecast:simulate          # 240 sessions → data/forecast/raw-sessions.jsonl
npm run forecast:data              # streams → labeled dataset.jsonl + manifest.json + augment lineage
npm run forecast:data -- --adaption  # sponsor path; auto-fallback on any failure, exit 0
npm run forecast:evalset           # THE EVAL SET: 900 fresh sessions in a disjoint seed namespace
npm run forecast:train             # MLP mlp24-36-1 (937 params) → weights.json
npm run forecast:eval              # held-out metrics + CI gate + bootstrap CI → eval-report.json
npm run forecast:eval -- --gate=off    # bypass the gate, stamped "enforced": false
npm run forecast:eval -- --split-eval  # score the old 48-session split instead (toy-corpus gate test)
npm run forecast:holdout:bakeoff   # re-contest 17 models on the eval corpus (~40 min)
npm run forecast:bakeoff:publish   # distil that into the committed bake-off-power.json
```

Everything under `data/forecast/` is gitignored working data; only
`weights.json`, `eval-report.json`, `bake-off-power.json` and `bake-off.json`
are committed. The full pipeline runs in about 7.5 min on a 4-core Linux box —
452 s measured end to end, in pipeline order: simulate 2 s, dataset 22 s, eval
corpus 96 s to build, trainer 39 s, scoring 293 s. Scoring dominates because of
its 2000-draw session-clustered bootstrap, not because of the model. The
pipeline is deterministic under `--seed` (default 42): rerunning
`forecast:train`/`forecast:eval` on the same dataset reproduces both artifacts
except for their stamps — all 937 weights and every metric come back
identical, and the whole diff is `createdAt` plus the `trainProvenanceSha`
derived from it in `weights.json` (2 lines), and `createdAt` ×2, the recorded
`gitCommit` ×3 and `provenanceSha` in `eval-report.json` (6 lines). Those
`gitCommit` lines move only when HEAD does: they record which commit produced
the run, not anything about the model.

Useful levers (see each script's `readConfig`): `--sessions`, `--weights
grinder=0.2,...`, `--hazard`, `--desk-hz`, `--desk-noise`, `--webcam-off`,
`--augment-fraction`, `--epochs`, `--pos-weight-power`, `--val`.

## Stage 1 — simulator (`scripts/forecast/simulate.ts`)

Emits 22–40 min sessions as RAW behavior streams — sub-second focus
transitions (process + window title, allow/block flags) and 2 Hz desk states
(Ornstein–Uhlenbeck confidence around per-mode means) — never features. Six
archetypes (weights CLI-tunable): `grinder`, `wanderer`, `burst_switcher`,
`away_drifter`, `research_churn`, `steady_then_snap`.

Drifts are *caused*, not scripted: a per-second hazard λ reads the
generator's own recent behavior (leaky grey-occupancy and switch-rate
trackers, desk-sag ramps), gated so it stays ~0 for the first ~30–45 s of an
episode and steep afterwards. Consequences: precursors are inside the
15–60 s feature windows 20–30 s before an onset, and the *true* posterior
P(drift ≤ 30 s) genuinely exceeds the pre-arm threshold deep into an
episode — a calibrated model can only pre-arm because the world actually
behaves that way. Two archetypes exist to keep the model honest:
`research_churn` switches heavily *inside* the allowlist and never drifts
(kills any "switching ⇒ risk" if-else); `steady_then_snap` drifts with
near-zero warning off a behavior-independent hazard (keeps recall < 100 %).

## Stage 2 — dataset builder (`scripts/forecast/build-dataset.ts`)

Each raw session is replayed through the SHARED core — `TelemetryRing` →
`classify()` → `extractFeatures()` → `findDriftOnsets()`/`labelFrames()` from
`src/shared/forecast` — the identical code path runtime inference uses, so
train/serve skew is impossible by construction. One JSONL row per surviving
1 Hz frame, schema exactly as frozen in FORECAST-CONTRACTS §4:

```
v · session_id · source ∈ synthetic|recorded|augmented:local|augmented:adaption|invented:adaption
archetype · split ∈ train|eval (assigned per SESSION by seeded hash, 80/20)
t · features[24] (encoded, pre-normalization) · raw {24 human-unit values}
label (0|1: onset within 30 s) · secs_to_drift · drift_type
prompt ("fp-forecast v1 | sw15=… tc60=…") · completion ("DRIFT"|"STAY")
```

Censoring (dropped from train AND eval — this is what makes the task
prediction, not detection): frames during an active drift or countdown, 10 s
after recovery, the first 15 s warm-up, and the right-censored final 30 s of
a session with no onset ahead.

Train-only rebalancing: every negative within 120 s of an onset is kept, calm
stretches are sampled at 25 % (seeded per session), eval is NEVER rebalanced.
The keep-probability rule is derivable from a row alone
(`keepProbability` in `lib.ts`), so train.ts can invert it into importance
weights. The builder also self-checks its prompt re-encoder against the real
extractor on every run (`encodeRaw` vs `extractFeatures`, 1e-9).

Local augmentation (`augment-local.ts`): seeded jitter (desk-confidence
noise, retitled windows), time-warp (0.9–1.12×), and same-archetype session
remixing — applied to RAW streams and replayed through the same
ring/extractor/labeler, `source: "augmented:local"`, train-only. **The
augmenter now records its own lineage**: every generated session carries the
train session ids it descends from, and the builder writes them to
`data/forecast/augment-parents.json`. That sidecar is what lets the trainer
keep a jittered copy of a validation session out of that fold's fit set — see
the leak fix in stage 3.

## Stage 2b — the evaluation set (`scripts/forecast/build-evalset.ts`)

`npm run forecast:evalset` builds **the corpus every published number is
measured on**: 900 sessions, 1 230 drift onsets, 1 673 451 raw frames,
1 581 863 surviving rows, 13 530 lead≥20 s positives against 1 544 963
eligible negatives, 464.8 h.

Same generative process as training — `simulate.ts` untouched, all six
archetypes at the default mix, the same replay through the shared core, the
same frozen row schema — and **never downsampled**, so every metric estimates
natural prevalence with unit weights.

Not contaminated, by three independent barriers defined and asserted in
`holdout-namespace.ts`, re-verified on every generation:

1. **Seed** — base seed shifted by `HOLDOUT_SEED_OFFSET` (7e8) and session
   index by `HOLDOUT_INDEX_BASE` (9e6), so the string `simulate.ts` hashes
   into a PRNG seed differs from every training string in two places. Checked
   by intersecting against the real training corpus's seeds AND every seed a
   training run of up to `--sweep` sessions could produce at any base seed.
2. **Id** — eval sessions are `hld-…`; training rows are `syn-`/`aug-`/`adp-`.
   Checked against the distinct `session_id` set of the actual
   `dataset.jsonl`, and re-checked by `eval.ts` before it scores a frame.
3. **Content** — every eval session's raw focus+desk stream is hashed and
   compared against the hash of every session that has ever entered the
   training dataset, simulated AND locally augmented.

**The caveat that does not go away**: this is fresh sampling from the same
simulator, not new recorded data. It removes sampling noise; it does not
remove simulator misspecification, and GAUNTLET rounds 1–6 tuned both the
simulator and the feature set with held-out diagnostics, so the world these
models are measured in was shaped by the same evaluation. It is fresh data for
the models, not a fresh universe.

## Stage 3 — trainer (`scripts/forecast/train.ts`)

The shipped head is a **tanh multilayer perceptron**,
`FORECAST_INPUT_DIM → FORECAST_HIDDEN_DIM → 1` = 24 → 36 → 1, **937 trainable
parameters** (864 hidden weights + 36 hidden biases + 36 output weights + 1
output bias), ~15 KB of JSON, **900 multiply-accumulates + 36 tanh per tick**.

The hidden layer is not a design guess. The trainer fits **three independent
`24→12→1` members on disjoint cross-validation folds** and blends their logits
affinely. An affine blend of tanh nets that share one input standardizer
collapses EXACTLY into one `24→36→1` net, so what ships is a plain two-layer
forward pass, not an ensemble loop — and train.ts proves it before writing:

```
collapse verified on 5093 train frames: the single mlp24-36-1 net equals the
3-member ensemble to 1.39e-15 risk, and 8-digit serialization costs a further 2.06e-8
```

The hyper-parameters are **pinned** from the `mlp-tuned` bake-off contender's
committed `data/forecast/candidates/mlp-tuned/metrics.json`
(`18-12-1 tanh lr0.01 b256 l2 3e-3 do0 const pw0.5 e60 k1/fold`). Its 10-stage
sweep is NOT re-run here, so nothing is re-selected against the corpus this
model is then scored on.

Protocol (only `split:"train"` rows are ever read):

- **Calibration slice = 15 % of synthetic train SESSIONS**, in no fold's fit
  set. The blend standardization and the Platt scaling are fitted there, so the
  shipped risk numbers come from rows no member ever trained on.
- **3 cross-validation folds.** Member `f` trains on every fold but `f` and is
  early-stopped on fold `f`.
- **THE LEAK FIX.** Augmented sessions are assigned to their PARENT's fold and
  dropped when their parents straddle folds or descend from the calibration
  slice (30 attached, 18 dropped at the default 0.25 augmentation fraction).
  The round-7 MLP trainer did not do this: it put jittered and time-warped
  copies of its own validation sessions into the fit set, so every
  early-stopping decision it made was read off an optimistic number. The
  `mlp-tuned` contender found and fixed it; this is that fix, adopted.
- **Selection metric** = fold-val lead-censored (≥ 20 s) ROC-AUC **+ 0.1 ×
  nudge recall@30 s** through the SHIPPED escalation reducer on the fold's own
  validation SESSIONS. The first term is the metric eval.ts gates on; the
  second stops the sweep from preferring a model that ranks well and never
  fires. Both are computed on rows eval.ts never sees.
- **Sample weights** = the class weight `(Σw_neg/Σw_pos)^0.5`, tempered — the
  round-7 pick, held fixed. Val and calibration metrics additionally weight by
  1/keep-probability (undoing the builder's train-only calm-negative
  downsampling) so Platt targets *natural* prevalence, not the rebalanced file.
- **Platt** `σ(a·z + b)` on the calibration slice only, fitted by the robust
  Newton of Lin–Weng–Keerthi (smoothed targets + backtracking line search). The
  plain Newton iteration is not safe here: on a near-separable calibration
  slice the curvature underflows and one overshooting step pins `a` at ~1e7 —
  a step-function "calibrator" that silently wrecks every threshold downstream.
  Shipped: `a 2.0868, b −5.7953`.
- **The standardizer is folded in.** The fit z-scores the 24 features; the
  artifact ships `W1_ji = θ_ji/s_i` and `b1_j = β_j − Σ_i θ_ji·m_i/s_i`, so
  runtime inference is one dense layer and the payload really is 937 floats
  plus the Platt pair — not weights plus a hidden 48-float scaler riding
  alongside an understated parameter count. `norm.mean` still ships as the
  occlusion baseline the UI attributions use; `norm.scale` as published
  dispersion.
- **Gradient check** — finite differences against the analytic gradient of the
  SAME forward/backward code the members train with (`scripts/forecast/mlp.ts`,
  promoted verbatim from the winning contender exactly as `linear.ts` was
  promoted after round 8), worst rel err 1.4e-7, before every run.
- The **plain additive logistic** (25 params) is fitted too and recorded in
  provenance: it is the "did you try logistic regression?" reference and the
  model eval.ts anchors its gate to.

`weights.json` carries `basis: "mlp24-36-1"` and `basisSha`, an fnv1a32 of the
basis name + activation + canonical feature keys, and `parseForecastWeights`
refuses any file whose checksum disagrees: changing the width, the activation
or the feature order fails closed instead of silently mapping weights onto the
wrong inputs. `weights.json` must round-trip that parser or train.ts refuses to
write it. `trainProvenanceSha` is the sha-256 of the canonical-JSON provenance
object written to `data/forecast/provenance.json`.

### The operating point is trained, not guessed — and BOTH axes are

`thresholds` are copied from the `DEFAULT_SETTINGS` forecast keys (parity), but
the trainer **re-derives what those keys should be** and warns loudly when they
disagree — so the shipped default is a measured choice with a paper trail.

Round 10 made re-deriving this the non-negotiable condition of the model swap,
and it was right. A threshold is a cut on a *risk scale*, and the inherited
0.80 pre-arm line was derived for the previous GLM's scale. At that inherited
line this MLP's pre-arm recall is **0.3358**, against the GLM's 0.5569 — the
fuse-shortening feature would have been half-dead purely because a different
model's calibrated risk saturates in a different place. At its OWN re-derived
line it is **0.5748**, above the GLM. That gap is the whole argument.

The search runs on **cross-fitted TRAIN sessions** — 192 sessions, 242 onsets,
98.1 h — each scored by a model that never saw it: a fold-`f` session by member
`f` (the only member whose fit set excluded it), rescaled so its
calibration-slice logit spread matches the shipped blend's and read through the
SHIPPED Platt; a calibration-slice session by the shipped net, which never
trained on it. No eval row is opened; no cross-fit model ships.

Three ceilings (`scripts/forecast/lib.ts`):

| ceiling | value | why |
|---|---|---|
| `research_churn` frame FPR | ≤ 0.01 | the anti-if-else archetype must not fire |
| alarm load | nudges/h ≤ 1.15× the rate the SAME model produces at the FROZEN 0.55/0.80 point on the SAME sessions | recall cannot be bought with volume; a RATIO, so the cross-fit's own risk scale cancels; a FROZEN anchor, so re-runs cannot ratchet the threshold down against their own previous answer |
| false pre-arms/hour | ≤ 2 | the design's stated budget (FORECAST-DESIGN §4.5) |

**Two stages, because the product makes two promises with two budgets.**

1. **The nudge line**, with the pre-arm line held at its frozen 0.80: maximize
   recall@30 s under the nudge rule, subject to the alarm-load ceiling. This is
   round 8's rule unchanged, so the nudge threshold stays comparable across the
   whole gauntlet. Selected: **0.50** (2.59 nudges/h against a 2.66 ceiling).
2. **The pre-arm line**, with the nudge line now fixed: maximize recall@30 s
   under the pre-arm rule — the fuse-shortening feature — subject to < 2 false
   pre-arms/hour and a floor on stage 1's nudge recall. Selected: **0.65**
   (pre-arm recall 0.5372 vs 0.2810 at 0.80, 0.38 false pre-arms/h).

Both refinements are there because the naive version is measurably wrong, and
the record says so rather than presenting the final rule as obvious:

- **A single joint objective on nudge recall picks the WORST pre-arm line on
  the grid.** Raising the pre-arm threshold DELETES pre-arm events, which buys
  alarm-load headroom, which buys a lower nudge threshold. Run as one search it
  selects 0.40/0.90 — pre-arm recall **0.116** — to win +0.07 of nudge recall.
- **The load ceiling counts NUDGES, not nudges + pre-arms.** Counting both was
  tried; it double-counts a pre-arm, which already has its own stated budget,
  and it is the mechanism by which the joint objective goes wrong.
- **Stage 2 has a floor on stage 1's recall.** An over-eager pre-arm CONSUMES
  an escalation: the reducer latches the band, suppresses further nudges, and a
  stand-down before the onset spends the warning for nothing. The tolerance is
  not a guess — it is one standard error of a recall estimate on the search
  corpus, `sqrt(p(1−p)/onsets)` = 0.0294 over 242 onsets. Anything outside it
  is a real loss and is refused.

`DEFAULT_SETTINGS.forecastNudgeRisk` (0.45 → **0.50**),
`DEFAULT_SETTINGS.forecastPrearmRisk` (0.80 → **0.65**) and
`weights.thresholds` moved together, so eval.ts's parity assertion still holds.

## Stage 4 — evaluator (`scripts/forecast/eval.ts`)

Scores the 900-session eval corpus (never seen by train.ts, natural prevalence;
`augmented:*` rows are refused by assertion, and a hold-out session id
appearing in `dataset.jsonl` aborts the run). Metrics in the committed report:

- **rocAuc / prAuc / baseRate** — frame-level ranking over all eval frames;
  PR-AUC is reported beside the base rate because 2.3 % prevalence makes
  PR-AUC the harsher number.
- **aucLead20 (the headline) / aucLead10** — lead-censored ROC-AUC: only
  frames whose nearest onset is ≥ 20 s away (positives are therefore 20–30 s
  before onset) vs calm frames. High values structurally prove the model
  sees drifts *coming*; last-second detection scores ~0.5 here.
- **ece + reliability** — 10-bin expected calibration error; the reliability
  table lets you check that "0.83" means 83 %.
- **operatingPoints** — frame precision/recall/FPR at the shipped nudge
  (0.50) and pre-arm (0.65) thresholds.
- **alarms** — deployment-faithful simulation: eval raw sessions replayed
  through the SHIPPED `stepEscalation` reducer (EMA smoothing, sustain ticks,
  cooldown, hysteresis) at the SHIPPED default settings, under BOTH hit rules:
  `recallAt30` (strict: a pre-arm was active at onset or fired in the prior
  30 s — the fuse was actually shortened) and `recallAt30Nudge` (any
  nudge-or-higher alarm in the prior 30 s). False pre-arms are the reducer's
  stood-down clears with no drift within 30 s. The block also carries the
  trainer's operating-point search grid verbatim.
- **power** — the paired session-clustered bootstrap (2 000 draws, clustered by
  session, fixed seed 20260913), the measured SE, the smallest 95 %-resolvable
  difference, and every round-8 bake-off margin re-asked under this power.
- **baselines** — base-rate, 3-rule if-else strawman, grey-dwell heuristic,
  per-feature logistics (all 24 listed), best single-feature logistic (chosen
  adversarially BY held-out lead-censored AUC), **the plain 18-feature
  level-block logistic** (context for what the trend block buys), the full
  24-feature logistic in TWO fits, and the shipped model.
- **bakeOffPower** — `src/shared/forecast/bake-off-power.json` embedded
  verbatim: 17 fits, every family at BOTH feature bases, with CIs and the
  feature-vs-architecture decomposition. NON-GATING, published on purpose.
- **bakeOff** — round 8's original five-family table, embedded verbatim and
  labelled HISTORICAL.
- **perArchetype** — frames, base rate, FPR at both thresholds, false
  pre-arms/hour, hits/drifts per archetype; `research_churn` is asserted to
  exist in eval and is the anti-if-else slice (shipped: FPR@nudge 0.0000).
- **ablation** — per-feature occlusion (feature → its training mean), as
  lead≥20s AUC drop; doubles as proof the UI attributions mean something.

Guards: `weights.thresholds` must equal the `DEFAULT_SETTINGS` forecast keys
(operating-point parity), and the provenance object embedded verbatim in the
report must hash to `weights.trainProvenanceSha`.

### The CI gate

**Exit nonzero unless `aucLead20(shipped) ≥ aucLead20(plain full-feature
logistic)`.**

The baseline is the strongest plain additive logistic we can produce on the
SAME 24 features the shipped head sees: the historical class-weighted GD fit
(`lib.trainLogistic`, 0.9206) and an L-BFGS-to-convergence refit on ALL train
rows, importance-weighted, at the λ `train.ts` selected on its train-internal
calibration slice (0.9259) — whichever is higher. The converged fit is
deliberately given MORE data than the shipped model (it sees the calibration
sessions the shipped model held out), because the gate should anchor to the
best plain logistic that exists, not a convenient one. Growing the feature set
moves the bar with it, so a feature block that helps the baseline more than the
head cannot hide behind an old baseline.

**Required margin: 0.** The bar is the one a hostile question actually asks —
"does the shipped head beat a logistic regression?" — and the gate fails the
build the moment the answer stops being yes. Round 8 additionally *could not*
have demanded more: no positive margin was measurable on 48 sessions. That
constraint is gone, and the report now carries the measured interval:

```
margin +0.0071, 95 % CI [+0.0035, +0.0107], SE 0.0018, p 0.0005, 2000 draws, resolved: true
```

The bar stays at zero anyway, because a gate should encode the promise, not the
current comfortable distance from it. The legacy bar is still computed and
printed as context (+0.1480 over the best single-feature logistic,
`otherDwell30` at 0.7850), never as the gate. `--gate=off` bypasses the exit
code but stamps `"gate": {"enforced": false}` into the committed report — the
claim can be skipped, never faked.

The gate has teeth, and that is verified rather than asserted: running the same
pipeline on a 30-session toy corpus with `--split-eval` makes a pairwise
expansion overfit below the plain logistic and `forecast:eval` exits 1. It has
also now failed for real: the head that shipped between rounds 8 and 11 scores
0.9208 against 0.9259 on this corpus, margin −0.0051, and that is why it was
replaced.

## Shipped numbers

Committed `src/shared/forecast/eval-report.json`, 1 581 863 held-out frames /
900 sessions / 2.33 % positive / 1 230 drift onsets / 464.8 h, seed 42:

| Metric | Shipped MLP `mlp24-36-1` (937p) | Previous GLM `lr24+pairwise` (325p) |
|---|---|---|
| **lead≥20s AUC (headline)** | **0.9330** | 0.9208 |
| lead≥10s AUC | **0.9459** | 0.9364 |
| ROC-AUC | **0.9510** | 0.9424 |
| PR-AUC (base 0.0233) | **0.6311** | 0.5283 |
| ECE (10-bin) | **0.0038** | 0.0067 |
| recall@30s, nudge rule | 0.7081 (871/1230) | **0.7472** (919/1230) |
| recall@30s, pre-arm rule | **0.5748** (707/1230) | 0.5569 (685/1230) |
| median / p25 pre-arm lead | 16 s / 11 s | 14 s / 9 s |
| nudges/h · false pre-arms/h | **2.28** · **0.42** | 2.97 · 0.56 |
| research_churn FPR @ nudge | **0.0000** | 0.0000 |
| µs/tick (this machine) | **3.1** | 5.1 |
| gate margin vs plain logistic | **+0.0071 PASS** | −0.0051 **FAIL** |

The GLM column is the committed `weights.json` of 2026-09-13 scored verbatim
through the shipped forward pass on this same corpus — row
`shipped:lr24+pairwise` of `bake-off-power.json`, at its own derived operating
point 0.45/0.80.

**Where the swap costs us, stated out loud.** Nudge-rule recall is 0.7081 vs
0.7472 — 48 fewer of 1 230 onsets get *some* warning. It is bought back in two
places and neither is hand-waving: the alarm load is **23 % lower** (2.28 vs
2.97 nudges/h), and the *pre-arm* recall — the one that actually shortens the
fuse — is **higher** (0.5748 vs 0.5569) at **25 % fewer false pre-arms**. At
the GLM's own louder operating point (0.45/0.80) this head scores nudge recall
**0.7837** at 3.11 nudges/h (row `mlp-tuned24` of `bake-off-power.json` — the same recipe refit by the bake-off harness, which reproduces the shipped head's lead≥20 s AUC to four decimals), so the recall difference is a
threshold choice inside a stated budget, not a property of the model. Both
numbers are in committed artifacts.

Per family (pre-arm-rule hits/drifts): away_drifter 336/343, burst_switcher
288/394, wanderer 83/385, steady_then_snap 0/101 (unforecastable by
construction), grinder 0/7, research_churn 0 drifts. **Wanderer remains the
weak family** and is where the next real gain is.

**The ceiling nobody can tune past.** The maximum reachable smoothed risk in
the 30 s before an onset caps threshold-only recall at ≈ 0.859 — measured on
the 48-session split for both the hybrid contender and the round-7 incumbent,
so ~14 % of onsets are a genuine ceiling rather than a tuning failure. This
corpus agrees on the mechanism: `steady_then_snap` contributes 101 of 1 230
onsets (8.2 %) and is unforecastable by construction, and there is a low-risk
wanderer tail underneath it. Raising recall past that needs a different
signal, not a different threshold.

## The bake-off — every family we tried, both times

Two committed artifacts, both embedded in `eval-report.json`, both NON-GATING.

### `bake-off-power.json` — the contest that chose this head

`npm run forecast:holdout:bakeoff` refits 17 models — **eight families at BOTH
feature bases** — on `split:"train"` rows only and scores every one on this
same 900-session corpus, through one replay, one metric, one operating point
(the then-shipped 0.45/0.80, applied identically to everybody so the rows are
comparable) and one escalation reducer. `npm run forecast:bakeoff:publish`
distils it. Uncertainty: paired session-clustered bootstrap, 2 000 draws over
the 900 sessions, one draw matrix shared by every model, cross-checked against
`scripts/forecast/bootstrap.ts` at |Δ| = 0.

| model | d | params | lead≥20s | 95 % CI | nudge rec | pre-arm rec | PR | ECE | µs/tick |
|---|---|---|---|---|---|---|---|---|---|
| mlp-tuned18 | 18 | 721 | **0.9349** | [0.9252, 0.9445] | 0.7504 | 0.2268 | 0.5765 | 0.0054 | 2.6 |
| **mlp-tuned24 (SHIPPED)** | 24 | **937** | **0.9330** | [0.9226, 0.9431] | 0.7837 | 0.3358 | 0.6310 | 0.0038 | **3.1** |
| trees24 (GBDT, 83 trees) | 24 | 2 115 | 0.9320 | [0.9221, 0.9412] | **0.8236** | 0.0293 | 0.6177 | **0.0012** | 3.4 |
| hybrid25 | 25 | 888 | 0.9313 | [0.9220, 0.9404] | 0.7276 | 0.4406 | 0.6177 | 0.0052 | 2.6 |
| hybrid26 | 26 | 921 | 0.9297 | [0.9194, 0.9394] | 0.7553 | 0.5033 | 0.6216 | 0.0048 | 2.6 |
| mlp24-12-1 (round-7 arch) | 24 | 313 | 0.9288 | [0.9191, 0.9383] | 0.7569 | **0.5919** | 0.6120 | 0.0038 | 1.2 |
| lr18+pairwise (round-8 head) | 18 | 190 | 0.9282 | [0.9187, 0.9377] | 0.7407 | 0.5293 | 0.5222 | 0.0065 | 2.7 |
| mlp18-12-1 (round-7 head) | 18 | 241 | 0.9270 | [0.9167, 0.9364] | 0.7805 | 0.5398 | 0.5576 | 0.0040 | 0.8 |
| *lr24 (plain — GATE BAR)* | *24* | *25* | *0.9249* | *[0.9141, 0.9351]* | *0.6992* | *0.3431* | *0.5276* | *0.0043* | *0.8* |
| temporal-ens24 (CNN ×3) | seq | 14 899 | 0.9245 | [0.9144, 0.9345] | 0.7805 | 0.3756 | 0.5971 | 0.0019 | **301** |
| trees18 | 18 | 3 011 | 0.9229 | [0.9118, 0.9333] | 0.8024 | 0.1220 | 0.5526 | 0.0017 | 4.9 |
| temporal-ens18 (CNN ×3) | seq | 14 803 | 0.9225 | [0.9121, 0.9327] | 0.7789 | 0.3927 | 0.5994 | 0.0020 | 338 |
| *lr18 (plain)* | *18* | *19* | *0.9222* | *[0.9121, 0.9320]* | *0.4675* | *0.2016* | *0.4537* | *0.0062* | *0.5* |
| lr24+pairwise (refit) | 24 | 325 | 0.9209 | [0.9103, 0.9306] | 0.7472 | 0.5553 | 0.5284 | 0.0068 | 4.0 |
| **shipped weights.json verbatim** | 24 | 325 | **0.9208** | [0.9101, 0.9305] | 0.7472 | 0.5569 | 0.5283 | 0.0067 | 5.1 |
| temporal-1net24 (CNN) | seq | 5 201 | 0.9173 | [0.9069, 0.9274] | 0.7439 | 0.5065 | 0.5559 | 0.0042 | 112 |
| temporal-1net18 (CNN) | seq | 5 105 | **0.9139** | [0.9034, 0.9243] | 0.7439 | 0.5406 | 0.5512 | 0.0038 | 112 |

Measured paired session-clustered SE: **0.0028 on average** across all 96
model-vs-reference pairs (range 0.0001–0.0038), so the smallest 95 %-resolvable
lead-AUC difference is ≈ **0.0054** for a typical pair and **0.0036** for the
gate pair the report measures directly — against ≈ 0.009 and ≈ 0.018 on the
48-session split. Paired margins:

- **vs the plain 24-feature logistic (the gate bar, 0.9249)**: mlp-tuned18
  +0.0100 [+0.0052, +0.0148]; **mlp-tuned24 +0.0082 [+0.0043, +0.0116]**;
  trees24 +0.0071 [+0.0013, +0.0128]; hybrid25 +0.0064 [+0.0008, +0.0118] —
  all RESOLVED. Not resolved: hybrid26 +0.0048, mlp24-12-1 +0.0039,
  lr18+pairwise +0.0034, temporal-ens24 −0.0003. Resolved WORSE:
  lr24+pairwise −0.0040, temporal-1net18 −0.0110.
- **vs the strongest LINEAR model (lr18+pairwise, 0.9282)**: mlp-tuned18
  +0.0066 [+0.0025, +0.0108]; **mlp-tuned24 +0.0048 [+0.0005, +0.0095]** —
  resolved. trees24 +0.0038 — not resolved. lr24+pairwise −0.0074 [−0.0128,
  −0.0026] — resolved WORSE.
- **vs the head that shipped (lr24+pairwise, 0.9209)**: **mlp-tuned24 +0.0122
  [+0.0069, +0.0178]**; mlp-tuned18 +0.0140; trees24 +0.0111; hybrid25 +0.0104;
  lr18+pairwise +0.0074 — all resolved.

**Why mlp-tuned24 and not the others.** mlp-tuned18 ties it (−0.0018 [−0.0058,
+0.0019]) but would require un-appending `FORECAST_FEATURE_KEYS`, which the
contract forbids, and loses on recall, pre-arm, PR-AUC and ECE. trees24 ties on
ranking but buys 0.8236 nudge recall with 4.02 nudges/h — a 35 % louder product
that breaks the trainer's own alarm-load ceiling — and its isotonic calibrator
reaches 0.80 so rarely that its pre-arm recall is 0.0293: the fuse-shortening
feature would be dead. hybrid25/26 tie but need features the shipped extractor
does not have. mlp24-12-1 is far simpler (313 params, 1.2 µs) and has the best
pre-arm recall in the field, but does NOT clear the primary bar: +0.0039
[−0.0018, +0.0093] over plain lr24 is not resolved. **Round 8's cost argument
still kills the temporal CNN** — 14 899 parameters and 301 µs/tick to score
0.9245, statistically indistinguishable from a 25-parameter logistic — but it
does not touch this swap: 937 parameters at 3.1 µs/tick is *faster per tick*
than the 325-parameter GLM it replaces, because a 36-unit dense layer is
cheaper than 324 basis products.

**A cost claim from round 8 was wrong and is corrected here.** That round
compared the GLM's ~360 multiply-adds against "~450" for the 18→12→1 MLP it
replaced. The MLP forward is **228 multiply-accumulates plus 12 tanh**
(`W1` 12×18 = 216, `b1` 12, `w2` 12, `b2` 1), so the GLM was never cheaper than
the head it replaced — it was dearer. It changed nothing: at 18 features both
are well under a microsecond and cost was never close to deciding between them.
Measured on one machine, all in the same breath so the comparison is honest:
plain lr18 **0.5 µs**, mlp18-12-1 **0.8 µs**, lr18+pairwise **2.7 µs**,
lr24+pairwise **4.0 µs**, the shipped mlp24-36-1 **3.1 µs**, temporal-ens24
**301 µs**. Cost decides exactly one comparison in this whole project, and it
is the last one.

### Features vs architecture — round 9's conclusion does not replicate

Round 9 concluded that FEATURES beat ARCHITECTURE: that the six trend features
were worth more than any hidden layer anyone tried, and that adding
`deskSagSlope30` (+0.0270 by occlusion), `dwellShrink30v90` (+0.0092) and
`titleChurnAccel` (+0.0054) beat every architecture in the field. Fitting every
family at BOTH bases tests that directly.

**FEATURE effect** (24-basis minus 18-basis, same architecture): GBDT +0.0091,
temporal-1net +0.0033, plain logistic +0.0027, temporal-ens +0.0020, TinyMLP
+0.0019, hybrid −0.0017, mlp-tuned −0.0018, and **the round-8 pairwise GLM
−0.0074 [−0.0128, −0.0026]**. Mean **+0.0010**, indistinguishable from zero at
this SE, and decisively negative for the head that was shipping — 324 pairwise
terms on 133 k train rows overfit where 189 did not.

**ARCHITECTURE effect** (vs the plain additive logistic at the same basis):
mlp-tuned +0.0127 (18) and **+0.0082 (24)**, hybrid25 +0.0091, trees24 +0.0071,
pairwise GLM +0.0061 (18) but **−0.0040 (24)**, mlp24-12-1 +0.0039,
temporal-ens +0.0003 / −0.0003.

So it inverts. The feature block is not worthless — it is what moved the
PRE-ARM, and that part does replicate (lr18+pairwise 0.5293 → lr24+pairwise
0.5553 pre-arm recall on 1 230 onsets) — but as a *ranking* improvement it does
not, and neither does hybrid's 0.9325 → 0.9408 ablation ladder nor its +0.0190
inner-val gain. **The general lesson is the one worth keeping: a resolved
margin at n = 48 is not a margin.**

### `bake-off.json` — round 8's original contest, HISTORICAL

Five families on the 48-session split at the feature basis of 2026-09-12, with
the same paired-bootstrap machinery. Kept verbatim, and labelled in the report
as historical, because the retraction is only legible next to it. Its
conclusion — "no non-linear model beat the strongest linear result by a margin
this eval set can resolve" — was a true statement *about 48 sessions*, and the
honesty clause it fired was the right call on the evidence it had.

### The open question we still have not closed

The temporal contender's PURE-sequence net sees **zero hand-engineered
features** and still scores 0.9340 lead≥20 s on the 48-session split — above
the 241-parameter MLP that shipped at the time. On this corpus its best
variants land at 0.9245 (ensemble) and 0.9173 (single net), below the plain
24-feature logistic, and the 14 899-parameter ensemble at 301 µs/tick is
statistically indistinguishable from a 25-parameter logistic. So this round
makes the "raw 1 Hz stream carries signal the window aggregates destroy"
hypothesis *less* likely rather than more — but it does not settle it, because
both corpora come from the same simulator, and a simulator's raw stream is
exactly the place its misspecification would hide. Settling it needs a real
recorded corpus, not another architecture.

## Adaption Labs integration + provenance honesty

`scripts/forecast/adaption.ts` (base
`https://api.prod.adaptionlabs.ai/api/v1`, key from `ADAPTION_API_KEY` and
nothing else): `POST /datasets` (column_mapping {prompt, completion}) →
presigned PUT + `POST /datasets/upload/complete` → poll
`GET /datasets/{id}/status` → `POST /datasets/{id}/augment` → poll →
`GET /datasets/{id}/download?fileFormat=jsonl`. Only the TRAIN-split seed is
ever uploaded (`data/forecast/adaption-seed.jsonl`); eval rows never leave
the machine.

Downloaded rows pass a strict gate: the prompt is parsed back into raw
units, range-checked, re-encoded with the shared formulas, the completion
must be exactly DRIFT/STAY, violations are dropped with counts recorded, the
merge is capped at 25 % of train rows, and every merged row is
`source:"augmented:adaption"`, train-only — held-out metrics can never be
inflated by generated data.

The client never throws: any auth/network/non-2xx/timeout failure returns a
structured outcome, build-dataset prints one `WARN` line, falls back to
`augment-local.ts`, exits 0, and stamps the truth into the manifest, which
train.ts folds into the provenance embedded in the committed report:

```json
"mode": "offline-fallback",
"adaption": { "attempted": true, "ok": false, "httpStatus": 403,
              "error": "POST /datasets HTTP 403: …Invalid token…",
              "datasetId": null, "augmentedDatasetId": null,
              "mergedRows": 0, "droppedRows": 0 }
```

That block is the real state recorded on 2026-09-12 when the sponsor key was
live-tested (403). The committed report currently carries `"mode": "offline"`,
because the pipeline that produced it was run without `--adaption`: the shipped
numbers are trained on simulated + locally augmented sessions, and say so. The
moment the key works, the same `--adaption` flag flips the pipeline to the
sponsor path with no other change.
