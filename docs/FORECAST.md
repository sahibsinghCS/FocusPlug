# Focus Forecast — training pipeline engineering notes

How the committed model artifacts (`src/shared/forecast/weights.json`,
`src/shared/forecast/eval-report.json`, `src/shared/forecast/bake-off.json`)
are produced, what the dataset schema means, what every reported metric
measures, and exactly how the Adaption Labs integration degrades when the API
refuses us. Design rationale lives in `docs/FORECAST-DESIGN.md`; frozen
contracts in `docs/FORECAST-CONTRACTS.md`; the round-by-round tuning log in
`scripts/forecast/GAUNTLET.md`.

**The shipped head is a 190-parameter logistic regression**, not the
241-parameter TinyMLP the design specified. It replaced the MLP after a
five-family bake-off (GLM with basis expansions, tuned MLP, GBDT, temporal CNN,
hybrid + engineered features) run on one fixed dataset with paired
session-clustered confidence intervals: no non-linear model beat the strongest
linear result by a margin 48 held-out sessions can resolve, and a plain
19-parameter logistic already beat the MLP on the headline metric. The CI gate
is now anchored to that logistic, and the MLP would fail it. Stage 3, Stage 4
and the bake-off table below are the record.

## Pipeline usage

```
npm run forecast:pipeline          # simulate → data → train → eval, fully offline
npm run forecast:simulate          # 240 sessions → data/forecast/raw-sessions.jsonl
npm run forecast:data              # streams → labeled dataset.jsonl + manifest.json
npm run forecast:data -- --adaption  # sponsor path; auto-fallback on any failure, exit 0
npm run forecast:train             # GLM lr18+pairwise (190 params) → weights.json
npm run forecast:eval              # held-out metrics + CI gate → eval-report.json
npm run forecast:eval -- --gate=off  # bypass the gate, stamped "enforced": false
```

Everything under `data/forecast/` is gitignored working data; only
`weights.json`, `eval-report.json` and `bake-off.json` are committed. The full
pipeline runs in about 4 min (budget: 10 min; the trainer is ~3 min of it —
`lr18` sweep, `lr18+pairwise` regularization path, and 3 cross-fit folds for
the operating point) and is deterministic under `--seed` (default 42):
rerunning `forecast:train`/`forecast:eval` on the same dataset reproduces both
artifacts byte-for-byte — wall-clock time enters only the dataset manifest's
`createdAt`, which the artifacts inherit.

