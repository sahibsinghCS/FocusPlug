# AI tools disclosure (Hyperbloom template)

Paste the **filled** sections into Devpost’s “AI Tools Disclosure” field. Hyperbloom allows existing models; the bar is that AI/ML is **central**, not bolted on.

Keep two stories distinct:

1. **In-product ML** — **four models trained in this repo** (the Focus Forecast risk head, the adaptive fuse, the custom desk head, the attention head) plus two reused pretrained backbones. Every one of them is a policy input: kill / no-kill / how long the fuse burns / whether to nudge.
2. **Build-time assistants** — coding agents that wrote this repo, and the one labelling service we bought annotations from.

Do not list a tool you did not use. Do not disclaim a model this repo actually trained: all four are committed, reproducible, and have printed numbers. Bracketed `⟦ ⟧` lines are blanks for the submitting team.

---

## 1. One-paragraph paste (edit, then copy)

```
FocusPlug ships four models we trained ourselves. All of them run on-device.

(1) Focus Forecast — a 937-parameter tanh MLP (mlp24-36-1: 24 behavioral
features → 36 hidden units → 1 logit, Platt-calibrated) that scores drift risk
once a second off the local telemetry ring, nudges at 0.50, and pre-arms the
enforcement fuse at 0.65 before any rule has been broken. Trained offline
in-repo by `npm run forecast:pipeline` on behavior streams from our own session
simulator, then scored on a disjoint 900-session / 1,230-onset corpus:
lead≥20s AUC 0.9330 against the 0.9259 logistic baseline this repo's own CI
gate enforces, 70.8% of drifts warned within 30s, median lead 16s. Both the
training and the evaluation sessions are SIMULATED — no student data was
collected, bought or scraped.

(2) The adaptive fuse — a 17-feature logistic model that learns online, per
install, how long THIS person needs to self-correct, and picks the shortest
fuse still clearing an 85% predicted recovery. It needs no dataset: the app's
own outcomes are the labels (a cancelled countdown is a recovery and its timing
says how long you needed; a kill is a failure). Weights stay in the user's data
dir; nothing is uploaded. The two fuse models compose rather than compete —
adapt sets a personalised length, a pre-arm halves it, floor 3s.

(3) Desk head (deskModelId: "custom") — a 64-32 MLP we trained on the
desk-data-v2 image pack over a stacked feature vector: MediaPipe BlazeFace
across four crops, a MobileNetV2 ImageNet feature vector, and hand-crafted
luma / color / gradient descriptors. 95.16% held-out 3-way accuracy on 723
images, against 46.89% for the BlazeFace heuristic baseline. Only the learned
weights ship; the training images never do. It is opt-in — the default desk
model is BlazeFace plus heuristics.

(4) Attention head (focused / unfocused / phone) — a 16-unit head on the same
feature vector, trained on 1,919 desk photos annotated by Adaption Labs'
Adaptive Data. It is what raises a nudge when someone is at the desk but on
their phone. It is NOT reliable yet and we say so on the page: 60.8% on the
original 143-image eval, under the 65.7% you get by always answering "focused"
(the first head scored 56.6%); 64.0% on the current 200-image eval, phone F1
68.5%, while calling "phone" on ~17% of non-phone photos. We claim the
pipeline, not phone detection. Those numbers set what it is allowed to do: it
nudges, and stopping the study clock on its "phone" call is a switch the user
turns on, off by default. The clock-stop that IS on by default is triggered by
the reliable PRESENCE head — fifteen unbroken seconds of "away" — and stopping
the clock releases the lock rather than adding one.

Reused, not trained by us: MediaPipe BlazeFace (face detection) and MobileNetV2
alpha-0.50 (ImageNet features, Apache-2.0). Both run locally under
TensorFlow.js on the CPU backend. Webcam frames are never uploaded, there is no
hosted inference anywhere in the app, and "uncertain" never triggers a
desk-only kill.

Build-time: Cursor Cloud Agents (Grok 4.6) implemented parallel workstreams
from prompt-pack/ (foundation, UI, window monitor, desk-ai, policy, process
kill, session wiring, this packaging). Claude Code (Opus 5) ran the
Windows-only paths on a real Windows machine and fixed what the Linux-built
tests could not see (the foreground-window reader, the live process-kill
probe, the README stills), built the Focus Forecast pipeline and the browser
demo, and merged the two fuse models into one authority. Adaption Labs'
Adaptive Data produced the attention-head labels (210 credits) and is an
optional, off-by-default augmentation path for the forecast dataset — the
shipped forecast weights were trained without it. ⟦Add any ChatGPT / Copilot /
other assistants and what they wrote.⟧

⟦Team: list every contributor.⟧ We did not submit a reskin of a chatbot or a
cloud vision demo. Original work is the enforcement loop and the forecast that
front-runs it: window match + desk presence → risk → pre-armed fuse →
force-quit blocklist apps, never the study PC.
```

