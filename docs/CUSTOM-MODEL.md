# Custom desk model (`deskModelId: "custom"`)

**Held-out eval: 95.16% 3-way accuracy (bar: ≥90%).** The shipped custom
model is a **stacked on-device classifier** over three signal families:

1. **Face detection** — the existing MediaPipe BlazeFace detector (reused
   through the exported adapter; the weights under
   `src/main/desk/models/blazeface/` load once and are shared with the
   `"blazeface"` id) runs on the full frame **plus three sub-crops**
   (center / left / right) so small and off-center faces still fire.
2. **Scene semantics** — a MobileNetV2 ImageNet feature vector (alpha 0.50,
   160px, 1280-d; TF Hub graph model, Apache-2.0, 2.7 MB) committed under
   `model/weights/mobilenet/` and loaded from disk, plus pooled BlazeFace
   backbone activations.
3. **Hand-crafted descriptors** — 8×8 luma grid, 4×4 color grid,
   gradient-orientation histograms, Laplacian blur, highlight / shadow /
   skin-tone fractions, luma histogram, saturation stats.

A trained MLP head (64-32, hand-rolled deterministic Adam) maps the
2025-dim vector to `at_desk` / `away` / `uncertain` with softmax confidence.

- **Inference:** fully on-device (local graph models + plain arithmetic).
  No cloud vision, no network calls, **no new npm dependencies**.
- **Weights:** `src/main/desk/model/weights/desk-head.json` (~1.7 MB JSON) +
  `model/weights/mobilenet/` (~2.7 MB), committed. Training metrics sit in
  `desk-head.metrics.json`.
- **Safety:** if the head weights are missing or unparseable the model
  returns `uncertain` with confidence 0 — the policy never desk-only-kills
  on that. `npm run test:desk` asserts this fallback.
- **Latency:** ~1.0–1.4 s per 640×480 frame on the CPU backend (~0.7 Hz
  sampling — 6–7 desk readings inside the 10 s policy fuse). The desk
  monitor `await`s each inference, so a slower model only lowers the
  sampling rate — never a stuck queue.

## Enable it

Settings → Desk model → **custom**, or `{ "deskModelId": "custom" }` in the
persisted settings. Nothing else changes — the factory, monitor, policy and
UI treat it like any other `DeskModel`.

## Training data (never committed)

Training uses the `desk-data-v2-full` GitHub release (3500 labeled images:
`at_desk` / `away` / `distracted` / `uncertain`, pre-split train/eval).
`labels.json#desk_model_mapping` folds `distracted` into `at_desk` for the
3-way task. The `nc/` bucket (Edinburgh office webcam frames, Fisher et al.)
is **CC BY-NC-SA** — fine for this non-commercial hackathon build; only
learned weights ship, never the images.

> We thank the University of Edinburgh for the use of the low resolution
> video and ground truth data.

Keep the extracted pack **outside the repo** and point the env var at it:

```
# download the 6 parts of the desk-data-v2-full release, then:
cat focusplug-desk-data-1k.tar.gz.part-0* > focusplug-desk-data-1k.tar.gz
tar -xzf focusplug-desk-data-1k.tar.gz
set FOCUSPLUG_DESK_DATA=C:\path\to\focusplug-desk-data
```

The scripts refuse to run without `FOCUSPLUG_DESK_DATA`; feature caches are
written inside the data directory (`.cache/`), also outside the repo.

## Reproduce

```
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/extract-features.ts --shard 0 --of 8
# ... run shards 0..7 in parallel; resumable, cached by feature version

# exact shipped config (all flags explicit; matches desk-head.metrics.json):
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/train.ts --hidden 64,32 --l2 0.0003 --main-weight 3 --seed 42

npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval.ts        # held-out eval
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval.ts --e2e  # full YourModel.infer pass
```

`extract-features.ts` calls the **same** `extractDeskFeatures` export that
`YourModel.infer` uses at runtime, so trained features cannot drift from the
shipped inference path; `eval.ts --e2e` additionally re-runs every eval image
through `YourModel.infer` end to end. Training is deterministic (seeded PRNG,
hand-rolled Adam — no new dependencies). `scripts/desk-model/GAUNTLET.md`
logs every round against the bar.

## Results (held-out eval, 723 images)

| Slice | Custom model | BlazeFace heuristic baseline |
| --- | --- | --- |
| **overall** | **95.16%** (688/723) | 46.89% |
| at_desk | 95.67% | 21.88% |
| away | 95.44% | 87.72% |
| uncertain | 88.89% | 6.67% |
| bucket main (diverse stock) | 89.44% | — |
| bucket nc (Edinburgh webcam) | 99.75% | — |

