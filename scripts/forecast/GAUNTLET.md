# Focus Forecast model — gauntlet log

**Bar (raised in round 8):** on held-out sessions the shipped forecast head
must beat the **full multivariate logistic regression on the same feature
basis** on **lead-censored ROC-AUC** (frames whose nearest drift onset is ≥ 20 s away vs
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

## Round 9 — the trend block: features, not architecture (SHIPPED)

Round 8's own conclusion was that the highest-value follow-up was **features**:
the `hybrid` contender's ablation ladder moved a plain logistic
0.9325 → 0.9408 using only extras read off the existing `TelemetryRing`, while
its architecture alone scored 0.9313 — *below* the plain logistic. This round
cashes that in. `FORECAST_FEATURE_KEYS` grows 18 → **24** and the shipped head
is refitted on the wider basis: `lr24+pairwise`, 324 terms, **325 parameters**.

**The gap being closed.** Every one of the original eighteen features is a
LEVEL over one fixed window — a count, a fraction, a mean, a σ. A window mean
is exactly the statistic that destroys a trend: a desk confidence sliding
0.90 → 0.50 across 30 s and one sitting flat at 0.70 have the same
`deskConfMean30`. The six new features are slopes, short-vs-long rate ratios, a
leaky occupancy, a run length and a two-window drop. **No new telemetry, no new
permission, no new IPC** — same 600-frame ring, same 128-transition list, same
session scalars, all through the same `extractFeatures` the trainer and the
runtime share.

### The protocol (train-split only, twice)

Thirteen candidates were proposed: the three round 8 named, three more of
hybrid's seven, and seven new ones. Selection never opened the eval split or
`data/forecast/holdout/`.

- **inner-val = 20 % of the SYNTHETIC train sessions** (38 sessions, 20 077
  rows, 19 260 lead-eligible frames, 473 lead-eligible positives), seeded.
  Every `augmented:local` session is forced inner-FIT — a jittered twin sitting
  opposite its parent would leak the answer.
- **Pass 1, `feature-mine.ts`** — backward elimination on an ADDITIVE L2
  logistic, keep while dropping costs ≥ 0.0005 inner-val lead≥20s AUC. Additive
  on purpose: over a `d(d+1)/2` basis a feature can earn its keep through 30
  interaction terms fitted on the rows that judge it, which is the classic way
  to select noise. A feature that cannot pay for one column does not get 25.
- **Pass 2, `feature-confirm.ts`** — the survivors *and* the borderline rejects
  re-fitted on the SHIPPED pairwise basis, same split, same metric. A feature
  can be worthless additively and valuable in a product; that has to be asked
  on the basis that actually ships.

Both passes reproduce with `npm run forecast:features` /
`npm run forecast:features:confirm`. The seven retired candidates still live in
`scripts/forecast/trend-candidates.ts` — deleting them would make the rejection
table unreproducible.

### Pass 1 — additive ladder (inner-val lead≥20s, 1 000-draw paired bootstrap)

| feature set | d | AUC | Δ vs base-18 | 95 % CI | p(Δ≤0) |
| --- | --- | --- | --- | --- | --- |
| base-18 (the shipped level block) | 18 | 0.8821 | — | — | — |
| + the 3 round 8 nominated | 21 | 0.8952 | +0.0130 | [−0.0002, +0.0265] | 0.027 |
| + the 5 the audit kept | 23 | **0.9012** | **+0.0190** | **[+0.0056, +0.0320]** | **0.004** |
| + all 13 candidates | 31 | 0.8963 | +0.0141 | [−0.0046, +0.0401] | 0.090 |

**This is the first resolved margin in the whole gauntlet.** Every model-family
margin in round 8 died inside its own interval; +0.0190 with a CI that excludes
zero does not. Note also that all-13 scores *below* kept-5: the eight rejects
are not free, they are negative.

Per kept feature, additive (leave-one-out refit vs occlusion — the two answer
different questions and are printed side by side):

| feature | LOO refit drop | occlusion drop |
| --- | --- | --- |
| `deskSagSlope30` | +0.0102 | +0.0158 |
| `deskConfDrop120` | +0.0044 | +0.0025 |
| `absenceRun60` | +0.0030 | +0.0014 |
| `dwellShrink30v90` | +0.0011 | −0.0002 |
| `greyLeaky120` | +0.0009 | +0.0059 |

### Pass 2 — the same question on the SHIPPED pairwise basis

| feature set | d | terms | AUC | Δ vs base-18 |
| --- | --- | --- | --- | --- |
| base-18 | 18 | 189 | 0.8866 | — |
| the 3 round 8 nominated | 21 | 252 | 0.8994 | +0.0129 |
| the 5 the additive audit kept | 23 | 299 | 0.8941 | +0.0076 |
| **their union — 6, SHIPPED** | **24** | **324** | **0.9039** | **+0.0173** [−0.0032, +0.0367] p 0.037 |
| all 13 | 31 | 527 | 0.9049 | +0.0183 [−0.0024, +0.0401] p 0.044 |

The two passes disagree, and the disagreement is the finding:
**`titleChurnAccel` pays nothing additively (−0.0001 added back to the kept
set) and +0.0097 on the pairwise basis** — it is worth a column only because
the basis multiplies it by everything else. That is round 8's "ship the
interactions, skip the hidden layer" conclusion showing up one level down, in
feature selection. The union of the two passes is what ships; all-13 buys
+0.0011 more for 203 extra terms, which is not a trade.

Cost of dropping each shipped feature from the union, on the pairwise basis
(`npm run forecast:features:confirm` with `--out feature-confirm-loo.json` and
one `u6-<key>=` set per feature — the six leave-one-out sets):

| feature | Δ if dropped |
| --- | --- |
| `titleChurnAccel` | +0.0097 |
| `dwellShrink30v90` | +0.0051 |
| `absenceRun60` | +0.0037 |
| `deskSagSlope30` | +0.0026 |
| `greyLeaky120` | +0.0026 |
| `deskConfDrop120` | −0.0001 |

`deskConfDrop120` is the marginal one and is kept on the additive audit's
verdict (+0.0044 LOO): −0.0001 is not a cost, and dropping columns on
inner-val deltas that small is the overfitting this protocol exists to avoid.

### The rejects (as publishable as the keeps)

What each would add to the kept set, additively, and its occlusion inside the
all-13 fit:

| rejected | adds to kept set | occlusion in all-13 | why it was proposed |
| --- | --- | --- | --- |
| `otherFrac180` | +0.0004 | +0.0028 | hybrid's loiter-depth window; `greyLeaky120` carries depth more smoothly |
| `greyRun` | +0.0002 | +0.0014 | age of the current off-list run; same information, harder edge |
| `newApps30` | +0.0001 | +0.0018 | novel-app count: exploration vs cycling |
| `repeatRatio60` | −0.00001 | +0.0093 | switches per distinct app; spanned by `distinct60` × `switch60` |
| `titleChurnAccel`\* | −0.0001 | +0.0001 | *rescued by pass 2 — see above* |
| `allowSlip30v150` | −0.0002 | +0.0058 | allowlisted-share collapse |
| `switchAccel60v180` | −0.0014 | +0.0183 | long-baseline switch accel; its 180 s window also truncates against the 128-entry transition ring |
| `sinceTitleFlip` | −0.0020 | −0.0025 | recency of the last tab flip; actively harmful |

Note how badly occlusion and refit disagree for `repeatRatio60`,
`allowSlip30v150` and `switchAccel60v180`: each looks important when you blank
it (the fit leans on it) and is worth nothing when you refit without it (the
other columns span it). **Occlusion ranks features inside a model; it does not
decide whether a feature deserves a column.** hybrid's ladder ranked its extras
by occlusion, which is why its ordering and this one differ.

### Shipped numbers — 48-session eval split, before → after

`auc_before` is the committed artifact at `40f93b7` (the commit that shipped
`lr18+pairwise`); `auc_after` is today's. Both heads scored on the SAME rows and
the SAME 2 000 resamples by `npm run forecast:features:abtest`, which reads the
baseline straight out of git and pins that ref so the comparison keeps meaning
something after this round is itself committed.

| Metric | before (lr18+pairwise, 190p) | after (lr24+pairwise, 325p) |
| --- | --- | --- |
| **lead≥20s AUC (headline)** | **0.9423** | **0.9389** |
| paired Δ (session-clustered) | — | **−0.0035, 95 % CI [−0.0288, +0.0159], SE 0.0117, p(Δ≤0) 0.59** |
| lead≥10s AUC | 0.9583 | 0.9558 |
| ROC-AUC / PR-AUC | 0.9659 / 0.6813 | 0.9631 / 0.6746 |
| ECE (10-bin) | 0.0066 | 0.0075 |
| **recall@30s — pre-arm rule** | 0.5513 (43/78) | **0.6282 (49/78)** |
| recall@30s — nudge rule | 0.8333 (65/78) | 0.8333 (65/78) |
| nudges/h · false pre-arms/h | 3.4264 · 0.5908 | 3.4264 · **0.5514** |
| median / p25 pre-arm lead | 18 s / 12 s | 16 s / 10 s |
| research_churn FPR @ nudge | 0.0000 | 0.0004 |
| gate baseline (full logistic, same basis) | 0.9355 | 0.9316 |
| gate margin (needs ≥ 0) | +0.0068 PASS | **+0.0073 PASS** |

**Read this honestly. The headline metric did not move.** −0.0035 is 0.3 of one
paired standard error on this split; the interval spans −0.029 to +0.016. The
48 sessions cannot tell these two heads apart, which is the same sentence round
8 had to write about a 14 803-parameter CNN. Nothing here is a claimed ranking
improvement.

**What did move is the pre-arm.** 43/78 → 49/78 onsets get a pre-arm, at an
identical nudge load (3.4264/h) and *fewer* false pre-arms (0.5514/h vs
0.5908/h), and it is concentrated exactly where the desk-trend features aim:

| family | drifts | pre-arm hits before | after |
| --- | --- | --- | --- |
| away_drifter | 30 | 14 | **23** |
| burst_switcher | 24 | 18 | 17 |
| wanderer | 22 | 11 | 9 |
| steady_then_snap | 2 | 0 | 0 |

`away_drifter` is the walk-away family, and its false pre-arms/h fell
1.357 → 0.339. docs/FORECAST.md has said since round 8 that "this swap does not
fix the pre-arm problem; no contender did" — the trend block moves it +6 drifts
for free, and moves it in the family whose precursor is a desk sag. Wanderer
remains the weak family, now by a wider margin. 78 onsets is a small
denominator; treat ±6 with the same suspicion as ±0.005 AUC.

Held-out per-feature occlusion (the shipped `eval.ts` ablation) puts two of the
new features in the top eight of twenty-four: `deskSagSlope30` +0.0585,
`greyLeaky120` +0.0414, `dwellShrink30v90` +0.0211, `titleChurnAccel` +0.0158,
`deskConfDrop120` +0.0055, `absenceRun60` +0.0004. The features carry signal on
held-out data; what 48 sessions cannot resolve is whether the *whole model*
ranks better with them.

**What would settle it.** The same thing round 8 asked for and the same thing
the power work built: the large hold-out corpus. `data/forecast/holdout/` was
generated against the 18-feature extractor and is stale as of this round —
`npm run forecast:power` regenerates and re-scores it, and the paired SE it
measures is the number that can decide a ±0.004 question this split cannot.

### Contract changes (additive)

`FORECAST_FEATURE_KEYS` 18 → 24, APPEND-ONLY so no existing index moves.
`FORECAST_INPUT_DIM`, `FORECAST_BASIS` (`lr18+pairwise` → `lr24+pairwise`),
`FORECAST_TERMS`, `FORECAST_TERM_COUNT` (189 → 324) and `FORECAST_PARAM_COUNT`
(190 → 325) are all DERIVED from that list now — the width is written down
once. `FORECAST_BASIS_SHA` moves with it, so the previous `weights.json` fails
`parseForecastWeights` closed rather than being served against a basis it was
never fitted on (`model.test.ts` covers exactly this). The dataset row's
`features` array, the `raw` map, the Adaption `prompt` short names, the golden
fixtures and the renderer's attribution strip all grow from the same list; the
internals panel renders `bars.length` bars and never a literal. `lib.RAW_BOUNDS`
now carries a `[min, max]` for every key and `rawInBounds` throws if the table
ever misses one, so a future feature cannot ship without a validation range for
untrusted Adaption rows.

The operating point was re-derived on 3-fold cross-fitted train sessions as
always and came back **unchanged at nudge 0.45 / pre-arm 0.80**, so the
`DEFAULT_SETTINGS` parity assertion still holds untouched.

**Cost.** 324 terms instead of 189 makes `forecast:train` ~5 min 10 s instead
of ~3 min (`forecast:data` 18 s, `forecast:eval` 13 s), so the full pipeline is
about 7 min against the 10-min budget. Inference is 324 multiply-adds a tick on
a 1 Hz loop and `weights.json` is ~7 KB — neither is measurable next to the
14 803-parameter / 306 KB / 330 µs-per-tick contender round 8 turned down.
Determinism is unchanged and re-verified: two back-to-back `forecast:train`
runs on the same dataset produce a byte-identical `weights.json`
(sha-256 `69541cb2…`), and two `forecast:eval` runs a byte-identical
`eval-report.json` (`42e14d3c…`).

## Adaption Labs round (live, 2026-09-12)

`npm run forecast:data -- --adaption` against
`https://api.prod.adaptionlabs.ai/api/v1` with no `ADAPTION_API_KEY` set:

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