---

## 2. In-product AI/ML (filled from this repo)

| Piece | What we used | Role in the product |
| --- | --- | --- |
| **Forecast head — trained here** | `mlp24-36-1`: 937-param tanh MLP, 24 features → 36 hidden → 1 logit + Platt calibration. `src/shared/forecast/weights.json` | Risk 0..1 at 1 Hz → nudge at 0.50, pre-arm at 0.65. Its only authority over enforcement is **shortening** `countdownSec`, never lengthening it |
| **Forecast training data** | Our own simulator (`scripts/forecast/simulate.ts`): 240 synthetic sessions to train; a disjoint 900-session / 1 230-onset / 1.58 M-frame corpus to score | Fully synthetic, generated on the machine. No student data was collected, bought or scraped |
| **Adaptive fuse — trained here, on-device** | 17-feature logistic over `src/shared/adapt`, fitted prior + online per-install updates. Weights in the user's data dir (`adaptive-model.json`) | Picks the personalised fuse length that clears `RECOVERY_TARGET` 0.85. Labels are the app's own outcomes; no annotation, no upload, no network |
| **Fuse authority** | `src/main/session/fuseAuthority.ts`, pure | `prearmed ? clamp(round(personal × 0.5), 3, personal) : personal`. One number reaches the policy engine; the engine itself is untouched by either model |
| **Desk head — trained here** | 64-32 MLP over BlazeFace (4 crops) + MobileNetV2 + hand-crafted descriptors. `src/main/desk/model/weights/desk-head.json` (~1.7 MB) | Opt-in `deskModelId: "custom"`. 95.16% held-out 3-way vs 46.89% for the heuristic baseline. Caveats in `docs/CUSTOM-MODEL.md` |
| **Attention head — trained here** | 16-unit head on the same 1280-d slice. `src/main/desk/model/weights/attention-head.json`, labels `datasets/desk-attention-labels.csv` (Adaption Labs) | `focused` / `unfocused` / `phone`, consulted only when presence says `at_desk`. Drives the nudge; **never** an input to a kill, on its own or otherwise. Its `phone` call can also stop the study clock, off by default; `unfocused` never can. **Below the always-`focused` baseline on the original eval — see § 2a** |
| Face detector — **pretrained, reused** | MediaPipe **BlazeFace** via `@tensorflow-models/blazeface` + `@tensorflow/tfjs-core` (CPU) | Webcam frames → face box / probability / landmarks. The default desk path, and a feature source for the trained heads |
| Scene backbone — **pretrained, reused** | MobileNetV2 alpha 0.50 / 160 px ImageNet feature vector (TF Hub graph model, Apache-2.0), committed under `src/main/desk/model/weights/mobilenet/` | 1280-d scene vector into the desk and attention heads |
| Heuristic classifier | `src/main/desk/classify.ts` | Default `blazeface` path: detector output + occlusion stats → `DeskSnapshot` `{ at_desk \| away \| uncertain, confidence }` |
| Runtime | Local Electron main process; weights under `src/main/desk/models/`, `src/main/desk/model/weights/`, `src/shared/forecast/` | No hosted inference API. The browser demo runs the same `weights.json` in-tab |
| Policy | Pure `PolicyEngine` | High-conf **away** can start a kill fuse on blocklist apps. **Uncertain** or webcam-off cannot desk-only kill. Strict on-task = allowlisted window **and** at-desk. Attention readings never reach it |
| Drift pause | `src/main/session/nudge.ts` + `useSessionTimer` | 15 s of confirmed **away** (trained presence head, switch on by default) or 30 s of confirmed **phone** (attention head, switch off by default) stops the study clock until the student restarts it. Both need `deskModelId: "custom"`: attention does not exist without it, and `deskModelMayPauseOnAway` refuses an `away` pause on the shipped `blazeface` detector, which is 42.1% precise on that call against the trained head's 92.5% — so **a default install never stops the clock**, it only nudges. Never while a kill countdown burns either, because stopping the clock stops the session and would discard the fuse (`DriftPolicy.fuseBurning`). It **releases** the lock, exactly as the Pause button does, and adds no rule to `PolicyEngine`. `uncertain` never counts. `docs/CONTRACTS.md § Drift pause` |
| Data leaving the device | None | Frames stay local, the forecast is local, the fuse model is local, no telemetry |