Verified end to end: `eval.ts --e2e` re-runs every eval image through the
shipped `YourModel.infer`. Repo health with the trained weights: contracts
OK, typecheck clean, vitest 222/222, `npm run test:desk` gauntlet PASS
(37/37). Round-by-round evidence: `scripts/desk-model/GAUNTLET.md`.

**Honest caveats.** The `nc` eval split is temporally interleaved with its
train split (same static camera, ~11 frames apart), so its 99.75% is partly
scene familiarity — the diverse-scene figure is main's 89.44%. The main
bucket carries some at_desk/away label noise (people visible in `away`
shots) and `uncertain` mixes degraded frames with arbitrary non-desk
scenes. Eval images are 3rd-person stock while the runtime webcam is
1st-person: the bar is met on the pack's own protocol, and BlazeFace's
face-presence signal is what transfers most directly to selfie-view use.

### Away, on the model that actually ships

The table above is a 3-way accuracy, and one of the three answers is allowed to
**stop a student's study clock** (`docs/CONTRACTS.md § Drift pause`). For that
decision the number that matters is not overall accuracy but the precision of
the `away` call — of the frames a model calls `away`, how many really are — and
on that measure the two presence models are not close.

Same held-out eval, re-run on the pack with `desk-data-v3-distracted` applied,
so 790 images rather than the 723 above (67 more `distracted`→`at_desk` eval
photos; the custom head scores 95.06% overall and 90.23% on `main` there, so
the table above is if anything the conservative one). `eval.ts` prints both
lines and stores them under `awayQuality` in `.cache/eval-report.json`:

| the `away` call | custom head | BlazeFace heuristic (**the shipped default**) |
| --- | --- | --- |
| precision — of its `away` calls, how many are right | **92.5%** (272/294) | **42.1%** (250/594) |
| recall — of the real aways, how many it catches | 95.4% | 87.7% |
| at-desk frames it calls `away` | 4.3% (20/460) | **66.7%** (307/460) |
| `away` calls clearing the shipped `pauseAwayConfidence` 0.75 | 289, 20 wrong | 590, **340 wrong** |
| wrong `away` calls the 0.75 floor screens | 2 (of 22) | 4 (of 344) |

```
FOCUSPLUG_DESK_DATA=/path/to/pack npx tsx --tsconfig tsconfig.node.json \
  scripts/desk-model/eval.ts
```

BlazeFace is not a bad model here; it is **not an away model at all**. It is a
face detector, and `classifyDesk` reports `away` whenever no usable face is in
the frame — so a dim room, a steep webcam angle, a hand over the lens and a
head turned down are all the same answer as an empty chair. Worse for a floor:
that answer is a *constant*, `0.90` for an occluded frame and `0.92 - 0.25·p`
otherwise, not a score that falls when the model is unsure. 329 of its 344
wrong `away` calls sit at exactly 0.92. That is why `pauseAwayConfidence`
screens four of them: it cannot separate calls that were never separated. Nor
can raising it — 0.92 is the highest confidence `classifyDesk` can produce, so
the slider's 0.95 ceiling screens every BlazeFace `away` there is. On this
model the only floor that is safe is the one that switches the feature off.

The floor is not useless; it is aimed elsewhere. It bites when a face *is*
found and then rejected as unusable — `0.92 - 0.25·p` falls to between 0.67 and
0.80 for a confident detection at a bad angle or a bad aspect ratio, which is
the head-down-over-a-notebook case, and those readings are screened. That case
is not the one that matters here: 340 of the 344 wrong calls are frames the
detector found no face in at all, and it scores them like an empty room.

So the pause follows the head that earned it. `deskModelMayPauseOnAway`
(`src/shared/nudge.ts`) lets only `deskModelId: "custom"` carry `pause: true`
on an `away`, the controller ANDs it into `DriftPolicy.pauseOnAway`, and no
setting or hand-edited `settings.json` can undo it. On the default install an
`away` still nudges — window, overlay, lamp — because that costs a glance and
undoes itself, and pulling someone back who really did just leave is worth a
42% call. Stopping their clock is not.

## Attention head (`focused` / `unfocused` / `phone`)

A second head over the **same** feature vector, consulted only when the
presence head says `at_desk` (`model/weights/attention-head.json`, surfaced as
`DeskModelOutput.attention`). It reads the 1280-d MobileNet slice through a
16-unit hidden layer: one small matrix multiply, no second model, no added
latency.

