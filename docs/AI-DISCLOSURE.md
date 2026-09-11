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
kill, session wiring, this packaging). ⟦Add any ChatGPT / Copilot / Claude /
other assistants and what they wrote.⟧

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

**Not in the MVP (do not claim on Devpost):** custom-trained student-attention model, cloud Vision API, pose/skeleton tracking, phone camera, smart-plug kill (stretch only).

---

## 3. Build-time AI (template)

| Tool | Used? | How (be specific) |
| --- | --- | --- |
| Cursor Cloud Agents / Cursor IDE (Grok 4.6) | Yes — git author `Cursor Agent` on workstream PRs | Scaffold, UI, monitors, policy, killer, session wiring, Hyperbloom docs |
| GitHub Copilot | ⟦yes/no⟧ | ⟦e.g. inline completions in VS Code⟧ |
| ChatGPT (specify model) | ⟦yes/no⟧ | ⟦e.g. README outline, not in-product⟧ |
| Claude / other LLM | ⟦yes/no⟧ | ⟦tasks⟧ |
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
- [ ] Stretch ideas (Mac, smart plug) not presented as shipped