**Why this counts for AI/ML Integration (20%):** the models decide the kill. Without Desk AI, walking away with Discord in the background is unenforceable; without the forecast, the fuse only starts after the violation; without the adaptive fuse, everyone gets the same ten seconds whether or not ten seconds is enough for them. None of it is a “smart webcam widget”.

**Reproduce, offline, no keys:** `npm run forecast:pipeline` regenerates the forecast weights and their eval report end to end (~7.5 min, deterministic under `--seed`). `npm run gauntlet:adapt` re-runs the adaptive-fuse simulation. The desk and attention heads reproduce from `scripts/desk-model/` once `FOCUSPLUG_DESK_DATA` points at the released image pack — see `docs/CUSTOM-MODEL.md`. Fixture check for the vision path: `npm run test:desk` plus `src/main/desk/fixtures/` (MediaPipe portrait, Unsplash empty interior, synthetic covered/noise frames), attribution in `src/main/desk/fixtures/ATTRIBUTION.txt`.

### 2a. Say these carefully — the numbers that are easy to overclaim

- **The forecast is simulated end to end.** Training streams and the 900-session evaluation corpus both come from our sampler. Say “held out on a disjoint simulated corpus”, never “held out on students”. What *is* real: the disjoint seed namespace, the three published contamination barriers, the session-clustered bootstrap CIs, and the CI gate that fails the build if a plain logistic regression on the same features beats the shipped head.
- **The adaptive fuse has two numbers with two meanings.** The shipped prior is fitted on `datasets/focusplug-drifts.csv` — **9,600 simulated drifts from a hand-written sampler**, held-out log-loss 0.6225 → 0.5600 — and it recovers the simulator's assumptions, not students'. `npm run gauntlet:adapt` reports 77.5% recovered at 8.4 s waited vs the constant fuse's 69.4% at 9.4 s, again against simulated students, and the script prints the whole constant-fuse curve so nothing is hidden. Those two figures are reproducible — the probe draw is seeded (`PROBE_SEED`), because unseeded it moved between 75.8% and 78.0% run to run and anything quoted from it was a sample, not a result. The **per-user** model is the actual claim and it has no number yet: if you have not run sessions with it, say “it learns on-device” and quote no accuracy.
- **95.16% is a dataset number, not your webcam.** It is 3-way accuracy on a held-out split of 3rd-person stock imagery, while the runtime camera is 1st-person. The Edinburgh (`nc`) slice is temporally interleaved with its training split, so quote the diverse-scene figure, 89.44%, when a judge pushes. And say which desk model you filmed with: `deskModelId` defaults to `blazeface`.
- **The attention head is not a phone detector.** Original 143-image eval: first head 56.6%, shipped head 60.8%, always-`focused` baseline **65.7%** — the head is *below* the baseline there. Current 200-image eval: 64.0% (phone F1 68.5%) against a 48.5% baseline, at the cost of calling “phone” on about 17% of non-phone photos. It ships because the *pipeline* is real and opt-in, and because of what it is allowed to do: on a default install it does nothing at all (attention needs `deskModelId: "custom"`), and on the custom model it raises a nudge. Its "phone" call can additionally stop the study clock, but `pauseOnPhoneEnabled` ships **off** for exactly the numbers above and then wants five readings across thirty seconds above a floor held above the presence head's; its "unfocused" call can never stop the clock at any setting. The other clock-stop, `away`, is the presence head's and not this one — and it is not on by default either: it needs `deskModelId: "custom"` too, because the trained presence head is 92.5% precise on `away` and the shipped BlazeFace detector is 42.1% (`deskModelMayPauseOnAway`). **On a default install nothing stops the clock**, and a stopped clock releases the lock rather than adding one (`docs/CONTRACTS.md § Drift pause`). Never say the attention head enforces anything: the process kill has never taken an attention reading as an input. Say “the pipeline”, never “it detects your phone”. The Settings → Test nudge buttons are demo triggers, like Demo Kill. `npm run capture:attention` records self-labelled first-person webcam clips into the same CSV to narrow the 3rd-person/1st-person gap, but **one clip is one independent sample** however many frames it holds: after the six-clip protocol the honest line is “adapted toward first-person, measured on 3 eval clips”, and `eval-attention.ts` refuses to print a first-person accuracy below that (`docs/CUSTOM-MODEL.md § First-person capture`). It does not earn a new headline number.
- **The browser demo cannot enforce anything.** `dist/demo/index.html` runs the real weights, features, escalation reducer and policy engine, and then *renders* the kill decision. A browser tab cannot force-quit a process or cut a plug; the Windows app is what executes. The page says so in its own footer, and so should you.
- **Smart plugs ship but boot with none configured.** Kasa (local 9999 XOR), Tapo (KLAP) and generic HTTP adapters are wired to kill, unlock, nudge and Demo Kill, with the study PC hard-denied (`docs/SMART-PLUGS.md`). CI verifies them against mocks and loopback. Claim hardware only if you demoed a plug on your LAN.