**Labels came from Adaption Labs.** The pack's `distracted` class ("on phone /
looking away") is mostly phone product shots, crowds and street scenes, with a
few people plainly working, so it cannot teach "is the person at the desk on
their phone". `scripts/desk-model/adaption-label.py` sent the 1,577 `main`
images (downscaled, filenames hidden because they contain the pack label) to
Adaptive Data's multimodal run with one fixed instruction, and got back per
image: is a person visible, are they at a workspace, is a phone in use, and
where are they looking. A 100-image pilot was checked by eye first. It caught
a prompt flaw — looking *into the camera* counted as looking away, but a
webcam sits on the screen — fixed before the full run. A second batch, the 342
phone photos of the `desk-data-v3-distracted` release, was labelled the same
way and merged; an image an earlier run labelled is never sent again. 210
credits in total. Output: `datasets/desk-attention-labels.csv` (1,919
annotated photos; the file also holds 225 bucket-labelled stock proxies that
Adaption never saw — see below).
Near-duplicate photos (dHash within 6 bits) stay on one side of the split,
which moved 123 train images to eval.

```
python scripts/desk-model/adaption-label.py build  --name main
python scripts/desk-model/adaption-label.py submit --name main --go   # spends credits
python scripts/desk-model/adaption-label.py fetch  --name main
python scripts/desk-model/adaption-label.py build  --name v3 --exclude-run main   # after applying desk-data-v3-distracted
python scripts/desk-model/adaption-label.py submit --name v3 --go
python scripts/desk-model/adaption-label.py fetch  --name v3
python scripts/desk-model/adaption-label.py export --name main v3
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/train-attention.ts --hidden 16 --l2 0.03 --slices 745-2025
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval-attention.ts
```

The config was picked by 5-fold cross-validation on the train split only
(`--folds 5 --fold i`, near-duplicate groups kept together; 9 settings: hidden
0 / 16 / 32 × L2 × MobileNet slice vs full vector). Best: 59.2% mean
balanced accuracy, ±2.9 points across folds. A single validation slice swung
±6 points between folds, which is how the first head's 70.6% validation
became 56.6% held-out. `eval-attention.ts --weights … --labels …` scores any
head on any label file, so old and new heads are compared on the same images.

### Results — read before quoting anything

Held-out eval. Truth is Adaption's annotation, not a human label. "First head"
trained on the 1,577 `main` labels; "this head" adds the 342 v3 phone photos
and is still the head that ships. The last two rows are the **new** proxy eval
set described in the next section; the shipped head never saw any of those
images either, so they are held out for it in the ordinary way.

| | first head | this head |
| --- | --- | --- |
| original 143-image eval · 3-way accuracy | 56.6% | 60.8% — always `focused` is 65.7% |
| original eval · phone precision / recall / F1 | 42.9% / 50.0% / 46.2% | 30.0% / 50.0% / 37.5% |
| Adaption 200-image eval · 3-way accuracy | 49.5% | **64.0%** — always `focused` is 48.5% |
| Adaption eval · phone precision / recall / F1 | 65.8% / 35.2% / 45.9% | 68.1% / 69.0% / **68.5%** |
| Adaption eval · off task (unfocused or phone) F1 | — | 72.2% |
| proxy 86-image eval · 3-way accuracy | — | 57.0% — always `focused` is **83.7%** |
| proxy eval · phone precision / recall / F1 | — | 30.0% / 64.3% / 40.9% |

**Every row is a different set of images.** `eval-attention.ts
--exclude-proxies` scores the Adaption rows (the set every earlier round was
measured on), `--proxies-only` the proxy rows, and the default now scores all
286 pooled — 61.9%, always `focused` 59.1%. The pooled number mostly reports
the mixing ratio of two label sources, so it is not a headline; the script
prints which set it just scored above the numbers. The 143-image row needs the
label file as it stood at commit `7b6ada4`
(`git show 7b6ada4:datasets/desk-attention-labels.csv > /tmp/143.csv`, then
`--labels /tmp/143.csv`).

**More sensitive, not reliable.** The extra photos doubled how many phones it
catches in phone-style stock photos, and roughly doubled how often it calls a
non-phone photo "phone" (about 17% of them, up from 10%). On the original,
harder images it is no better at phones and still below always answering
`focused`. The pack's `distracted` label scores F1 86.7% as a "detector" on the
current eval, but that is not a model: those photos were collected as phone
photos, so it only restates how they were chosen.

It still learns from 3rd-person stock photos while the runtime camera is
1st-person, where the phone is usually below the frame and the tell is the
head tilting down. **Claim the pipeline, not phone detection.** Nothing in the
next two sections changes that headline; the first is a negative result and
the second only narrows the domain gap and measures the narrowing honestly.

### Stock attention proxies — folded in, and they did not help

`desk-data-attention-proxies-hq` is 225 free-licensed photographs collected
against the head's known failure modes and sorted into six buckets by the
search query that found them. They are **stock proxies, not first-person
webcam frames** — the release says so itself — so they narrow the domain gap
the way the rest of the stock pack does, which is to say a little.

