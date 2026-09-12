# Focus Forecast model — gauntlet log

**Bar (raised in round 8):** on held-out sessions the shipped forecast head
must beat the **full 18-feature multivariate logistic regression** on
**lead-censored ROC-AUC** (frames whose nearest drift onset is ≥ 20 s away vs
calm frames — prediction, not detection), with per-archetype slices published,
`research_churn` false-positive rates called out, ECE reported, and the alarm
simulation run through the SHIPPED escalation reducer at the SHIPPED default
thresholds (nudge 0.45 / pre-arm 0.80). `forecast:eval` exits nonzero when the
gate fails; `--gate=off` bypasses but stamps `"gate":{"enforced":false}`.

*The original bar was "beat the best SINGLE-feature logistic by ≥ 0.03". Round
8 retired it: it compared the model against something with one input, and the
TinyMLP that shipped through round 7 passed it by +0.1514 while LOSING to a
full logistic by −0.0077. Rounds 1–7 below are the record of the model that bar
produced; they are kept because the fix is only legible next to the mistake.*

Protocol note: between rounds, held-out diagnostics guided *simulator/loss*
design (which is why eval numbers are reported per round, misses and all).
Weight selection within a round only ever saw train/val — the eval split is
split per SESSION by seeded hash and never touched by train.ts. Every round
below is `--seed 42`, 240 sessions ≈ 536 k raw 1 Hz frames, pipeline < 40 s
end to end.

## Round 1 — first full pipeline

Semi-Markov simulator (6 archetypes), hazard λ(t) coupled to leaky switch-rate
/ grey-occupancy trackers (τ 45/60 s), fatigue multiplier `1 + t/2400`.

| Metric | Value |
| --- | --- |
| ROC-AUC / lead≥20s | 0.9251 / 0.8779 |
| best single feature (lead≥20s) | **streak 0.7815** → margin **+0.096** — PASS |
| recall@30s / median lead / FA·h⁻¹ | **0.079** / 13 s / 0.12 |

Verdict: gate passes but the pre-arm is decorative — hazards were so diffuse
that the TRUE posterior P(drift ≤ 30 s) never approached the frozen 0.80
pre-arm line, so an honestly calibrated model (ECE 0.007) could not cross it.
Also flagged in the smoke round: `sessionMin` nearly won as a single feature —
the fatigue multiplier was handing the baseline the game; softened to
`1 + 0.15·(t/1800)`.

## Round 2 — hot episodes (faster trackers, τ 30)

λ raised so a deep loiter/ramp genuinely carries P(drift ≤ 30 s) > 0.8.

Recall@30s 0.51, but lead≥20s AUC fell to **0.7656** — drifts now fired
*early* in episodes, before the precursor had entered the 15–60 s feature
windows, and the lead-censored positives looked calm.

## Round 3 — age-gated hazards

λ = 0 for the first ~30 s of an episode, then steep (gate ramp 15–20 s); 25 %
of loiters "half-hearted" (hard negatives); deeper desk sag (μ → 0.45).
ROC 0.929 / lead≥20s 0.880 / recall 0.53 / FA·h⁻¹ 0.55. Per family:
away 79 %, burst 33→71 % across two sub-rounds, wanderer stuck ~30 %.

## Rounds 4–6 — the wanderer fight

Diagnostics (max smoothed risk in the 30 s before each wanderer onset) showed
risk topping out at 0.70–0.79: the true posterior was riding the 0.80
threshold, and three separate causes were fixed one by one:

1. mid-loiter "peeks" at allow apps lasted ~90 s, so most fires happened with
   a stale grey signature → loiter peeks shortened to ~8 s, out-of-grey fires
   removed entirely (a wanderer tab-outs *from* Spotify);
2. silent phase-endings (loiter evaporating mid-depth) discounted the
   posterior below 0.8 → deep loiters now run 120–200 s, long enough that the
   hazard ends them; survivors come from half-hearted/young loiters;
3. dwell-shrink + title-churn crescendo added with loiter age, so imminence
   is *observable* instead of requiring the model to integrate saturated
   window features.

## Round 7 — tempered class weighting (shipped through round 7)

`w_pos = (n_neg/n_pos)^0.5` (flag `--pos-weight-power`, default 0.5; 1.0
restores the raw design ratio). The raw ~13× weight distorted pre-Platt
logits differently per drift family, and the global 2-parameter Platt fit
could not undo it at the 0.80 line; tempering stabilized the operating point.
Early stop is on importance-weighted val BCE (val = 10 % of train sessions);
Platt (a, b) fit on val with importance weights 1/keep-probability so
calibration targets natural prevalence, not the downsampled file.

