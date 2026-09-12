# Focus Forecast — training pipeline engineering notes

How the committed model artifacts (`src/shared/forecast/weights.json`,
`src/shared/forecast/eval-report.json`) are produced, what the dataset schema
means, what every reported metric measures, and exactly how the Adaption Labs
integration degrades when the API refuses us. Design rationale lives in
`docs/FORECAST-DESIGN.md`; frozen contracts in `docs/FORECAST-CONTRACTS.md`;
the round-by-round tuning log in `scripts/forecast/GAUNTLET.md`.

## Pipeline usage

```
npm run forecast:pipeline          # simulate → data → train → eval, fully offline
npm run forecast:simulate          # 240 sessions → data/forecast/raw-sessions.jsonl
npm run forecast:data              # streams → labeled dataset.jsonl + manifest.json
npm run forecast:data -- --adaption  # sponsor path; auto-fallback on any failure, exit 0
npm run forecast:train             # TinyMLP 18→12→1 → src/shared/forecast/weights.json
npm run forecast:eval              # held-out metrics + CI gate → eval-report.json
npm run forecast:eval -- --gate=off  # bypass the gate, stamped "enforced": false
```

Everything under `data/forecast/` is gitignored working data; only
`weights.json` and `eval-report.json` are committed. The full pipeline runs in
about 35 s (budget: 10 min) and is deterministic under `--seed` (default 42):
rerunning `forecast:train`/`forecast:eval` on the same dataset reproduces both
artifacts byte-for-byte — wall-clock time enters only the dataset manifest's
`createdAt`, which the artifacts inherit.

Useful levers (see each script's `readConfig`): `--sessions`, `--weights
grinder=0.2,...`, `--hazard`, `--desk-hz`, `--desk-noise`, `--webcam-off`,
`--augment-fraction`, `--epochs`, `--lr`, `--patience`,
`--pos-weight-power`, `--val`.

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

Hand-rolled TinyMLP 18→12→1 (tanh hidden, 241 trainable params) + Adam
(lr 3e-3, batch 256, L2 1e-4), float64 in training, 8 significant digits in
the shipped JSON. Only `split:"train"` rows are read. Val = 10 % of train
*sessions* (seeded), used for early stopping (importance-weighted BCE,
patience 40) and Platt calibration only. z-score normalization is fit on the
fit subset only and shipped in `weights.json`. Class weighting
`w_pos = (n_neg/n_pos)^0.5` by default (`--pos-weight-power 1` restores the
raw ratio; see GAUNTLET.md round 7 for why it is tempered). A
finite-difference gradient check on a toy 4→3→1 net (rel err < 1e-4, same
forward/backward code) runs before every training run.

Platt scaling `σ(a·z + b)` is fit on val logits with importance weights
(1/keep-probability) so the calibrated risk targets *natural* prevalence, not
the rebalanced file. The shipped `weights.json` must round-trip
`parseForecastWeights` (the runtime's fail-closed parser) or train.ts refuses
to write it. `thresholds` are copied from the `DEFAULT_SETTINGS` forecast
keys; `trainProvenanceSha` is the sha-256 of the canonical-JSON provenance
object (dataset manifest + training config/outcome) written to
`data/forecast/provenance.json`.

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
  (0.55) and pre-arm (0.80) thresholds.
- **alarms** — deployment-faithful simulation: held-out raw sessions replayed
  through the SHIPPED `stepEscalation` reducer (EMA smoothing, sustain ticks,
  cooldown, hysteresis) at the SHIPPED default settings. A drift counts as
  hit if a pre-arm was active at onset (the reducer's own `forecast_hit`
  receipt, which carries the lead) or fired within the prior 30 s; false
  pre-arms are the reducer's stood-down clears with no drift within 30 s.
- **baselines** — base-rate, 3-rule if-else strawman, grey-dwell heuristic,
  per-feature logistics (all 18 listed), best single-feature logistic
  (chosen adversarially BY held-out lead-censored AUC), full 18-feature
  logistic, MLP.
- **perArchetype** — frames, base rate, FPR at both thresholds, false
  pre-arms/hour, hits/drifts per archetype; `research_churn` is asserted to
  exist in eval and is the anti-if-else slice (shipped: FPR@nudge 0.0001).
- **ablation** — per-feature occlusion (feature → its training mean), as
  lead≥20s AUC drop; doubles as proof the UI attributions mean something.

Guards: `weights.thresholds` must equal the `DEFAULT_SETTINGS` forecast keys
(operating-point parity), and the provenance object embedded verbatim in the
report must hash to `weights.trainProvenanceSha`.

**CI gate:** exit nonzero unless
`aucLead20(MLP) − aucLead20(best single-feature logistic) ≥ 0.03`.
`--gate=off` bypasses the exit code but stamps `"gate": {"enforced": false}`
into the committed report — the claim can be skipped, never faked. Shipped
margin: +0.1514 over `otherDwell30`.

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
