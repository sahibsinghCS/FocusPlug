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
webcam sits on the screen — fixed before the full run. 170 credits in total.
Output: `datasets/desk-attention-labels.csv`. Near-duplicate photos (dHash
within 6 bits) stay on one side of the split, which moved 122 train images to
eval.

```
python scripts/desk-model/adaption-label.py build  --name main
python scripts/desk-model/adaption-label.py submit --name main --go   # spends credits
python scripts/desk-model/adaption-label.py fetch  --name main
python scripts/desk-model/adaption-label.py export --name main
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/train-attention.ts --hidden 16 --l2 0.01 --slices 745-2025
npx tsx --tsconfig tsconfig.node.json scripts/desk-model/eval-attention.ts
```

The config was picked from a 12-run sweep scored on the validation slice only
(hidden 0 / 16 × three L2 strengths × full vector vs MobileNet slice).

### Results — read before quoting anything

Held-out eval, 143 images. Truth is Adaption's annotation, not a human label.

| | |
| --- | --- |
| 3-way accuracy | **56.6%** — below always answering `focused` (65.7%) |
| phone detection | precision 42.9% · recall 50.0% · F1 46.2% (18 phones) |
| off task (unfocused or phone) | precision 45.2% · recall 67.3% · F1 54.1% |
| the pack's own `distracted` label, as a phone detector | F1 60.0% |

**This head is not reliable yet.** Validation said 70.6%, but it held 68
images (9 unfocused, 13 phone) — too few to choose a model, and the drop to
56.6% is that selection noise. It also learns from 3rd-person stock photos
while the runtime camera is 1st-person. Claim the pipeline, not phone
detection. The data that would fix it is the actual webcam: a minute focused
and a minute on the phone label themselves.

It is opt-in by construction: attention only exists with
`deskModelId: "custom"`, so the default BlazeFace install never nudges on it.
For a filmed demo use Settings → When you drift → Test nudge, which fires the
same nudge path (window forward, overlay, lamp) on demand.

## Licenses / attribution

- MobileNetV2 feature vector — Google, TF Hub graph model, **Apache-2.0**.
- MediaPipe BlazeFace — already shipped by the app (see desk fixtures
  attribution).
- Edinburgh office webcam frames (`nc/`, Fisher et al.) — **CC BY-NC-SA**,
  used for training/eval only in this non-commercial hackathon build; only
  learned weights ship, never the images.
