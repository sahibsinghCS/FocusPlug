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

---

# The window-title eval set

`window-titles.csv` — 535 foreground window titles labelled `on_task` or
`distracted`, with the process name. Scored by `npm run eval:titles`.

## What it is for

FocusPlug decides on-task from the foreground window with substring rules over
the allow/blocklists. That is sound when the **app** is the signal: Discord is
always a distraction. It cannot work when the app is identical on both sides —
a lecture and a prank video are both `chrome.exe`, and only the title separates
them. This set is that case, and only that case.

Result on the current matcher:

| | |
| --- | --- |
| correct | 190 (35.5%) |
| wrong | 275 (51.4%) |
| no opinion | 70 (13.1%) |
| **distractions called on task** | **267** |

`sublime_text.exe`, `vim.exe` and `acrobat.exe` score 0.0% — they are on
neither list, so the sensor has no opinion at all.

## Read the number correctly

**This is adversarial by construction.** It was generated by asking for the
hard cases — same application, opposite intent. It is a worst case, not
FocusPlug's accuracy in general: on the cases the lists *are* built for
(Discord, Steam, games) the matcher is exactly right, and none of those are
here. Quote it as "on titles where the app alone cannot decide, the window
sensor is near-blind", never as "FocusPlug is 35% accurate".

## Where it came from

Generated with **Adaption Labs' Adaptive Data** (`datasets.invent`, 400
instruction rows, domain `academic_education.study_skills`, 40 credits), then
parsed down to unique `(title, process, label)` triples. No real person's
window titles are in this file — titles are among the most private things a
machine knows, and FocusPlug never exports them. That privacy is the reason
this set had to be generated rather than collected.

It is a **measurement**, not training data. Nothing in the app consumes it, and
no model is fitted on it. It exists to size a gap that is currently unfixed:
a title-aware on-task signal.

---

# The desk attention labels

`desk-attention-labels.csv` — 1,919 photos from the desk-data pack's `main`
bucket, each annotated by **Adaption Labs' Adaptive Data** (multimodal
`datasets.run`, one fixed instruction) in two runs: the 1,577 photos of
`desk-data-v2-full` (160 credits plus a 10-credit pilot) and the 342 phone
photos added by `desk-data-v3-distracted` (40 credits). No images are in this
file or this repo; `path` points into those releases. Made and exported by
`scripts/desk-model/adaption-label.py`; trained on by
`scripts/desk-model/train-attention.ts`.

| Column | Meaning |
| --- | --- |
| `path` | Pack-relative image path. |
| `split` | `train` / `eval`. Near-duplicate groups share a split, and a group touching a pack eval image is eval. |
| `group` | Near-duplicate group id (dHash within 6 bits). |
| `attention` | `focused` / `unfocused` / `phone` — the attention head's target. Empty when the photo is not a usable example: no person, gaze unclear, or looking into the camera. |
| `person`, `workspace`, `phone`, `gaze`, `note` | Adaption's raw answer. |
| `pack_label` | The pack's original label, kept for comparison only. |

| | focused | unfocused | phone | no label |
| --- | --- | --- | --- | --- |
| train | 299 | 67 | 327 | 714 |
| eval | 97 | 32 | 71 | 312 |

**Truth here is a model's reading of a photo, not a human label.** The pilot's
100 answers were checked against a contact sheet of the images and described
them accurately, with a few borderline calls; nobody has audited all 1,577.
Treat scores against this file as agreement with Adaption, and see
`docs/CUSTOM-MODEL.md` for what the head trained on it can and cannot do.

