# FocusPlug — 5-minute demo

**Target 5:00. Band 4:40–5:10.** Extends `DEMO-SCRIPT.md` (the 2:30 enforcement
cut), which stays the source of truth for the kill beats — every rule in its
*Hard fails* section still applies here.

The 2:30 script proves the product works. The extra 2:30 is where the AI, the
physical plug and the honest caveats go — the parts Hyperbloom actually scores.

**The through-line, said once before you record:** *"Every other focus timer
asks you to keep it. FocusPlug decides at-desk vs away on-device, and the kill
is how it keeps it for you."*

---

## 1. Record it in six pieces, not one take

This is the single most important instruction, because a HyperFrames editor
assembles clips by `data-start` / `data-duration` / `data-media-start`. Six
separate files means any beat can be re-shot or retimed without redoing the
rest. One 5-minute take means one fluffed line costs you everything.

| # | File | What it is | Length | Audio |
| --- | --- | --- | --- | --- |
| A | `focusplug-intro-hook.mp4` | **Already done.** `demo-intro/renders/` | 0:15 | final, do not touch |
| B | `02-enforcement.mp4` | Screen capture, **one continuous take** | ~2:00 | system audio on, no talking |
| C | `03-plug.mp4` | Screen capture: Demo Kill cutting the plug | ~0:20 | system audio on |
| D | `03b-plug-irl.mp4` | Phone/camera close-up: the lamp actually dying | ~0:15 | record the room |
| E | `04-proof.mp4` | Screen capture: terminal running the evals | ~0:45 | system audio on |
| F | `voiceover.wav` | **One clean pass, whole script, no picture** | ~4:00 | this is the spine |

**B must be continuous** — it is a causal chain (window → decision → fuse →
kill → log) and a judge can tell if it was cut together. Everything else can be
assembled.

**Record the voiceover separately and last.** Talk at your normal speed. The
intro audio you liked measured 167–193 wpm; the takes that sounded robotic were
71–126. Do not perform it, and do not narrate live over B — you want the freedom
to retime picture to voice, which is exactly how the intro got its sync.

**Capture settings:** 1920×1080, 30 fps, to match the intro composition. Slate
every take out loud ("B, take two") so the editor can find them. Add no music,
no transitions, no zooms in the recorder — all of that is HyperFrames' job.

Shoot 2–3 takes of B, C and D. They are the risky ones.

---

## 2. Pre-flight (not on camera)

Everything in `DEMO-SCRIPT.md` § Pre-flight, plus:

```powershell
npm run probe:golden        # must print GOLDEN PATH PROBE: PASS
npm run test:kill           # must be 25/25 on Windows
```

If `probe:golden` fails, the window sensor is dead on this machine and beat B is
unfilmable — fix that before anything else.

**Pin the fuse for a scripted take** so the overlay cannot read 30 while you say
"ten seconds":

```powershell
$env:FOCUSPLUG_NO_ADAPT = "1"; npm run dev
```

Drop the flag only if you would rather *show* the adaptation — it is the
stronger AI story, but then read the number off the overlay instead of scripting
it.

**Pick the desk model before you film, not during.** The app defaults to
`blazeface`. The 95.16% figure belongs to the **`custom`** model, so if you film
on the default you cannot say "this is the model we trained" about what is on
screen. Set it in the persisted settings file (`{ "deskModelId": "custom" }`) —
**not** through the Settings UI, see § Known traps — and give the Away beat an
extra beat or two, because custom samples at ~0.7 Hz instead of 4 Hz. That is
still 6–7 readings inside a 10 s fuse, which is enough.

**Plug, if you are filming D:**

```powershell
$env:FOCUSPLUG_TAPO_USERNAME = "you@example.com"
$env:FOCUSPLUG_TAPO_PASSWORD = "your-tp-link-password"
npm run probe:plugs -- --ip <plug-ip>          # prove the real P110M answers
npm run probe:plugs -- --ip <plug-ip> --off    # and that it actually cuts
```

Do this **before** you film. A P110M that has been re-handshaked too often trips
its local-auth throttle and reports "challenge did not match", which looks
identical to a wrong password. If the hardware misbehaves on the day, fall back
to `npm run mock:tapo` and say plainly that you are showing the driver against a
protocol simulator — that is still a real socket server exercising the real
handshake, and judges respect the distinction more than a silent fake.

Have `Demo Kill` ready as the rescue path for any beat that stalls. It lives in
the **lock-mode controls** and on the overlay as *Demo Kill — skip wait*.
(`DEMO-SCRIPT.md` still points at *Settings → Preview kill overlay* for this —
that control was removed. Ignore that line.)