| bucket | images (train / eval) | label | why it was collected |
| --- | --- | --- | --- |
| `hard_negative_down` | 49 (29 / 20) | `focused` | head down over a notebook, keyboard or calculator — **not** a phone |
| `webcam_angle` | 46 (27 / 19) | `focused` | frontal desk-cam-ish person at a computer |
| `lighting` | 44 (26 / 18) | `focused` | desk lamp, dim room, backlight, evening |
| `posture_focus` | 36 (21 / 15) | `focused` | lean back, chin in hand, glance aside, still at the desk |
| `phone_low` | 37 (23 / 14) | `phone` | phone low or at the desk — the real failure case |
| `uncertain` | 13 (6 / 7) | *(no label)* | blur, motion, partial desk scenes |

`hard_negative_down` is the point of the release. A false `phone` is not a
silent error here: two in a row and `NudgeTracker` fires, so FocusPlug pulls
its window to the front and switches the lamp on at somebody who was working.
The product's answer to the numbers below is that the head is allowed to do
that and no more by default — `pauseOnPhoneEnabled` ships **off**, so a
`phone` call cannot stop the study clock until the student turns it on, and
even then it needs five straight readings across thirty seconds above a floor
kept above the presence head's (`docs/CONTRACTS.md § Drift pause`). The other
pause, `away`, is the presence head's call and not this one — and it is not on
by default either, because the presence model that *is* on by default has not
earned it (§ Away, on the model that actually ships). **A default install
cannot stop the clock at all.**

**How little that confidence floor actually contributes.** It is the weakest of
the three guards and the docs should not let it stand in for the others. On the
pooled 286-image eval the head makes **44** false `phone` calls; the shipped
`pausePhoneConfidence` of 0.90 screens **39 of them (88.6%)** and lets **5**
through. The two most confident survivors are exactly the pose this release was
collected against:

| false `phone`, confidence ≥ 0.90 | truth | confidence |
| --- | --- | --- |
| `attention-proxies/hard_negative_down/hard_negative_down_p207756.jpg` | `focused` | 0.9955 |
| `eval/at_desk/at_desk_p806835.jpg` | `focused` | 0.9932 |
| `attention-proxies/posture_focus/posture_focus_p7320318.jpg` | `focused` | 0.9515 |
| `eval/at_desk/main_at_desk_f1f031b4c4fb.jpg` | `focused` | 0.9389 |
| `eval/at_desk/at_desk_p5301652.jpg` | `unfocused` | 0.9012 |

A floor screens *noise*, and a head down over a notebook is not noise — it is a
pose a student holds for the whole thirty seconds, at 0.99. So the guard that
carries this risk is not the floor: it is `pauseOnPhoneEnabled` shipping **off**
and, if switched on, the five-readings-across-thirty-seconds sustain. Read them
off the same report the accuracies come from:

```
FOCUSPLUG_DESK_DATA=/path/to/pack npx tsx --tsconfig tsconfig.node.json \
  scripts/desk-model/eval-attention.ts
node -e "const m=require(process.env.FOCUSPLUG_DESK_DATA+'/.cache/attention-eval-report.json').misses.filter(x=>x.predicted==='phone');console.log(m.length,m.filter(x=>x.confidence>=0.9).length)"
```

Unpack the release into the pack as `attention-proxies/` (beside `train/` and
`eval/`), then:

```
# read the release manifest, group, split, append the rows — --dry-run writes nothing
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/ingest-proxies.ts --dry-run
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/ingest-proxies.ts
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/extract-features.ts --shard 0 --of 4

# the shipped head: same config, proxies held out of training
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/train-attention.ts --hidden 16 --l2 0.03 --slices 745-2025 --exclude-proxies
# the arm that did not work: drop --exclude-proxies and it trains on them too
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/train-attention.ts --hidden 16 --l2 0.03 --slices 745-2025 --out /tmp/with-proxies.json

npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval-attention.ts --exclude-proxies   # the Adaption 200
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval-attention.ts --proxies-only      # the proxy 86
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/hard-negative-report.ts \
  --before src/main/desk/model/weights/attention-head.json --after /tmp/with-proxies.json
```

**How they were folded in.** Rows are appended to
`datasets/desk-attention-labels.csv` in its existing ten columns — no new
column, no existing row touched, so every number measured before the ingest
can still be measured after it. The images live in the pack beside `train/`
and `eval/` under `attention-proxies/<bucket>/` and are read straight out of
the CSV by path prefix, the same adapter first-person clips use; they carry
`bucket: "attention_proxy"`, which `readFeatureRows` skips by default, so the
presence head never sees them. Near-duplicates are grouped with the same dHash
rule the stock rows use (8×8, within 6 bits) and the group id **carries the
bucket** (`apx_<bucket>_<hash>`), so photos from one query cannot straddle the
split. That check also caught four proxies that are near-duplicates of images
already in the pack — three `phone_low` copies of `train/distracted/…` and one
`uncertain` copy of an `eval/at_desk/…` image — and each inherited the split of
the image it duplicates instead of leaking across it. Of the rest, two groups
in five went to eval, bucket by bucket: **132 train / 93 eval images (126 / 86
of them labelled)**, because a token eval share of a new distribution would
have let the head fit it and then report a number that mostly measured the old
images.