Useful levers (see each script's `readConfig`): `--sessions`, `--weights
grinder=0.2,...`, `--hazard`, `--desk-hz`, `--desk-noise`, `--webcam-off`,
`--augment-fraction`, `--iters`, `--pos-weight-power`, `--val`.

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
P(drift ≤ 30 s) genuinely exceeds the 0.80 pre-arm threshold deep into an
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
t · features[18] (encoded, pre-normalization) · raw {18 human-unit values}
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
ring/extractor/labeler, `source: "augmented:local"`, train-only.

## Stage 3 — trainer (`scripts/forecast/train.ts`)

The shipped head is an L2-regularized multivariate **logistic regression** over
the 18 encoded features plus every pairwise product and square — 189 basis
terms, **190 trainable parameters** (189 coefficients + one intercept), fitted
with hand-rolled L-BFGS to convergence. It is a GLM: linear in its basis,
convex, one global optimum, no hidden layer, no backprop, no early stopping.

It replaced a 241-parameter TinyMLP 18→12→1 after the five-family bake-off in
`scripts/forecast/GAUNTLET.md` (round 8). The short version: nothing non-linear
beat the strongest linear-family result by a margin 48 held-out sessions can
resolve, and a plain 19-parameter logistic already beat the MLP on the headline
metric. See the bake-off table below.

The basis lives in the SHARED core (`FORECAST_TERMS` / `expandBasis` in
`src/shared/forecast/model.ts`) and the trainer imports it, so the 189 columns
cannot mean one thing at fit time and another at serve time — the same
guarantee `extractFeatures` gives the 18 features. `weights.json` carries
`basis: "lr18+pairwise"` and `basisSha`, an fnv1a32 of the canonical term
names, and `parseForecastWeights` refuses any file whose checksum disagrees:
reordering the term list fails closed instead of silently mapping coefficients
onto the wrong products.

Protocol (only `split:"train"` rows are ever read):

- **val = 10 % of train SESSIONS** (seeded — the identical split the old MLP
  trainer used), for hyper-parameter selection, Platt calibration and the
  operating point. Never a gradient update.
- **Selection metric = train-internal val lead-censored (≥ 20 s) ROC-AUC** —
  the same metric eval.ts gates on, computed on rows eval.ts never sees.
- **Sweeps.** Class-weight power over {0, 0.5, 1} on the cheap plain-18
  variant, then held fixed; L2 λ over a warm-started path {1 … 1e-6} on both.
  Shipped pick: λ 1e-5, `w_pos = (Σw_neg/Σw_pos)^1`, val lead≥20s **0.9586**.
- **Sample weights** = 1/keep-probability (undoing the builder's train-only
  calm-negative downsampling) × the class weight, so the fit and the Platt
  calibration both target *natural* prevalence rather than the rebalanced file.
- **Platt** `σ(a·z + b)` on val logits only, fitted by the robust Newton of
  Lin–Weng–Keerthi (smoothed targets + backtracking line search). The plain
  Newton iteration is not safe here: on a near-separable calibration slice the
  curvature underflows and one overshooting step pins `a` at ~1e7 — a
  step-function "calibrator" that silently wrecks every threshold downstream.
- **The standardizer is folded in.** The fit standardizes the 189-column
  design; the artifact ships `c_j = θ_j/s_j` and `intercept = b − Σ θ_j·m_j/s_j`
  so runtime inference is one flat dot product and the payload really is 190
  floats plus the Platt pair. `norm.mean` still ships as the occlusion baseline
  the UI attributions use.
- **Gradient check** — finite difference against the analytic gradient of the
  REAL objective closure (`logisticObjective` in `scripts/forecast/linear.ts`,
  the one `fitLogisticL2` optimizes), rel err < 1e-4, before every run.
- The 19-parameter **plain logistic** is fitted too and recorded in provenance:
  it is the "did you try logistic regression?" reference and the model eval.ts
  anchors its gate to.

The 20 strongest terms are written to provenance on BOTH scales:
`standardizedWeight` (comparable across terms — this is the scale the model
reads as sentences: `deskConfMean30*deskConfStd30` −7.42, `deskPresent30*
deskConfStd30` +5.14, `sinceBlock*deskConfMean30` +4.23) and
`shippedCoefficient` (the folded raw-basis number actually in `weights.json`,
which is the standardized one divided by that column's std and therefore not
comparable term to term).

`weights.json` must round-trip `parseForecastWeights` (the runtime's
fail-closed parser) or train.ts refuses to write it. `trainProvenanceSha` is
the sha-256 of the canonical-JSON provenance object (dataset manifest +
training config/outcome + the operating-point search grid) written to
`data/forecast/provenance.json`.

### The operating point is trained, not guessed

`thresholds` are copied from the `DEFAULT_SETTINGS` forecast keys (parity), but
the trainer also **re-derives what those keys should be** and warns loudly when
they disagree — so the shipped default is a measured choice with a paper trail,
not a design guess that nobody revisited.

The search maximises recall@30 s (any `forecast_nudge`/`forecast_prearm` inside
`(onset − 30 s, onset]`, replayed through the SHIPPED `stepEscalation` reducer)
subject to three ceilings (`scripts/forecast/lib.ts`):

| ceiling | value | why |
|---|---|---|
| `research_churn` frame FPR | ≤ 0.01 | the anti-if-else archetype must not fire |
| alarm load | ≤ 1.15× the rate the SAME model produces at the pre-bake-off 0.55 threshold on the SAME sessions | recall cannot be bought with volume; a RATIO, so the cross-fit's own risk scale cancels; anchored to a FROZEN 0.55 so re-runs cannot ratchet the threshold down against their own previous answer |
| false pre-arms/hour | ≤ 2 | the design's stated budget (FORECAST-DESIGN §4.5) |

It runs on **3-fold cross-fitted TRAIN sessions**: 192 sessions, 242 drift
onsets, 98 h, each session scored by a fold model that never saw it (refitted
at the selected λ and class weight, read on the shipped Platt scale so the
threshold is a cut on one scale). The 24-session val slice alone carries barely
20 replayable onsets and cannot separate 0.40 from 0.55 — picking a threshold
there is a coin flip, and the first attempt at it selected 0.35, which
overshoots the alarm budget on held-out data. No eval row is opened; no fold
model ships.

Result: **nudge 0.45** (up from the frozen 0.55), pre-arm unchanged at 0.80.
`DEFAULT_SETTINGS.forecastNudgeRisk` and `weights.thresholds` moved together,
so eval.ts's parity assertion still holds. On the held-out split that is
recall@30 s **0.8333 (65/78)** against 0.7564 at 0.55 — **+6 drifts** for
+0.47 nudges/h, with `research_churn` FPR still 0.

## Stage 4 — evaluator (`scripts/forecast/eval.ts`)

Scores ONLY `split:"eval"` sessions (never seen by train.ts, natural
prevalence; `augmented:*` rows are refused in eval by assertion). Metrics in
the committed report:

- **rocAuc / prAuc / baseRate** — frame-level ranking over all eval frames;
  PR-AUC is reported beside the base rate because 2.7 % prevalence makes
  PR-AUC the harsher number.
- **aucLead20 (the headline) / aucLead10** — lead-censored ROC-AUC: only
  frames whose nearest onset is ≥ 20 s away (positives are therefore 20–30 s
  before onset) vs calm frames. High values structurally prove the model
  sees drifts *coming*; last-second detection scores ~0.5 here.
- **ece + reliability** — 10-bin expected calibration error; the reliability
  table lets you check that "0.83" means 83 %.
- **operatingPoints** — frame precision/recall/FPR at the shipped nudge
  (0.45) and pre-arm (0.80) thresholds.
- **alarms** — deployment-faithful simulation: held-out raw sessions replayed
  through the SHIPPED `stepEscalation` reducer (EMA smoothing, sustain ticks,
  cooldown, hysteresis) at the SHIPPED default settings, under BOTH hit rules:
  `recallAt30` (strict: a pre-arm was active at onset or fired in the prior
  30 s — the fuse was actually shortened) and `recallAt30Nudge` (any
  nudge-or-higher alarm in the prior 30 s — the rule the bake-off compared
  every contender on). False pre-arms are the reducer's stood-down clears with
  no drift within 30 s. The block also carries the trainer's operating-point
  search grid verbatim.
- **baselines** — base-rate, 3-rule if-else strawman, grey-dwell heuristic,
  per-feature logistics (all 18 listed), best single-feature logistic (chosen
  adversarially BY held-out lead-censored AUC), the full 18-feature logistic in
  TWO fits, and the shipped model.
- **bakeOff** — `src/shared/forecast/bake-off.json` embedded verbatim:
  every contender family, its score, its verdict, and the paired
  session-clustered bootstrap. NON-GATING, and published on purpose.
- **perArchetype** — frames, base rate, FPR at both thresholds, false
  pre-arms/hour, hits/drifts per archetype; `research_churn` is asserted to
  exist in eval and is the anti-if-else slice (shipped: FPR@nudge 0.0000).
- **ablation** — per-feature occlusion (feature → its training mean), as
  lead≥20s AUC drop; doubles as proof the UI attributions mean something.

Guards: `weights.thresholds` must equal the `DEFAULT_SETTINGS` forecast keys
(operating-point parity), and the provenance object embedded verbatim in the
report must hash to `weights.trainProvenanceSha`.

### The CI gate — raised

**Exit nonzero unless `aucLead20(shipped) ≥ aucLead20(full 18-feature
logistic)`.**

The old gate compared the model against the best SINGLE-feature logistic
(`otherDwell30`, 0.7734) and required +0.03. That was a strawman: the thing it
beat has one input, and the +0.1514 it printed was not evidence of anything. A
judge who asked "did you try logistic regression?" would have found that the
MLP shipping at the time scored **0.9248** against a full logistic's **0.9325**
— it lost, and the gate said PASS.

The baseline is now the strongest 18-feature multivariate logistic we can
produce: the historical class-weighted GD fit (`lib.trainLogistic`, 0.9325) and
an L-BFGS-to-convergence refit on ALL train rows, importance-weighted, at the λ
`train.ts` selected on its train-internal val split (0.9355) — whichever is
higher. The converged fit is deliberately given MORE data than the shipped
model (it sees the val sessions the shipped model held out), because the gate
should anchor to the best plain-18 logistic that exists, not a convenient one.

**Required margin: 0, and that is the honest number.** The paired
session-clustered bootstrap over these 48 sessions puts the SE of a
model-vs-model lead-AUC difference at ≈ 0.009; no contender in the bake-off,
including a 14 803-parameter temporal CNN, cleared the strongest linear result
by more than 0.7 of one SE. Demanding a positive margin would be demanding a
number this evaluation cannot measure. The meaningful bar is the one a hostile
question actually asks, so the gate fails the build the moment the answer to
"does the shipped head beat a logistic regression?" stops being yes.

Shipped margin: **+0.0068** (0.9423 vs 0.9355). The legacy bar is still
computed and printed as context (+0.1689 over `otherDwell30`), never as the
gate. `--gate=off` bypasses the exit code but stamps
`"gate": {"enforced": false}` into the committed report — the claim can be
skipped, never faked.

The gate has teeth, and that is verified rather than asserted: running the same
pipeline on a 30-session toy corpus (8 eval sessions, 5 drifts) makes the
pairwise expansion overfit to 0.9178 against the plain logistic's 0.9284, and
`forecast:eval` exits 1.

## Shipped numbers

Committed `src/shared/forecast/eval-report.json`, 85 230 held-out frames /
48 sessions / 2.75 % positive, seed 42:

| Metric | Shipped GLM (190p) | Previous MLP (241p) |
|---|---|---|
| **lead≥20s AUC (headline)** | **0.9423** | 0.9248 |
| lead≥10s AUC | 0.9583 | 0.9512 |
| ROC-AUC | 0.9659 | 0.9614 |
| PR-AUC (base 0.0275) | 0.6813 | **0.6938** |
| ECE (10-bin) | 0.0066 | **0.0053** |
| recall@30s, nudge rule | **0.8333** (65/78) | 0.7308 (57/78) |
| recall@30s, pre-arm rule | 0.5513 (43/78) | 0.5641 (44/78) |
| median / p25 pre-arm lead | 18 s / 12 s | 15 s / 11 s |
| nudges/h · false pre-arms/h | 3.43 · 0.59 | 3.19 · **0.35** |
| research_churn FPR @ nudge | **0.0000** | 0.0001 |
| gate margin vs full logistic | **+0.0068 PASS** | −0.0077 **FAIL** |

Where the swap costs us, stated out loud: PR-AUC 0.6813 vs 0.6938, ECE 0.0066
vs 0.0053, false pre-arms 0.59/h vs 0.35/h (still far under the < 2/h budget).
Pre-arm recall is 0.5513 vs 0.5641 — statistically identical, and **this swap
does not fix the pre-arm problem**; no contender did.

Per family (nudge-rule hits/drifts): away_drifter 30 drifts, burst_switcher 24,
wanderer 22, steady_then_snap 2 (unforecastable by construction), grinder and
research_churn 0 drifts. Wanderer remains the weak family. The strict pre-arm
rule catches 14/30 away, 18/24 burst, 11/22 wanderer, 0/2 snap.

## The bake-off — every family we tried

Committed verbatim in `src/shared/forecast/bake-off.json` and embedded in
`eval-report.json` as a NON-GATING artifact. Five model families, one fixed
dataset, one fixed metric, one shared reducer; scores re-derived from scratch
by `scripts/forecast/adjudicate.ts`, uncertainty from a paired
session-clustered bootstrap (2 000 draws over the 48 eval sessions, identical
resamples across models).

| model | family | params | lead≥20s | ROC | PR | ECE | recall@30s* | verdict |
|---|---|---|---|---|---|---|---|---|
| **lr18+pairwise** | GLM + pairwise basis | **190** | 0.9423 | 0.9659 | 0.6813 | 0.0067 | 0.7564 | **SHIPPED** |
| temporal (3-net) | causal 1-D CNN on the raw 1 Hz stream | 14 803 | **0.9487** | 0.9705 | **0.7523** | 0.0031 | **0.8333** | runner-up |
| mlp-tuned | tuned + bagged MLP | 721 | 0.9462 | 0.9685 | 0.7227 | 0.0059 | 0.7179 | no |
| hybrid | GLM trunk + residual, 25 features | 888 | 0.9458 | **0.9730** | 0.7434 | 0.0046 | 0.7308 | no |
| trees | 147-tree GBDT | 3 811 nodes | 0.9436 | 0.9710 | 0.7026 | **0.0020** | 0.6923 | no |
| TinyMLP 18→12→1 | the incumbent | 241 | 0.9248 | 0.9614 | 0.6938 | 0.0053 | 0.7308 | replaced |
| *full LR18 (converged)* | *plain logistic, 18 inputs* | *19* | *0.9355* | *0.9577* | *0.5337* | — | — | *gate baseline* |
| *best single-feature LR* | *`otherDwell30`* | *2* | *0.7734* | *0.7768* | — | — | — | *old gate baseline* |

\* recall@30s here is the bake-off's common rule at the then-frozen 0.55/0.80
operating point, so all six rows are comparable. The shipped model runs at 0.45
and scores 0.8333 there.

**Why the 190-parameter linear model won.** Against the shipped basis, every
non-linear contender's margin dies inside its own confidence interval:
trees +0.0013 [−0.0169, +0.0207] p 0.45; hybrid +0.0035 [−0.0166, +0.0274]
p 0.41; mlp-tuned +0.0038 [−0.0227, +0.0299] p 0.38; temporal +0.0064
[−0.0097, +0.0256] p 0.24. Not one clears it. Recall does not separate them
either — at an identical alarm load of 3.31 nudges/h, lr-ceiling catches 64/78
and temporal 65/78; one drift, against a ±0.09 interval. ECE spans
0.0020–0.0067, an order of magnitude inside anything the design treats as a
budget. So the decision falls to cost, and there the gap is not close: 190
convex parameters and ~4 KB against 721, 888, 3 811 nodes + 231 KB, and 14 803
+ 306 KB + 330 µs/tick.

**The finding worth reporting.** Non-linearity IS real relative to a plain
additive GLM — mlp-tuned's +0.0113 over a converged plain logistic is the one
statistically resolved non-linear gain in the field (CI [+0.0021, +0.0210]).
But the identical +0.0075 is bought by staying linear and writing the feature
conjunctions down: the MLP's hidden layer was learning what 171 named product
terms express directly. Ship the interactions; skip the hidden layer.

**The open question we did not close.** temporal's PURE-sequence net sees zero
hand-engineered features and still scores 0.9340 lead≥20s — above the incumbent
MLP's 0.9248. The raw 1 Hz stream carries signal the 18 window aggregates
destroy. Settling that needs a real recorded corpus, not another architecture.

**What would settle the rest.** The paired SE here is ≈ 0.009 and every margin
on offer is 0.4–0.7 of one SE. Resolving a +0.006 gap would take roughly 7–8×
the held-out sessions (~360 sessions, ~590 drifts). If the team ever records
that corpus, re-run this exact bake-off.

**The highest-value follow-up is features, not architecture.** hybrid's
ablation ladder is the cleanest evidence in the whole contest: the same
`lib.trainLogistic` routine goes 0.9325 → 0.9408 (+0.0083) purely from 7 extras
read off the existing `TelemetryRing` public API, while its architecture alone
scored 0.9313 — *below* the plain logistic. Three of the seven do all the work
by occlusion: `deskSagSlope30` +0.0270, `dwellShrink30v90` +0.0092,
`titleChurnAccel` +0.0054. Adding those three to `extractFeatures` is a handful
of lines, no new telemetry, and it moves the metric more than any hidden layer
did.

**The ceiling nobody can tune past.** The maximum reachable smoothed risk in
the 30 s before an onset caps threshold-only recall at 0.859 for both the
hybrid and the incumbent, so ~14 % of onsets are a genuine ceiling rather than
a tuning failure: `steady_then_snap` by construction, plus a low-risk wanderer
tail.

## Adaption Labs integration + provenance honesty

`scripts/forecast/adaption.ts` (base
`https://api.prod.adaptionlabs.ai/api/v1`, key from `ADAPTION_API_KEY` then
`API_KEY`): `POST /datasets` (column_mapping {prompt, completion}) →
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

That block is today's real state (live 403 from the sponsor API, recorded on
2026-09-12) and is exactly what the committed `eval-report.json` carries: the
shipped numbers are trained on simulated + locally augmented sessions, and
say so. The moment the key works, the same `--adaption` flag flips the
pipeline to the sponsor path with no other change.