---

## 2b. Known traps — read before you point a camera at the UI

Found by auditing the current branch. Each of these is on screen and will cost
you if a judge sees it.

| Trap | What happens | Do this |
| --- | --- | --- |
| **The Settings face grid is dead** | `SettingsPage` renders a 13-face picker that writes `settings.faceId`, which lock mode does not read. Click "Candle" on camera and **nothing happens**. | Pick faces only on the **Session** panel, which is the live one. Never scroll to the Settings face section. |
| **Settings ships internal copy** | Near the desk-model picker: *"Custom is Timmy's drop-in. Stub is a safe soak."* | Do not show the desk-model picker. Set `deskModelId` in the settings file instead, and present the model through its eval output. |
| **Faces the docs promise aren't in the app** | README/STATUS claim 13 faces incl. Movement, Line, Record. Lock mode ships 7, and four of those are marked *retired* in `src/shared/faces.ts`. | Demo the seven in the Session picker. If you want Movement/Line/Record on film, shoot them from `npm run faces:preview` (port 5174) and do not imply they are selectable in the app. |
| **`npm run eval:titles` looks catastrophic** | Prints 35.5% correct, **51.4% wrong**, 267 distractions called on-task. The set is adversarial by construction — it sizes a gap, it is not a grade. | **Do not run it on camera.** The three commands in § 5 are the ones to film. |
| **`.env` at the repo root is not loaded** | There is no `dotenv` and no loader; `klap.ts` reads `process.env` directly. Putting creds there does nothing. | Export them in the shell, as § 2 shows. Treat that file as secret — it may hold live TP-Link credentials. Never open it on camera and never commit it. |
| **The fuse pin is bash syntax in the old script** | `DEMO-SCRIPT.md` prints `FOCUSPLUG_NO_ADAPT=1 npm run dev`, which fails in PowerShell. Unpinned, the fuse hands out a **30 s** probe on ~45% of early drifts. | Use the PowerShell form in § 2. This is the single most likely take-ruiner. |
| **Stale `out/` build** | `npm start` may pair a new main process with an old renderer. | Film from `npm run dev`. |



---

## 3. The clock

| Time | Beat | Picture | Voice |
| --- | --- | --- | --- |
| **0:00–0:15** | Cold open | **A** — the headline montage, relay click, FOCUSPLUG | none (the cut carries itself) |
| **0:15–0:40** | The claim | **B** — session panel, faces previewing live | "A pomodoro counts minutes and dings. It doesn't close the distraction and it has no idea you left the chair. FocusPlug watches the window *and* the desk, and when you drift it takes the distraction away. Pick how you want to watch it run out — mine's a flight; fifty minutes is Dubai to Doha, landing when I'm free." |
| **0:40–1:00** | Setup | **B** — blocklist (Discord), settings: webcam on, strict on | "Allowlist the assignment. Blocklist Discord. The desk model runs on this machine — frames never leave the PC." |
| **1:00–1:12** | Arm | **B** — sit in frame, **hold** the switch, lock mode takes the screen | "Hold it — that's the commitment. Wheels up. Off the clock it only observes. A live round can kill." |
| **1:12–1:45** | Drift → kill | **B** — alt-tab to Discord, full-screen overlay counting down, then Discord quits | "I tabbed to Discord. Ten-second fuse. Go back to the doc and it cancels — I'm not going back." *(let the overlay play; say nothing over the last 3 seconds)* |
| **1:45–1:58** | Unlock | **B** — back to Docs, still in frame, overlay gone | "Back on the assignment, still at the desk. Unlocked. Strict mode needs both." |
| **1:58–2:22** | Desk AI | **B** — cover the lens or leave the chair → **Away** → blocklist apps quit | "This is the part a timer can't do. I left the desk. High-confidence Away kills blocked apps even if they were never in focus — and uncertain never kills on the camera alone." |
| **2:22–2:35** | The proof lives here | **B** — hold End, open **Log**: Window → Distracted → Countdown → Kill | "The log is the receipt. Sensor, decision, fuse, kill — same labels as the overlay." |
| **2:35–3:05** | **The plug** | **C** then **D** — Demo Kill, then the lamp going dark on camera | "And it doesn't stop at software. Demo Kill force-quits the blocked apps *and* cuts the plug. That's a TP-Link P110M on the LAN over KLAP — no vendor cloud. The study PC is the one thing it will never touch; that's a frozen contract, not a setting." |
| **3:05–4:05** | **How it actually works** | **E** or slides over B-roll | *see § 4* |
| **4:05–4:35** | **Proof on camera** | **E** — terminal | *see § 5* |
| **4:35–5:00** | Close | **D** or the lockup | "Two sensors, one decision, and a consequence you can hear. Every other timer asks you to keep it. This one keeps it for you." |

