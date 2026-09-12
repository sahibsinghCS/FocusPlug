# AI tools disclosure (Hyperbloom template)

Paste the **filled** sections into Devpost’s “AI Tools Disclosure” field. Hyperbloom allows existing models; the bar is that AI/ML is **central**, not bolted on.

Keep two stories distinct:

1. **In-product ML** — Desk AI is a policy input (kill / no-kill).
2. **Build-time assistants** — coding agents used to write this repo.

Do not list a tool you did not use. Bracketed `⟦ ⟧` lines are blanks for the submitting team.

---

## 1. One-paragraph paste (edit, then copy)

```
FocusPlug’s load-bearing model is on-device MediaPipe BlazeFace (TensorFlow.js,
CPU backend) on the local webcam. It labels at_desk / away / uncertain with a
confidence score; the session policy uses those labels to start or refuse a
kill countdown. Frames are not uploaded. Uncertain never triggers a desk-only
kill. We did not train a new backbone.

Build-time: Cursor Cloud Agents (Grok 4.6) implemented parallel workstreams
from prompt-pack/ (foundation, UI, window monitor, desk-ai, policy, process
kill, session wiring, this packaging). Claude Code (Opus 5) then ran the
Windows-only paths on a real Windows machine and fixed what the Linux-built
tests could not see: the foreground-window reader, the live process-kill probe,
and the README stills. ⟦Add any ChatGPT / Copilot / other assistants and what
they wrote.⟧

⟦Team: list every contributor.⟧ We did not submit a reskin of a chatbot or a
cloud vision demo. Original work is the enforcement loop: window match + desk
presence → fuse → force-quit blocklist apps, never the study PC.
```

---

## 2. In-product AI/ML (filled from this repo)

| Piece | What we used | Role in the product |
| --- | --- | --- |
| Face detector | MediaPipe **BlazeFace** via `@tensorflow-models/blazeface` + `@tensorflow/tfjs-core` (CPU) | Webcam frames → face box / probability / landmarks |
| Runtime | Local Electron main process, model files under `src/main/desk/models/blazeface/` | No hosted inference API |
| Classifier | `src/main/desk/classify.ts` | Maps detector output + occlusion stats → `DeskSnapshot` `{ at_desk \| away \| uncertain, confidence }` |
| Policy | Pure `PolicyEngine` | High-conf **away** can start a kill fuse on blocklist apps. **Uncertain** or webcam-off cannot desk-only kill. Strict on-task = allowlisted window **and** at-desk |
| Data leaving the device | None for vision | Frames stay local |

**Why this counts for AI/ML Integration (20%):** without Desk AI, walking away with Discord in the background would not be enforceable. The model is not a “smart webcam widget.”

**Fixture / eval (not a user feature):** `npm run test:desk` plus `src/main/desk/fixtures/` (MediaPipe portrait, Unsplash empty interior, synthetic covered/noise frames). See `src/main/desk/fixtures/ATTRIBUTION.txt`.

**Not in the MVP (do not claim on Devpost):** cloud Vision API, pose/skeleton tracking, phone camera, macOS support.

**Shipped since this doc was first written:**

