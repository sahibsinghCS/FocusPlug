# The drift dataset

One row is one **drift**: the instant FocusPlug started a countdown, plus what
the student did about it. This is the training signal behind the adaptive fuse —
and the reason that model needs no annotation. `cancel_countdown` means they
fixed it themselves; `kill` means they did not. The app generates its own labels
as a side effect of working.

```bash
npm run dataset:adapt                  # regenerate both files
npm run dataset:adapt -- --students 500 --drifts 60
npm run prior:adapt -- datasets/focusplug-drifts.csv
```

| File | What it is |
| --- | --- |
| `focusplug-drifts.csv` | 9,600 drifts. Committed, so it can be read on GitHub. |
| `focusplug-drifts.jsonl` | The same rows, one JSON object per line. Gitignored — regenerate it. |

## Everything in here is simulated

No real person's drifts are in this file. The population is a hand-written
sampler in [`src/shared/adapt/population.ts`](../src/shared/adapt/population.ts):
four self-correction habits, with small situational effects on top. **A model
fitted on this data recovers that sampler's assumptions, not human behaviour.**

That is exactly why the file exists. It is a seed, shaped like real logged
drifts, for anything that can make a dataset better than a hand-written sampler.
The app itself never exports anything — it learns on-device and nothing leaves
the machine. Exporting a real student's drifts would need their explicit consent
and there is no code path that does it.

## Columns

| Column | Meaning |
| --- | --- |
| `drift_id` | Stable id, so an improved file can be matched back to this one. |
| `cohort` | Provenance: `sim:<habit>` here, `device` for a real log. Never a name. |
| `ts_iso` | When the countdown started, UTC. Its hour always matches `hour`. |
| `elapsed_min` | Minutes into the session. |
| `planned_min` | How long the session was meant to run. |
| `violation` | `blocked` (tabbed to a blocked app) or `away` (left the desk). |
| `focus_process` | What was in the foreground. Not a feature; kept so the file reads. |
| `desk_label` | On-device desk model: `at_desk` / `away` / `uncertain`, empty if the webcam was off. |
| `desk_confidence` | 0–1. Zero when there was no reading. |
| `webcam_enabled` | 0/1. |
| `dwell_ms` | How long that window had been focused when the countdown started. |
| `switches_last_two_min` | Foreground-window changes in the last two minutes. |
| `prior_drifts` | Countdowns already started this session. |
| `prior_kills` | Kills already carried out this session. |
| `hour` | Local hour, 0–23. |
| `fuse_sec` | **The treatment.** Seconds they were given to fix it themselves. |
| `recovered_after_sec` | **The label.** Seconds to the cancel — or *empty*, meaning killed. |
| `recovered` | Derived convenience column. Ignored on the way back in. |

## The one property that must survive

**An empty `recovered_after_sec` is censored, not a negative.**

When the fuse fires first, you never learn whether they were two seconds from
coming back. A kill at 3s tells you 3s was not enough; it says nothing about
whether 8s would have been. So:

- A **recovered** row at `T` resolves *every* candidate fuse `F`: they'd have
  made it if `F >= T`, and not if `F < T`.
- A **killed** row at `F0` resolves only `F <= F0`. Longer fuses are dropped, not
  guessed.

That asymmetry is what identifies the fuse coefficient, and it is the single most
important thing about this data. A tool that "cleans" empty labels into zeros, or
imputes a recovery time for killed rows, has destroyed the dataset while
improving every surface metric. `summarise()` in
[`dataset.ts`](../src/shared/adapt/dataset.ts) flags the telltale corruption: a
row claiming recovery *after* its own fuse fired.

Two more things to preserve:

- **Keep the censoring rate.** ~70% of rows here are censored. Rebalancing toward
  recovered rows makes the model optimistic and the fuses too short.
- **`fuse_sec` is a treatment, not a feature of the person.** It was chosen by
  the policy, so it correlates with the model's own past beliefs. Dropping it
  would let the model read its own decisions as properties of the student.

## Round trip

```bash
npm run dataset:adapt
python scripts/adaption-upload.py            # dry run, spends nothing
python scripts/adaption-upload.py --go
npm run prior:adapt -- datasets/focusplug-drifts.improved.csv
```

`prior:adapt` splits by drift (never by expanded example — that would leak
near-copies across the split), fits the on-device learner over the whole file,
and scores it on held-out drifts against the prior currently shipping in
`model.ts`. If held-out log-loss does not improve, the new data did not help, and
nothing gets pasted into the app. That comparison is the entire point of the
round trip.

One known confound, visible in the current fit: `prior_kills` comes out strongly
negative even though the simulator gives it **no causal effect**. It is acting as
a proxy for which habit the student has — people who get killed a lot are the
people who don't come back. Real structure, correctly found, and still not a
causal claim.