---

## 4. The AI beat (3:05–4:05) — do not cut this

Hyperbloom scores AI/ML as central, not decorative, and this is the minute where
you are not an LLM wrapper. Roughly 160 words at natural pace:

> "The camera call is a model we trained, not an API. It stacks three signal
> families — a BlazeFace detector run on the frame plus three crops so
> off-centre faces still fire, a MobileNet scene-feature vector, and about
> twenty hand-built descriptors: luma grids, gradient histograms, blur, skin
> tone. Two thousand dimensions into a small MLP head that outputs at-desk,
> away, or uncertain.
>
> Held-out, it's 95.2% three-way. The face-detector heuristic we started with
> was 46.9% — it can see a face, it can't tell you whether someone's *working*.
> All of it runs on-device: local graph models, plain arithmetic, no network
> calls, and the app's content policy is `default-src 'self'` — nothing can
> leave the machine.
>
> The fuse is learned too. It watches whether you actually come back after a
> drift and how fast, and it spends longer fuses on the drifts you recover from.
> On our sampler that's 77% recovery at eight and a half seconds, against 69% at
> nine and a half for a fixed countdown."

Show while you say it: the `docs/CUSTOM-MODEL.md` results table, the `test:desk`
output from beat E, or the Log with the fuse column. **Not** the Settings
desk-model picker — see § 2b.

Two precision points, because both are easy to overclaim:

- Say **"held-out on our eval set"**, not "95% accurate". It is a dataset
  number on 3rd-person stock images; the runtime camera is 1st-person.
- If you did not set `deskModelId: custom` before filming, the live run is the
  fast BlazeFace detector. In that case say the trained model is the selectable
  one and show its eval — do not narrate it over footage of the default.

---

## 5. Proof beat (4:05–4:35) — run it live

Three commands, on camera, in one terminal. Do not talk over the output.

```powershell
npm run test:desk        # desk gauntlet PASS — includes the missing-weights fallback
npm run gauntlet:adapt   # adaptive fuse: 77.2% / 8.5s vs constant 69.4% / 9.4s
npm run test             # full suite green
```

Then say the caveats out loud. **This is worth more than another feature:**

> "Honest about the numbers: the Edinburgh slice of that eval shares a camera
> with its training split, so the diverse-scene figure is the one to trust —
> 89%. And the fuse was fitted on simulated drifts, so it encodes our sampler's
> assumptions, not a real student's. Cold installs ship the plain Settings
> value until it has your data."

A judge who hears you volunteer that trusts the other numbers.

---

## 6. Hard fails (reshoot)

All of `DEMO-SCRIPT.md` § Hard fails, plus:

- You pitch the countdown without the kill in the same breath
- The plug beat shows a mock while you imply it is hardware
- You claim the eval figure without the caveat
- The AI minute becomes a settings tour instead of the model
- **A dead control is clicked on camera** — the Settings face grid (§ 2b)
- **The overlay reads 30 while you say "ten-second fuse"** — you forgot the pin
- You run long — 5:10 is the ceiling, and going over reads as not knowing what
  matters

---

## 7. Handing it to the editor

Put this in a folder with the six files and hand over:

- This document (the clock is the edit decision list)
- `focusplug-intro-hook.mp4` — **locked, do not re-cut**
- The take log: which take of B/C/D is the keeper
- `voiceover.wav`

Tell them the intro was built with HyperFrames and lives in `demo-intro/`:
`scripts/build_composition.py` + `scripts/template.html` generate `index.html`
(never hand-edit it), then `npm run render`. The same project can host the full
5-minute assembly — the montage is a `SCHEDULE` of cut points, and the intro's
own cuts are already locked to word onsets in its narration, which is the
pattern to repeat for the voiceover here.

**Two things that will bite the editor, both already solved in `demo-intro/`:**

1. The render mixer applies a fixed **+3.2 dB**. A 0.84-peak source comes back
   at 1.18 with clipped samples. `MASTER = 0.74` in `build_composition.py` is
   the headroom fix — check peak and clipped-sample count after any level
   change (`scripts/verify_audio.py`).
2. Cut on **word onsets**, not on a grid. Transcribe the voiceover to word level
   and place every cut on a word start; that is what made the intro feel locked
   rather than merely fast.