`person` / `workspace` / `phone` / `gaze` on these rows are **derived from the
bucket**, not observed, exactly as they are for self-labelled webcam clips, and
each row's `note` says so and carries its licence, photographer and source URL.

**The result: no.** Same recipe (`--hidden 16 --l2 0.03 --slices 745-2025`),
same trainer, one variable — the 126 extra labelled train images. Five seeds
each, because one run of this recipe is a lottery (its early stop picks the
best epoch on a single 124-sample validation slice, and at seed 42 that was
epoch 3):

| 3-way accuracy, 5 seeds | without proxies | with proxies |
| --- | --- | --- |
| Adaption 200-image eval | 64.0 / 58.5 / 62.5 / 59.0 / 54.5 → **mean 59.7%** | 55.0 / 53.0 / 47.5 / 47.5 / 57.0 → **mean 52.0%** |
| proxy 86-image eval (always `focused` = 83.7%) | 57.0 / 64.0 / 64.0 / 54.7 / 69.8 → mean 61.9% | 55.8 / 74.4 / 65.1 / 59.3 / 67.4 → mean 64.4% |

Nearly eight points of mean 3-way accuracy lost on the Adaption eval, and the
two arms barely overlap: the best with-proxies run (57.0%) beats exactly one of
the five without (54.5%). On the proxies' own distribution they gain about two
and a half points — well inside a seed spread of eighteen — and both arms sit
some twenty points *below* always answering `focused` there.

**And the hard negatives specifically did not stop the false phone calls** —
the 20 held-out `hard_negative_down` images, mean of the same five seeds:

| held-out slice | non-phone images | false `phone` without proxies | with proxies |
| --- | --- | --- | --- |
| `hard_negative_down` | 20 | 5.2 (26.0%), range 4–6 | 5.6 (28.0%), range 5–7 |
| `webcam_angle` | 19 | 6.4 (33.7%) | 5.8 (30.5%) |
| `lighting` | 18 | 4.6 (25.6%) | 2.0 (11.1%) |
| `posture_focus` | 15 | 5.8 (38.7%) | 4.2 (28.0%) |
| Adaption stock | 129 | 30.0 (23.3%) | 32.2 (25.0%) |
| **all 201 non-phone eval images** | 201 | **52.0** | **49.8** |

Phone recall over the same runs fell 70.1% → 64.7%. So the head calls `phone`
slightly less often overall, on the hard negatives it does not, and it catches
fewer real phones — which is a threshold shift, not a model that learned what
a notebook is.

**Why, most likely.** Two reasons, both visible in the data rather than
inferred. First, a bucket label is a claim about a search query, and one of
these buckets disagrees with the vocabulary the rest of the file uses:
`posture_focus` is "glancing aside, leaning back, at the desk", which is
exactly Adaption's definition of `unfocused`, and the head trained on the
proxies calls 8 of those 15 eval images `unfocused` — by the vocabulary the
other 1,919 rows use, the prediction is the better word and the label is the
wrong one (`hard-negative-report.ts` prints that breakdown). Second, 103
of the 126 labelled proxy train rows are `focused`, which pushes the trainer's
class-balancing weight for `focused` down (0.77 → 0.68) and pins `unfocused` at
its cap of 4, so the head answers `unfocused` far more often: on the Adaption
eval its `unfocused` predictions go 41 → 70 out of 200. Adding images labelled
`focused` made it *less* willing to say `focused`.

**What ships.** Nothing changed. The attention head is still the v3 head,
byte for byte, and it is now reproducible from the committed CSV with
`train-attention.ts --hidden 16 --l2 0.03 --slices 745-2025 --exclude-proxies`.
The 225 rows stay in the file, with their credits, because a negative result
nobody can re-run is not a result — and because the 86-image proxy eval is a
genuinely harder held-out set that the shipped head is now measured on.

