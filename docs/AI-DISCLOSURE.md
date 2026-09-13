# AI tools disclosure (Hyperbloom template)

Paste the **filled** sections into Devpost’s “AI Tools Disclosure” field. Hyperbloom allows existing models; the bar is that AI/ML is **central**, not bolted on.

Keep two stories distinct:

1. **In-product ML** — two models trained in this repo (the Focus Forecast risk head, the custom desk head) plus a reused pretrained detector. All of them are policy inputs: kill / no-kill / how long the fuse is.
2. **Build-time assistants** — coding agents used to write this repo.

Do not list a tool you did not use. Bracketed `⟦ ⟧` lines are blanks for the submitting team.

---

## 1. One-paragraph paste (edit, then copy)

```
FocusPlug ships two models we trained ourselves, both running on-device.

(1) Focus Forecast — a 937-parameter tanh MLP (mlp24-36-1: 24 behavioral
features → 36 hidden units → 1 logit, Platt-calibrated) that scores drift risk
once a second off the local telemetry ring and pre-arms the enforcement fuse
(10 s → 5 s) before any rule has been broken. Trained offline in-repo by
`npm run forecast:pipeline` on behavior streams from our own session simulator,
then scored on a disjoint 900-session / 1 230-onset corpus: lead≥20 s AUC 0.9330
against the 0.9259 logistic baseline this repo's own CI gate enforces. No human
data, no cloud call, no pretrained weights.

(2) Desk head (deskModelId: "custom") — a 64-32 MLP we trained on the
desk-data-v2 image pack (3 500 labeled frames) over a stacked feature vector:
MediaPipe BlazeFace across four crops, a MobileNetV2 ImageNet feature vector,
and hand-crafted luma / color / gradient descriptors. 95.16% held-out 3-way
accuracy on 723 images, against 46.89% for the BlazeFace heuristic baseline.
Only the learned weights ship; the training images never do. It is opt-in — the
default desk model is BlazeFace plus heuristics.

Reused, not trained by us: MediaPipe BlazeFace (face detection) and MobileNetV2
alpha-0.50 (ImageNet features, Apache-2.0). Both run locally under
TensorFlow.js on the CPU backend. Webcam frames are never uploaded, there is no
hosted inference anywhere in the app, and `uncertain` never triggers a
desk-only kill.

Build-time: Cursor Cloud Agents (Grok 4.6) implemented parallel workstreams
from prompt-pack/ (foundation, UI, window monitor, desk-ai, policy, process
kill, session wiring, this packaging). ⟦Add any ChatGPT / Copilot / Claude /
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
| **Forecast head — trained here** | `mlp24-36-1`: 937-param tanh MLP, 24 features → 36 hidden → 1 logit + Platt calibration. `src/shared/forecast/weights.json` | Risk 0..1 at 1 Hz → nudge at 0.50, pre-arm at 0.65. Its only authority over enforcement is shortening `countdownSec` (10 s → 5 s), never lengthening it |
| **Forecast training data** | Our own simulator (`scripts/forecast/simulate.ts`): 240 synthetic sessions to train; a disjoint 900-session / 1 230-onset / 1.58 M-frame corpus to score | Fully synthetic, generated on the machine. No student data was collected, bought or scraped |
| **Desk head — trained here** | 64-32 MLP over BlazeFace (4 crops) + MobileNetV2 + hand-crafted descriptors. `src/main/desk/model/weights/desk-head.json` (~1.7 MB) | Opt-in `deskModelId: "custom"`. 95.16% held-out 3-way vs 46.89% for the heuristic baseline. Caveats in `docs/CUSTOM-MODEL.md` |
| Face detector — **pretrained, reused** | MediaPipe **BlazeFace** via `@tensorflow-models/blazeface` + `@tensorflow/tfjs-core` (CPU) | Webcam frames → face box / probability / landmarks. The default desk path, and a feature source for the trained head |
| Scene backbone — **pretrained, reused** | MobileNetV2 alpha 0.50 / 160 px ImageNet feature vector (TF Hub graph model, Apache-2.0), committed under `src/main/desk/model/weights/mobilenet/` | 1280-d scene vector into the desk head |
| Heuristic classifier | `src/main/desk/classify.ts` | Default `blazeface` path: detector output + occlusion stats → `DeskSnapshot` `{ at_desk \| away \| uncertain, confidence }` |
| Runtime | Local Electron main process; weights under `src/main/desk/models/`, `src/main/desk/model/weights/`, `src/shared/forecast/` | No hosted inference API. The browser demo runs the same `weights.json` in-tab |
| Policy | Pure `PolicyEngine` | High-conf **away** can start a kill fuse on blocklist apps. **Uncertain** or webcam-off cannot desk-only kill. Strict on-task = allowlisted window **and** at-desk |
| Data leaving the device | None | Frames stay local, the forecast is local, no telemetry |

**Why this counts for AI/ML Integration (20%):** the models decide the kill. Without Desk AI, walking away with Discord in the background is unenforceable; without the forecast, the fuse only starts after the violation. Neither is a “smart webcam widget”.

**Reproduce, offline, no keys:** `npm run forecast:pipeline` regenerates the forecast weights and their eval report end to end (~7.5 min, deterministic under `--seed`). The desk head reproduces from `scripts/desk-model/` once `FOCUSPLUG_DESK_DATA` points at the released image pack — see `docs/CUSTOM-MODEL.md`. Fixture check for the vision path: `npm run test:desk` plus `src/main/desk/fixtures/` (MediaPipe portrait, Unsplash empty interior, synthetic covered/noise frames), attribution in `src/main/desk/fixtures/ATTRIBUTION.txt`.

**Optional external API — not used for the shipped numbers.** `npm run forecast:data -- --adaption` can upload only the TRAIN-split seed to Adaption Labs for augmentation; eval rows never leave the machine. The committed report carries `"mode": "offline"` — the shipped weights were trained without it. A live key test on 2026-09-12 returned HTTP 403; the pipeline printed one WARN, fell back to local augmentation and exited 0. Details in `docs/FORECAST.md § Adaption Labs integration`.

**Not in the MVP (do not claim on Devpost):** cloud Vision API, pose or skeleton tracking, phone camera, Mac support. No data was collected from users or teammates either — the forecast corpus is synthetic and the desk pack is licensed third-party imagery of people (§4), which is a licence obligation, not a privacy-free claim. Smart-plug cut *does* ship (Kasa / generic-HTTP LAN controller wired into kill, unlock and Demo Kill) but boots with zero plugs configured and is CI-verified against mock + loopback only — present it as shipped-and-optional, not as demoed on hardware you have not probed.

---

## 3. Build-time AI (template)

| Tool | Used? | How (be specific) |
| --- | --- | --- |
| Cursor Cloud Agents / Cursor IDE (Grok 4.6) | Yes — git author `Cursor Agent` on workstream PRs | Scaffold, UI, monitors, policy, killer, session wiring, Hyperbloom docs |
| GitHub Copilot | ⟦yes/no⟧ | ⟦e.g. inline completions in VS Code⟧ |
| ChatGPT (specify model) | ⟦yes/no⟧ | ⟦e.g. README outline, not in-product⟧ |
| Claude / other LLM | ⟦yes/no⟧ | ⟦tasks⟧ |
| Image / video generators | ⟦yes/no⟧ | ⟦none expected; screenshots should be the real app⟧ |
| Other APIs (OpenAI, Gemini, Groq, …) | No in the running app | On-device TFJS + plain arithmetic only. The one external API in the repo is the optional Adaption Labs augmentation path above, which is build-time and off by default |

---

## 4. Datasets, weights, third-party assets

| Asset | Source / licence | Use |
| --- | --- | --- |
| BlazeFace graph | TensorFlow Hub / MediaPipe (`tensorflow/blazeface`), vendored in-repo | On-device detect (default desk path + desk-head features) |
| MobileNetV2 feature vector (alpha 0.50, 160 px) | Google, TF Hub graph model, **Apache-2.0**, vendored in-repo | Scene features into the trained desk head |
| `desk-data-v2-full` pack, `main` bucket (diverse stock imagery) | FocusPlug GitHub release, 3 500 labeled frames, **never committed** | Train / eval the desk head |
| `desk-data-v2-full` pack, `nc` bucket (Edinburgh office webcam frames, Fisher et al.) | **CC BY-NC-SA** — non-commercial use only, fine for this hackathon build; **never committed**, only learned weights ship | Train / eval the desk head |
| Forecast corpus | Generated by `scripts/forecast/simulate.ts` — synthetic, no third-party data, gitignored under `data/forecast/` | Train / eval the forecast head |
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
- [ ] Both trained heads named with the eval numbers the repo actually prints (0.9330 lead≥20 s AUC; 95.16% 3-way)
- [ ] Pretrained backbones (BlazeFace, MobileNetV2) called reused, not trained — no claim of training either from scratch
- [ ] Desk-head caveats from `docs/CUSTOM-MODEL.md` not dropped (the `nc` split is temporally interleaved; eval imagery is 3rd-person, runtime is 1st-person)
- [ ] Edinburgh `nc/` data credited and its CC BY-NC-SA / non-commercial limit stated
- [ ] No claim that webcam frames are uploaded
- [ ] Desk AI described as a **kill input**, not a filter / avatar; the forecast as a **fuse-length input**, not an autonomous killer
- [ ] Adaption Labs described as optional, build-time, and off for the shipped weights
- [ ] Coding assistants listed (Hyperbloom asks what AI tools you used **and how**)
- [ ] Every teammate named
- [ ] Stretch ideas (Mac) not presented as shipped; smart plugs presented as shipped-but-unprobed