**Round-7 numbers** (the TinyMLP's last committed report,
85 230 held-out frames / 48 sessions / 2.75 % positive, seed 42):

| Metric | Value |
| --- | --- |
| ROC-AUC / PR-AUC (base 0.0275) | **0.9614** / 0.6938 |
| **lead≥20s AUC (headline)** / lead≥10s | **0.9248** / 0.9512 |
| ECE (10-bin) | **0.0053** |
| best single-feature logistic (lead≥20s) | otherDwell30, 0.7734 |
| **gate margin** (needs ≥ 0.03) | **+0.1514** — PASS |
| full 18-feature logistic (lead≥20s) | 0.9325 (the MLP wins overall AUC 0.9614 vs 0.9580) |
| alarm sim recall@30s / median / p25 lead | 0.564 / 15 s / 11 s |
| false pre-arms/hour / nudges/hour | 0.35 / 3.19 |
| research_churn FPR @ nudge / @ pre-arm | **0.0001 / 0** |
| per family (hits/drifts) | away 23/30 · burst 14/24 · wanderer 7/22 · snap 0/2 (by design) · grinder 0 drifts · churn 0 drifts |

Honest reading at the time: the ranking metrics clear the design targets
(0.90+/0.85+), false alarms are far under the < 2/h budget, and the anti-if-else
slice is clean. The pre-arm recall (56 %) is below the design's ~85 %
aspiration — the price of a genuinely calibrated risk against a frozen 0.80
threshold in a stochastic world: `steady_then_snap` is unforecastable by
construction, and wanderer loiters sit near the threshold.

**What that reading missed, and round 8 caught:** the line
"full 18-feature logistic (lead≥20s) 0.9325" in the table above is the MLP
LOSING to a linear model, printed one row under a gate that says PASS. Nobody
had made it the gate, so nobody had to act on it.

## Round 8 — the bake-off: five families, one dataset (SHIPPED)

The round-7 gate was a strawman and round 8 exists because of it. Five model
families were built as independent contenders in `scripts/forecast/candidates/`
against the FROZEN `dataset.jsonl` (218 732 rows / 288 sessions, per-session
split untouched), the FROZEN lead-censored metric, and the SHIPPED escalation
reducer. Scores were then re-derived from scratch by
`scripts/forecast/adjudicate.ts`, whose weighted rank-sum estimator is asserted
equal to `lib.rocAuc` at unit weights to < 1e-12 for every model, with a
**paired session-clustered bootstrap** (2 000 draws over the 48 held-out
sessions, identical resamples across models).

| model | family | params | lead≥20s | ROC | PR | ECE | recall@30s\* | verdict |
|---|---|---|---|---|---|---|---|---|
| **lr18+pairwise** | GLM + pairwise basis | **190** | 0.9423 | 0.9659 | 0.6813 | 0.0067 | 0.7564 | **SHIPPED** |
| temporal (3-net) | causal 1-D CNN on the raw 1 Hz stream | 14 803 | **0.9487** | 0.9705 | **0.7523** | 0.0031 | **0.8333** | runner-up |
| mlp-tuned | tuned + bagged MLP (18-36-1) | 721 | 0.9462 | 0.9685 | 0.7227 | 0.0059 | 0.7179 | no |
| hybrid | GLM trunk + tanh residual, 25 features | 888 | 0.9458 | **0.9730** | 0.7434 | 0.0046 | 0.7308 | no |
| trees | 147-tree depth-4 GBDT | 3 811 nodes | 0.9436 | 0.9710 | 0.7026 | **0.0020** | 0.6923 | no |
| TinyMLP 18→12→1 | the round-7 incumbent | 241 | 0.9248 | 0.9614 | 0.6938 | 0.0053 | 0.7308 | replaced |
| *full LR18 (converged)* | *plain logistic, 18 inputs* | *19* | *0.9355* | *0.9577* | *0.5337* | — | — | *new gate baseline* |
| *full LR18 (eval.ts GD fit)* | *the historical baseline* | *19* | *0.9325* | *0.9580* | *0.5596* | — | — | — |
| *best single-feature LR* | *`otherDwell30`* | *2* | *0.7734* | *0.7768* | — | — | — | *old gate baseline* |

\* the bake-off's common rule (any nudge-or-higher alarm inside
(onset − 30 s, onset]) at the then-frozen 0.55/0.80 point, so all rows compare.

**Priority 1 — headline metric.** Against the shipped basis, every non-linear
margin dies inside its own interval:

| contender | Δ lead≥20s | 95 % CI | p(Δ ≤ 0) |
|---|---|---|---|
| trees | +0.0013 | [−0.0169, +0.0207] | 0.452 |
| hybrid | +0.0035 | [−0.0166, +0.0274] | 0.405 |
| mlp-tuned | +0.0038 | [−0.0227, +0.0299] | 0.375 |
| temporal | +0.0064 | [−0.0097, +0.0256] | 0.243 |

Not one clears it. The paired SE on these differences is ≈ 0.009 — every margin
on offer is 0.4–0.7 of one SE. Resolving a +0.006 gap would need roughly 7–8×
the held-out sessions (~360 sessions, ~590 drifts).

**Priority 2 — recall.** At an IDENTICAL alarm load of 3.31 nudges/h,
lr18+pairwise catches 64/78 and temporal 65/78. One drift, against a ±0.09
interval on 78 clustered onsets. Does not separate them.

**Priority 3 — calibration.** ECE spans 0.0020–0.0067; the incumbent at 0.0053
was already declared fine. Discriminates nothing.

**Priority 4 — cost, and it is decisive.** 190 params / ~4 KB / ~360
multiply-adds against 721, 888, 3 811 nodes + 231 KB, and 14 803 params +
306 KB + 330 µs/tick. A convex GLM with a unique global optimum, whose top
weights read as sentences — `deskConfMean30*deskConfStd30 −7.42`: *confidence
wobble matters only while the desk model is confident you are there* — ties a
14 803-parameter conv ensemble on the headline metric.

**The honesty clause fires: no non-linear model beats the strongest
linear-family result by a margin this eval set can resolve, so the linear model
ships.**

### What the bake-off actually taught us

- **Non-linearity is real, but the hidden layer is not the way to buy it.**
  mlp-tuned's +0.0113 over a converged plain logistic is the one statistically
  resolved non-linear gain in the field (CI [+0.0021, +0.0210]) — and the
  identical +0.0075 is bought by staying linear and writing the conjunctions
  down as 171 named product terms. Ship the interactions; skip the hidden layer.
- **The old MLP was under-regularised, not too small.** L2 1e-4 → 3e-3 lifts CV
  lead-AUC 0.9220 → 0.9313; 24/32/48 hidden units and two-hidden-layer variants
  do not beat 12 once L2 is right. The shipped 10 %-of-train val split also
  leaked augmented copies of its own validation sessions; mlp-tuned's
  parent-session fold assignment fixes that.
- **The raw stream carries signal the aggregates destroy** — the open question.
  temporal's PURE-sequence net sees zero hand-engineered features and scores
  0.9340, above the incumbent's 0.9248. Unsettled; needs a real corpus.
- **Features beat architecture.** hybrid's ablation ladder: the same
  `lib.trainLogistic` routine goes 0.9325 → 0.9408 (+0.0083) purely from 7
  extras read off the existing `TelemetryRing` public API, while its
  architecture alone scored 0.9313 — *below* the plain logistic. Three extras
  do all the work by occlusion: `deskSagSlope30` +0.0270, `dwellShrink30v90`
  +0.0092, `titleChurnAccel` +0.0054. Highest-value follow-up in the file.
- **~14 % of onsets are a ceiling, not a tuning failure.** The max reachable
  smoothed risk in the 30 s before an onset caps threshold-only recall at 0.859
  for both hybrid and the incumbent: `steady_then_snap` by construction plus a
  low-risk wanderer tail.

### The gate, raised

`eval.ts` now anchors to the FULL 18-feature multivariate logistic (the
stronger of the GD fit and an L-BFGS-converged refit on all train rows), with a
required margin of **0** — because the paired SE is ≈ 0.009 and any positive
margin we could demand would be unmeasurable here. The bar is "must not be
beaten by a logistic regression a judge could write in an afternoon", and it
fails the build the moment it is. The old best-single-feature number is still
printed as context.