### 2b. Adaption Labs — two separate uses, one of them shipped

| Use | Shipped? | Detail |
| --- | --- | --- |
| **Attention-head labels** | **Yes — in the committed weights** | `scripts/desk-model/adaption-label.py` sent 1,919 desk photos (downscaled, filenames hidden because they carry the pack's own label) to Adaptive Data's multimodal run with one fixed instruction; a 100-image pilot was eyeballed first and caught a prompt flaw. 210 credits. Output: `datasets/desk-attention-labels.csv`. Truth for that head is Adaption's annotation, not a human label — say so. The file now holds 2,144 rows and only 1,919 of them are Adaption's: the other 225, under `attention-proxies/`, are stock photographs labelled by the search-query bucket they were collected in, and Adaption never saw them. (The schema also allows `first-person/` rows — webcam clips recorded by `npm run capture:attention` and labelled by the declaration made before recording, so no annotator human or model sees them either — but **none are committed**; that tool appends them on the recorder's own machine.) **Nothing Adaption did not label is in the shipped weights**: the head that ships is trained with `--exclude-proxies`, and training on the proxies was tried, measured over five seeds and rejected (`docs/CUSTOM-MODEL.md`) |
| **Forecast dataset augmentation** | **No** | `npm run forecast:data -- --adaption` can upload only the TRAIN-split seed; eval rows never leave the machine. The committed report carries `"mode": "offline"` and `adaptionMergedRows: 0` — the shipped weights were trained without it. A live key test on 2026-09-12 returned HTTP 403; the pipeline printed one WARN, fell back to local augmentation and exited 0. `docs/FORECAST.md § Adaption Labs integration` |

**Not in the MVP (do not claim on Devpost):** cloud Vision API, pose or skeleton tracking, phone camera, macOS support, any hosted inference. No data was collected from users or teammates either — the forecast and fuse corpora are synthetic, and the desk pack is licensed third-party imagery of people (§4), which is a licence obligation, not a privacy-free claim.

---

## 3. Build-time AI (template)

| Tool | Used? | How (be specific) |
| --- | --- | --- |
| Cursor Cloud Agents / Cursor IDE (Grok 4.6) | Yes — git author `Cursor Agent` on workstream PRs | Scaffold, UI, monitors, policy, killer, session wiring, Hyperbloom docs |
| Claude Code (Opus 5) | Yes | Windows verification pass (fixed the Win32 foreground reader — `$pid` collided with PowerShell's constant `$PID`, so the window sensor reported nothing on Windows — added `win32.test.ts` + a live window probe, fixed the process-kill probe stand-in, generated `docs/screenshots/`); the Focus Forecast pipeline, model and browser demo; the adaptive-fuse wiring; the fuse-authority merge of the two |
| Adaption Labs — Adaptive Data | Yes, build-time only | Annotated 1,919 desk photos for the attention head (§ 2b). Optional, off-by-default augmentation path for the forecast dataset, not used for the shipped weights |
| GitHub Copilot | ⟦yes/no⟧ | ⟦e.g. inline completions in VS Code⟧ |
| ChatGPT (specify model) | ⟦yes/no⟧ | ⟦e.g. README outline, not in-product⟧ |
| Image / video generators | ⟦yes/no⟧ | ⟦the demo intro montage was assembled with HyperFrames from real captures — name anything generated⟧ |
| Other APIs (OpenAI, Gemini, Groq, …) | No in the running app | On-device TFJS + plain arithmetic only. The only external services in the repo are the two Adaption Labs paths in § 2b, both build-time |

---

## 4. Datasets, weights, third-party assets

| Asset | Source / licence | Use |
| --- | --- | --- |
| BlazeFace graph | TensorFlow Hub / MediaPipe (`tensorflow/blazeface`), vendored in-repo | On-device detect (default desk path + trained-head features) |
| MobileNetV2 feature vector (alpha 0.50, 160 px) | Google, TF Hub graph model, **Apache-2.0**, vendored in-repo | Scene features into the desk and attention heads |
| `desk-data-v2-full` pack, `main` bucket (diverse stock imagery) | FocusPlug GitHub release, 3 500 labeled frames, **never committed** | Train / eval the desk head |
| `desk-data-v2-full` pack, `nc` bucket (Edinburgh office webcam frames, Fisher et al.) | **CC BY-NC-SA** — non-commercial use only, fine for this hackathon build; **never committed**, only learned weights ship | Train / eval the desk head |
| `desk-data-v3-distracted` release (342 phone photos) | FocusPlug GitHub release, **never committed** | Retrain the attention head |
| `desk-data-attention-proxies-hq` release (225 photographs against the attention head's failure modes) | 224 **Pexels licence** + 1 **public domain** (Wikimedia); NC and ND excluded when the set was built. Per-photograph licence, photographer and source URL committed in `datasets/desk-attention-proxies.csv` and repeated in each row's `note`. Images **never committed** | Held-out proxy eval for the attention head. Training on them was tried and **rejected**, so no shipped weight comes from them |
| `datasets/desk-attention-labels.csv` | 2,144 rows: 1,919 Adaption Labs Adaptive Data annotations (model-labelled, not human), plus 225 stock proxies labelled by their collection bucket and any first-person clips labelled by declaration | Attention-head training labels; the shipped head trains on the Adaption rows only (`--exclude-proxies`) |
| `src/main/desk/model/weights/attention-head.json` + `.metrics.json` | Trained in-repo by `scripts/desk-model/train-attention.ts` | On-device focused / unfocused / phone head, with its own metrics file |
| Forecast corpus | Generated by `scripts/forecast/simulate.ts` — synthetic, no third-party data, gitignored under `data/forecast/` | Train / eval the forecast head |
| `datasets/focusplug-drifts.csv` | 9,600 drifts from our own sampler — synthetic | Fit the adaptive fuse's shipped prior |
| `src/renderer/src/assets/land.json` | Natural Earth 1:110m coastlines (public domain), regenerated by `scripts/build-land.mjs` | The Flight face's globe — bundled, so no map tiles and no API key |
| `face.jpg` | MediaPipe public portrait test asset | Desk-ai gauntlet fixture |
| `empty.jpg` | Unsplash interior photo (see ATTRIBUTION) | Away / no-face fixture |
| `covered.jpg` / `noise.jpg` | Synthetic ffmpeg frames | Occlusion / sensor-static |

> We thank the University of Edinburgh for the use of the low resolution video and ground truth data.

---

## 5. Team + survey

| Field | Value |
| --- | --- |
| Project | FocusPlug |
| Repo | https://github.com/sahibsinghCS/FocusPlug |
| Contributors | ⟦full names as they should appear on Devpost⟧ |
| Hyperbloom room | September 2026 — AI/ML: Build Intelligence |
| Deadline | 14 Sep 2026, 5:00pm EDT |
| Post-event tool survey | ⟦required by Hyperbloom — complete after submit⟧ |

---

## 6. Pre-submit checklist

- [ ] Paragraph in §1 matches tools you actually used
- [ ] **All four** trained models named — forecast, adaptive fuse, desk head, attention head — with the numbers this repo actually prints (0.9330 lead≥20 s AUC; 77.5% / 8.4 s; 95.16% 3-way; 60.8% vs a 65.7% baseline)
- [ ] Nothing this repo trained is described as third-party or "just an API"
- [ ] Pretrained backbones (BlazeFace, MobileNetV2) called reused, not trained — no claim of training either from scratch
- [ ] Forecast said to be trained **and evaluated on simulated sessions**; the adaptive fuse's prior said to be simulated too
- [ ] Desk-head caveats from `docs/CUSTOM-MODEL.md` not dropped (the `nc` split is temporally interleaved; eval imagery is 3rd-person, runtime is 1st-person)
- [ ] Attention head presented as a pipeline that is not reliable yet, with the below-baseline number said out loud — never as phone detection
- [ ] What the attention head is *allowed* to do stated with the numbers: nudge always, stop the clock only if the user switches it on (`unfocused` never), and nothing at all on a default install
- [ ] The clock-stop credited to the head that earns it — `away` from the presence head is the one on by default — and described as **releasing** the lock, not adding one
- [ ] The 225 stock proxies credited (Pexels / public domain) and reported as a **negative** result: measured over five seeds, rejected, no shipped weight from them
- [ ] Adaption Labs split correctly: labels **shipped** in the attention head; forecast augmentation **not used** for the shipped weights
- [ ] Edinburgh `nc/` data credited and its CC BY-NC-SA / non-commercial limit stated
- [ ] No claim that webcam frames are uploaded
- [ ] Desk AI described as a **kill input**, not a filter / avatar; the forecast as a **fuse-length input**, not an autonomous killer
- [ ] The browser demo described as rendering the kill decision, not executing it
- [ ] Coding assistants listed (Hyperbloom asks what AI tools you used **and how**)
- [ ] Every teammate named
- [ ] Stretch ideas (macOS) not presented as shipped; smart plugs claimed only if demoed on a real LAN plug