**Config selection stayed on the train split.** 5-fold CV over the enlarged
train pool, groups kept together, nine settings, mean balanced accuracy:
`h32/l2 0.03/full vector` 58.7% ± 5.5, `h16/l2 0.1/slice` 58.2% ± 5.1,
`h32/l2 0.03/slice` 57.9%, `h32/l2 0.01/slice` 57.8%, `h16/l2 0.03/full` 57.5%,
`h16/l2 0.03/slice` (shipped) 56.7% ± 6.1, `h16/l2 0.01/slice` 56.4%,
`h0/l2 0.03/slice` 55.4%, `h0/l2 0.01/slice` 54.3%. The top five sit within 1.2
points while a single fold swings 5–6, and the one candidate that beat the
incumbent in all five folds does it by feeding the head the whole 2025-d
vector — the hand-crafted scene statistics that differ most between 3rd-person
stock and the 1st-person webcam this head runs on, where no eval here can see
it. Trained anyway and measured, for the record: 55.5% on the Adaption eval,
79.1% on the proxy eval (still under that set's 83.7% baseline). Not shipped,
and the decision was written down before either number existed.

**The proxy eval has one trap of its own.** `pack label distracted as a phone
detector` scores 100% precision and recall on the proxy rows, and that is
meaningless: those rows' `pack_label` is `distracted` exactly when the bucket
is `phone_low`, which is exactly when the label is `phone`. It restates how the
photos were filed, like the v3 `distracted` baseline before it.

### First-person capture (`npm run capture:attention`)

Webcam clips are **self-labelling**. Record 20 seconds while deliberately on
your phone and every frame in that clip is a phone frame by construction — no
annotation step, not by a human and not by Adaption. Your entire cost is the
recording.

```
npm run capture:attention -- --label phone --seconds 20 --clip 3
npm run capture:attention -- --label focused --clip 1 --dry-run   # prints the plan, no camera
npm run capture:attention -- --label phone --clip 3 --retake      # re-record clip 3, REPLACING it
npm run capture:protocol                                          # the protocol below
```

It opens the camera through `src/main/desk/camera.ts` — the same
`ElectronCameraSource` the shipped desk monitor uses, reached by relaunching
under the Electron binary the app already depends on (`--source ffmpeg` uses
that file's ffmpeg source instead). No new dependency. Frames are written into
the desk-data pack under `first-person/<label>/fp-clip-NNN/`, never into the
repo, and rows are appended to `datasets/desk-attention-labels.csv` in its
**existing schema** — no new columns:

| column | value | why |
| --- | --- | --- |
| `group` | the clip id, e.g. `fp-clip-003` | **one clip is one group**, so a clip can never straddle the split |
| `attention` / `pack_label` | the label you declared | the declaration is the only ground truth here |
| `split` | odd clips train, even clips eval | assigned per clip, never per frame |
| `note` | `first-person webcam capture, self-labelled by clip` | so nobody mistakes these for annotated photos |

`person` / `workspace` / `phone` / `gaze` are **derived from the declared
label**, not observed. A clip id can never be reused for a different label or
the other split — the tool refuses, because that would split one group across
train and eval.

Re-recording the same clip is a **replacement, not an addition**. A frame
filename is a pure function of label, clip and frame index, so take two
overwrites take one's images and no new image exists; appending a second set of
rows for those same paths would add nothing but duplicates. `--retake` says
that out loud and **rewrites** the clip's rows (and deletes any frames a
shorter take left behind); without it the tool refuses. One path, one row: the
1,919 stock rows have always held that, and neither the eval nor the trainer
will be the first thing to break it.

#### The recording protocol

Six clips of 20 seconds: two focused, two phone, two unfocused. That is about
two minutes of your time, and there is no labelling step at all — the label you
declare before recording IS the label of every frame in that clip.

Vary the clips on purpose: different lighting, a different camera angle, a
different time of day. Six varied clips are six independent groups; one long
clip is one group no matter how many frames it holds, so a single long take
teaches almost nothing and measures nothing.

Record them in this order, one command per clip:

```
npm run capture:attention -- --label focused   --seconds 20 --clip 1
npm run capture:attention -- --label focused   --seconds 20 --clip 2
npm run capture:attention -- --label phone     --seconds 20 --clip 3
npm run capture:attention -- --label phone     --seconds 20 --clip 4
npm run capture:attention -- --label unfocused --seconds 20 --clip 5
npm run capture:attention -- --label unfocused --seconds 20 --clip 6
```

Odd clip numbers go to the train split and even ones to eval, so each label
lands one clip on each side. That gives three eval clips — the minimum the eval
will score at all, and still only a three-sample measurement.

focused: work as you actually work. phone: hold the phone where you really hold
it, below the frame, and let your head tilt down. unfocused: at the desk but
off task — staring away, leaning back, talking to someone.

Then re-extract features and retrain, and read the first-person and stock
numbers separately:

```
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/extract-features.ts --shard 0 --of 1
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/train-attention.ts --hidden 16 --l2 0.03 --slices 745-2025
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval-attention.ts
```

#### What six clips can and cannot claim

The honest claim after six clips is "adapted toward first-person, measured on 3
eval clips" — not a new headline accuracy. Three clips cannot move a headline
number, and the eval refuses to print one that pretends otherwise.

Consecutive frames of one clip are near-identical, so **a clip is one
independent sample however many frames it holds**. 40 frames are not 40
samples, and a tool that recorded two clips and reported a big accuracy jump
would be lying. The machinery that keeps this honest:

- `eval-attention.ts` scores stock (3rd-person) and first-person rows
  **separately** and never pools them; the top-level numbers in the report and
  the table above stay the stock slice. `--stock-only` reproduces the
  pre-capture numbers exactly.
- Every first-person number printed carries its **clip count**, not just its
  frame count — the headline, every per-class row, and both precision/recall
  lines, whose frame counts alone ("80 positives" off three clips) are exactly
  the inflation this section exists to stop. `assertClipCounted` enforces that
  in code rather than by memory: a first-person line carrying a percentage or
  an `n/m` ratio with no clips named throws instead of printing. The pack's
  `distracted` baseline is not printed on webcam rows at all — the pack never
  labelled them, so a 0% "baseline" there would be manufactured out of a
  vocabulary mismatch, sitting flatteringly next to the head's number.
- Below `FIRST_PERSON_MIN_EVAL_GROUPS` (3) independent eval clips — or with any
  of the three labels missing an eval clip — the eval prints a refusal and the
  clip census **instead of an accuracy**, and the JSON report stores `null`
  where the metrics would go. This is the same shape as the Focus Plan trend
  gates. `--min-fp-groups` can raise the bar; it cannot lower it.
- **One path is one row**, on both sides of the tool. `eval-attention.ts` and
  `train-attention.ts` deduplicate by path before scoring or training — as
  `extract-features.ts` always has — and say so when they find one, and
  `buildAttentionEval` refuses to render a report at all if a duplicate reaches
  it. A duplicated path is the quietest failure in this pipeline: the clip
  counts stay reassuringly correct while the frame counts describe images that
  no longer exist, and the trainer standardizes **every** row in the run —
  stock rows included — against a mean divided by a count it never summed.
- `train-attention.ts` treats the rows like any other (`--first-person-weight`,
  `--exclude-first-person`, `--first-person-only` change that; the defaults —
  weight 1, no filter — leave behaviour identical). Its validation split is
  already group-aware, so clip frames never land on both sides.
- The presence head is untouched: capture rows carry `bucket: "first_person"`,
  which `readFeatureRows` skips unless a caller opts in.

So after the full protocol the table above does not gain a row. What you can
say is: the head has seen first-person frames, and it was measured on three
first-person clips. Anything stronger needs many more clips from many more
people.

### Corrections from the student (`docs/CORRECTION-LOOP.md`)

Everything above this line was learned from **third-person stock photography**.
The one source of first-person evidence that scales is the student themselves:
when the timer pauses on a `phone` reading and they say *I was working*, the
frames that caused that pause are stored on their machine with their label. It
is data captured at exactly the moments this head is worst, labelled by the
only person who knows the truth, in their own room and their own light.

Two timescales, and they are deliberately not the same mechanism:

* **Immediately** the app obeys: the clock resumes and pauses of that kind are
  suppressed for a stated cooldown. The student is the authority in the moment.
  This touches no weights at all.
* **Later, and only when asked**, `npm run refit:attention` (or the Settings
  button, which runs the same code) fits **the output layer only** — 3×16
  weights and 3 biases, **51 numbers** — from the accumulated corrections,
  anchored to the shipped layer. **One click never retrains anything.**

What is refit and what is not:

| | |
| --- | --- |
| **fitted** | the 3×16 output layer, on the student's machine, into `<userData>/desk-corrections/personal-attention-head.json` |
| **frozen** | the 1280→16 bottleneck, the slice, the mean, the std — a personal head file physically cannot express them |
| **never written by the app** | `model/weights/attention-head.json`. On a packaged install it is inside a read-only bundle. |

The refit optimises the softmax over `focused` and `phone` **only**, and leaves
the `unfocused` row byte-identical to the shipped one. That is not an
optimisation: the paused screen has two buttons and neither can produce
`unfocused`, so a pile of corrections carries no evidence about that class —
and a three-way softmax would read every frame as evidence *against* it.
Measured on the 286 anchors below, that mistake costs `unfocused` recall
53.1% → 12.5%. The fit does not make it.

**The gate.** A personal head that is worse than the shipped one must not
replace it, so both are scored on the **same held-out eval this page already
reports** and eleven named gates run in order. It installs only if it is not
beaten pooled, drops neither slice by more than 3 points, and newly agrees with
the student on at least one more of their own held-out corrections. A refit
that fails writes the report and **deletes** any personal head that was there.
Both columns and every gate are in `refit-report.json` and on screen, and the
UI says which head is running.

**The anchors.** Scoring both heads needs the eval, and the eval is 286
photographs that cannot ship. So `npm run anchors:attention` commits
`model/weights/attention-anchors.json` (~56 KB): for each held-out image, the
**16 activations of the frozen bottleneck** and its truth — no pixels, nothing
invertible to an image, no `nc/` (CC BY-NC-SA) row and no first-person frame.
`attention-anchors.metrics.json` records the census, the licence exclusions,
and a parity check that every row reproduces `your-model.ts`'s own arithmetic
to 5e-7. The pack is stamped with `baseHeadHash`; if this head is ever
retrained the pack is stale, the gate says so, and nothing installs until it is
rebuilt.

**Is the gate real?** `npm run gauntlet:corrections` runs it against 200
synthetic students per arm: it installs **1.0%** of heads fitted on
shuffled-label pools, and **95.5%** of heads fitted on a first-person cue that
genuinely exists. A gate nobody checked in the *pass* direction is
indistinguishable from `return false`.

**Privacy.** The photographs are the student's own webcam frames. They stay in
`<userData>/desk-corrections/`, are never uploaded, are listed with thumbnails
in Settings, and are deletable in one action which also removes any head fitted
from them — and stops it running: the cached desk model is dropped in the same
call, so the reading after the tap comes from the shipped head, not from the
one fitted on the photographs that just went. The only way one leaves the
machine is the student running `npm run corrections:export` themselves.

### What this head is allowed to do in the product

It is opt-in by construction: attention only exists with
`deskModelId: "custom"`, so the default BlazeFace install never nudges on it —
and never stops the clock on it either. Sorted by how much it costs to be
wrong:

| the head says | on a default install | on `deskModelId: "custom"` |
| --- | --- | --- |
| `unfocused` | nothing | nudge only — it can **never** stop the clock, at any setting |
| `phone` | nothing | nudge; stops the clock only if the student switches `pauseOnPhoneEnabled` on, and then only after 5 readings across 30 s above a floor held above the away floor |
| `focused` | nothing | clears the drift |

Nothing here is enforcement: the process kill has never taken a desk *attention*
reading as an input, and a stopped clock releases the lock rather than
tightening it.

The other drift that can stop a clock, `away`, is the **presence** head's call
rather than this one, and it lives under the same rule read one level up — not
"which label", but **which model**. The presence head trained here is right on
92.5% of its `away` calls, so its `away` may stop a clock and
`pauseOnAwayEnabled` ships on for it. The `blazeface` detector that ships
enabled is right on 42.1% of them, and calls `away` on two thirds of the frames
of somebody sitting right there, so its `away` nudges and nothing more —
`deskModelMayPauseOnAway` refuses it structurally, at any setting (§ Away, on
the model that actually ships). **So a default install stops no clocks at all:
neither head has a number there that pays for it.**

That is the whole of the design, and it is one sentence: *the head with the
good number is the one trusted with the consequence.* Applied to this page's
head, it ships `pauseOnPhoneEnabled` off. Applied to the presence head, it
means the trained one and not the detector everybody actually runs.

For a filmed demo use Settings → When you drift → Test nudge, which fires the
same nudge path (window forward, overlay, lamp) on demand. Test nudges never
carry the pause flag — they cannot stop a clock, so nothing about a filmed
nudge is evidence that the pause works.

## Licenses / attribution

- MobileNetV2 feature vector — Google, TF Hub graph model, **Apache-2.0**.
- MediaPipe BlazeFace — already shipped by the app (see desk fixtures
  attribution).
- Attention proxies (`attention-proxies/`, the `desk-data-attention-proxies-hq`
  release) — 224 photographs under the **Pexels licence** and 1 in the **public
  domain** (Wikimedia); NC and ND images were excluded when the set was built.
  Per-photograph licence, photographer and source URL are committed in
  `datasets/desk-attention-proxies.csv` and repeated in each row's `note` in
  `datasets/desk-attention-labels.csv`. As with every other pack, only learned
  weights ship — and no weights currently ship from these at all, since the
  head that ships is trained with `--exclude-proxies`.
- Edinburgh office webcam frames (`nc/`, Fisher et al.) — **CC BY-NC-SA**,
  used for training/eval only in this non-commercial hackathon build; only
  learned weights ship, never the images.
- The committed anchor pack (`model/weights/attention-anchors.json`) is derived
  from the held-out eval slice of `datasets/desk-attention-labels.csv` — the
  Adaption Labs annotations and the Pexels/public-domain proxies above — as 16
  activations per image and nothing else. No `nc/` (CC BY-NC-SA) row is in it,
  which `build-attention-anchors.ts` enforces rather than assumes, and no
  first-person frame is either: a student's own photographs never enter a
  committed file. `attention-anchors.metrics.json` records both exclusions as
  counts.