- **Nudges and an attention head.** A sustained phone or looking-away reading, or a blocked app, brings FocusPlug to the front with the timer and a motivational line, and in plug mode `nudge` (the default) switches enabled plugs on. Phone / looking-away come from a second head on the custom desk model, trained on labels **Adaption Labs' Adaptive Data** produced by looking at the desk-data pack's stock photos. That head is **not reliable yet**: 56.6% held-out, below the always-"focused" baseline of 65.7% (`docs/CUSTOM-MODEL.md`). Say "the pipeline", never "it detects your phone". The Settings → Test nudge buttons are demo triggers, like Demo Kill.
- **A trained custom desk model** (#23): BlazeFace crops + a MobileNetV2-0.50-160 ImageNet feature vector into a trained MLP head, weights committed under `src/main/desk/model/weights/`, 95.16% on a 723-image held-out split (`docs/CUSTOM-MODEL.md`). It is **opt-in** — `deskModelId` defaults to `blazeface`, so say which model you filmed with. The 95.16% is a held-out *dataset* number; it is not a measurement of live webcam accuracy on your desk.
- **An adaptive fuse — a second model, learned on-device.** The countdown length is no longer the fixed Settings number: a 17-feature logistic model predicts P(you fix this yourself | this moment, a fuse of N seconds) and picks the shortest fuse still clearing 85%. It trains on labels the app already produces — `cancel_countdown` is a recovery and its timing says *how long you needed*, `kill` is a failure with longer fuses left censored — so **it needs no annotation and no dataset**. Weights live in the user's own data dir; nothing is uploaded, and there is no network call on this path.

  Say this carefully. Two numbers, two meanings:
  - The **shipped prior** (day one, before it has seen you drift) is fitted on `datasets/focusplug-drifts.csv` — **9,600 simulated drifts from a hand-written sampler**, not people. Held-out log-loss 0.6225 → 0.5600. It recovers the simulator's assumptions and is **not** evidence about students.
  - `npm run gauntlet:adapt` reports 77.2% right at 8.5 s waited per drift vs the fixed fuse's 69.4% at 9.4 s. That is **a simulation against simulated students**, and the script prints the whole constant-fuse curve so nothing is hidden.
  - The **per-user** model is the actual claim, and it has no number yet: it only learns from real drifts on a real machine. If you have not run sessions with it, say "it learns on-device" and do not quote an accuracy.

- **LAN smart plugs** — Kasa (local 9999 XOR) and generic HTTP adapters, wired to kill/unlock and Demo Kill, with the study PC hard-denied (`docs/SMART-PLUGS.md`). Claim them as working *only* if you demo them with a plug on your LAN; the app ships with zero plugs configured.

---

## 3. Build-time AI (template)

| Tool | Used? | How (be specific) |
| --- | --- | --- |
| Cursor Cloud Agents / Cursor IDE (Grok 4.6) | Yes — git author `Cursor Agent` on workstream PRs | Scaffold, UI, monitors, policy, killer, session wiring, Hyperbloom docs |
| GitHub Copilot | ⟦yes/no⟧ | ⟦e.g. inline completions in VS Code⟧ |
| ChatGPT (specify model) | ⟦yes/no⟧ | ⟦e.g. README outline, not in-product⟧ |
| Claude Code (Opus 5) | Yes | Windows verification pass: fixed the Win32 foreground reader (`$pid` collided with PowerShell's constant `$PID`, so the window sensor reported nothing on Windows), added `win32.test.ts` + a live window probe, fixed the process-kill probe stand-in so `tasklist`/`taskkill` are exercised on Windows, generated `docs/screenshots/` |
| Image / video generators | ⟦yes/no⟧ | ⟦none expected; screenshots should be the real app⟧ |
| Other APIs (OpenAI, Gemini, Groq, …) | No in the running app | Desk AI is local TFJS only |

---

## 4. Datasets, weights, third-party assets

| Asset | Source | Use |
| --- | --- | --- |
| BlazeFace graph | TensorFlow Hub / MediaPipe (`tensorflow/blazeface`), vendored in-repo | On-device detect |
| `face.jpg` | MediaPipe public portrait test asset | Desk-ai gauntlet fixture |
| `empty.jpg` | Unsplash interior photo (see ATTRIBUTION) | Away / no-face fixture |
| `covered.jpg` / `noise.jpg` | Synthetic ffmpeg frames | Occlusion / sensor-static |
| `datasets/desk-attention-labels.csv` | Adaption Labs Adaptive Data annotations of desk-data pack photos (model-labelled, not human) | Attention head training labels |
| `model/weights/attention-head.json` | Trained in-repo by `scripts/desk-model/train-attention.ts` | On-device focused / unfocused / phone head |

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
- [ ] No claim of training BlazeFace from scratch
- [ ] No claim that webcam frames are uploaded
- [ ] Desk AI described as a **kill input**, not a filter / avatar
- [ ] Coding assistants listed (Hyperbloom asks what AI tools you used **and how**)
- [ ] Every teammate named
- [ ] Stretch ideas (macOS) not presented as shipped; smart plugs claimed only if demoed on a real LAN plug