Note what raising it means: **the round-7 TinyMLP FAILS the honest gate**
(0.9248 − 0.9325 = −0.0077). The gate is not decorative — running this exact
pipeline on a 30-session toy corpus makes the pairwise expansion overfit
(0.9178 vs the plain logistic's 0.9284) and `forecast:eval` exits 1.

### The operating point, re-selected

`train.ts` now derives the nudge threshold instead of inheriting it: maximise
recall@30 s through the SHIPPED reducer subject to `research_churn` FPR ≤ 0.01,
false pre-arms ≤ 2/h, and an alarm load ≤ 1.15× what the same model costs at
the pre-bake-off 0.55 threshold on the same sessions. The search runs on
**3-fold cross-fitted TRAIN sessions** (192 sessions, 242 onsets, 98 h, each
session scored by a fold model that never saw it); the eval split is not
opened, and the trainer WARNs when `DEFAULT_SETTINGS` disagrees with its pick.

Two attempts were needed and both are in the record. Searching the 24-session
val slice alone (17 replayable, 23 onsets) selected **0.35**, whose load
overshoots the budget on held-out data — a coin flip dressed as a decision.
Cross-fitting fixed the sample size; a per-fold Platt then had to be dropped
(fold slopes ranged 0.49–0.75, making the pooled curve a mixture of three
scales) and the absolute rate ceiling had to become a RATIO against a FROZEN
0.55 anchor, so the scale cancels and re-runs cannot ratchet the threshold down
against their own previous answer. Selected: **nudge 0.55 → 0.45**, pre-arm
unchanged. `DEFAULT_SETTINGS` and `weights.thresholds` moved together, so the
parity assertion still holds.

### Shipped numbers (committed `src/shared/forecast/eval-report.json`)

85 230 held-out frames / 48 sessions / 2.75 % positive / 78 drift onsets /
25.39 h, seed 42:

| Metric | Shipped GLM (190p) | Round-7 MLP (241p) |
| --- | --- | --- |
| **lead≥20s AUC (headline)** | **0.9423** | 0.9248 |
| lead≥10s AUC | 0.9583 | 0.9512 |
| ROC-AUC / PR-AUC (base 0.0275) | **0.9659** / 0.6813 | 0.9614 / **0.6938** |
| ECE (10-bin) | 0.0066 | **0.0053** |
| gate baseline: full 18-feature logistic | 0.9355 | 0.9325 |
| **gate margin** (needs ≥ 0) | **+0.0068 — PASS** | −0.0077 — **FAIL** |
| context: best single-feature logistic | otherDwell30 0.7734 (+0.1689) | 0.7734 (+0.1514) |
| recall@30s — nudge rule | **0.8333** (65/78) | 0.7308 (57/78) |
| recall@30s — pre-arm rule | 0.5513 (43/78) | 0.5641 (44/78) |
| median / p25 pre-arm lead | 18 s / 12 s | 15 s / 11 s |
| nudges/h · false pre-arms/h | 3.43 · 0.59 | 3.19 · **0.35** |
| research_churn FPR @ nudge / @ pre-arm | **0.0000 / 0.0000** | 0.0001 / 0 |
| per family (pre-arm hits/drifts) | away 14/30 · burst 18/24 · wanderer 11/22 · snap 0/2 | away 23/30 · burst 14/24 · wanderer 7/22 · snap 0/2 |

Honest reading: the swap buys +0.0175 on the headline metric, +6 drifts of
nudge-rule recall, a clean anti-if-else slice and 51 fewer parameters in a
convex model with readable coefficients. It costs PR-AUC (0.6813 vs 0.6938),
ECE (0.0066 vs 0.0053) and false pre-arms (0.59/h vs 0.35/h, still far under
the < 2/h budget). **Pre-arm recall is unchanged within noise (0.5513 vs
0.5641) — this swap does not fix the pre-arm problem, and no contender did.**
Wanderer is still the weak family. Nothing here was tuned on eval sessions.

## Adaption Labs round (live, 2026-09-12)

`npm run forecast:data -- --adaption` against
`https://api.prod.adaptionlabs.ai/api/v1` with the session `API_KEY`:

```
WARN adaption unavailable (POST /datasets HTTP 403: {"statusCode":403,
"error":"Forbidden","message":"Invalid token. Please sign in"}, HTTP 403)
— falling back to local augmentation
```

Exit code 0; the committed provenance records
`{"mode":"offline-fallback","adaption":{"attempted":true,"httpStatus":403,
"datasetId":null,...}}` verbatim. The moment the key works, the same flag
uploads the train-split seed (`data/forecast/adaption-seed.jsonl`,
prompt/completion columns), augments, downloads, and re-gates every row
locally — Adaption rows are capped at 25 % of train and can never enter eval.

## Determinism check

Same seed, same dataset → `forecast:train` and `forecast:eval` reruns produce
byte-identical `weights.json`, `eval-report.json` and `provenance.json`
(verified by sha-256 across two full back-to-back runs). Wall clock enters only
the dataset manifest's `createdAt`, which the artifacts inherit, so the
committed pair is internally consistent (`trainProvenanceSha` asserted by
eval.ts). The GLM is convex and L-BFGS is deterministic, so this no longer
depends on shuffle order or an early-stopping epoch — only on libm agreeing
with itself.
