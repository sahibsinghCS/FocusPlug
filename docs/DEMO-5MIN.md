# FocusPlug — 5-minute demo

**Target 5:00. Band 4:40–5:10.** Extends `DEMO-SCRIPT.md` (the 2:30 enforcement
cut), which stays the source of truth for the kill beats — every rule in its
*Hard fails* section still applies here.

> **Filming today, against the 2026-09-14 deadline?** Shoot
> [`DEMO-TODAY.md`](DEMO-TODAY.md) instead — the same story in about two minutes
> with no dead air, and it is the only one of the three that tells you how to
> get a plan card worth filming on a clean machine. Come back here for the
> five-minute assembly when there is time for one.

The 2:30 script proves the product works. The extra 2:30 is where the models,
the measurement and the honest caveats go — the parts Hyperbloom actually
scores.

**The through-line, said once before you record:** *"Every other focus timer
asks you to keep it. FocusPlug sees the drift coming, warns me, shortens the
fuse, kills the distraction, stops the clock when I walk away — and afterwards
tells me how long I actually held."*

**No hardware appears in this film.** Everything below runs on one Windows PC
and its own models: nothing to buy, nothing to fail on camera, nothing a judge
has to take on faith. Smart plugs still ship and are untouched — they are § 8,
an optional tag after the close that you can drop without leaving a hole.

---

## 1. Record it in four pieces, not one take

This is the single most important instruction, because a HyperFrames editor
assembles clips by `data-start` / `data-duration` / `data-media-start`. Four
separate files means any beat can be re-shot or retimed without redoing the
rest. One 5-minute take means one fluffed line costs you everything.

| # | File | What it is | Length | Audio |
| --- | --- | --- | --- | --- |
| A | `focusplug-intro-hook.mp4` | **Already done.** `demo-intro/renders/` | 0:15 | final, do not touch |
| B | `02-enforcement.mp4` | Screen capture, **one continuous take**: arm → drift → kill → away → log → debrief | ~2:45 | system audio on, no talking |
| C | `03-proof.mp4` | Screen capture: terminal running the evals | ~0:45 | system audio on |
| D | `voiceover.wav` | **One clean pass, whole script, no picture** | ~4:00 | this is the spine |

**B must be continuous** — it is a causal chain (window → decision → fuse →
kill → log → the number it measured) and a judge can tell if it was cut
together. Everything else can be assembled.

**Record the voiceover separately and last.** Talk at your normal speed. The
intro audio you liked measured 167–193 wpm; the takes that sounded robotic were
71–126. Do not perform it, and do not narrate live over B — you want the freedom
to retime picture to voice, which is exactly how the intro got its sync.

**Capture settings:** 1920×1080, 30 fps, to match the intro composition. Slate
every take out loud ("B, take two") so the editor can find them. Add no music,
no transitions, no zooms in the recorder — all of that is HyperFrames' job.

Shoot 2–3 takes of B. It is the only risky one, and it now runs to the debrief:
do not stop recording after the log.

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

```
rem cmd.exe — two lines, and never paste a # comment into cmd
set FOCUSPLUG_NO_ADAPT=1
npm run dev
```

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

**Decide about the drift pause before you film too, and know which model you
are filming.** *Stop the clock when you leave* is **on** by default, but the
switch alone is not enough: the away pause needs `deskModelId: "custom"`,
because the default BlazeFace detector answers `away` for any frame with no
usable face and is right 42.1% of the time (`docs/CUSTOM-MODEL.md § Away, on
the model that actually ships`). **On a default install the clock will not stop
on camera at all** — the Away beat is the kill and the nudge, and Settings shows
a card saying exactly that.

On the custom model the Away beat below runs 24 seconds, past the 15-second
threshold: the kill lands at 10 s and then the study clock stops, the lock
releases, and the screen says why. Narrate it (it is a real beat: "it stopped
counting — that wasn't study time") or switch it off in Settings so the beat
is only about the kill. What you must not do is let a clock stop on camera
without a word: on video that reads as a crash. It fires on **Away**, not on
Uncertain, so a lens covered hard enough to read Uncertain will not trigger it
— the same reason Uncertain never kills.

**Leave Focus Plan on** (`focusPlanEnabled` is true by default). The 2:35 beat
is its debrief for the round you just filmed, and the number on that card
is a live read — whatever it says is what you say. `npm run test:plan` is green
if you want to check the feature is wired before you roll.

Have `Demo Kill` ready as the rescue path for any beat that stalls. It lives in
the **lock-mode controls** and on the overlay as *Demo Kill — skip wait*.

---

## 2b. Known traps — read before you point a camera at the UI

Found by auditing the current branch, and re-checked on 2026-09-13 — two traps
this table used to carry (a dead Settings face grid, and faces the docs promised
that the app did not ship) are **fixed and gone**: nine faces ship, both pickers
write the same `settings.faceId` that lock mode reads. What is left is real.

| Trap | What happens | Do this |
| --- | --- | --- |
| **`npm run eval:titles` looks catastrophic** | Prints 35.5% correct, **51.4% wrong**, 267 distractions called on-task. The set is adversarial by construction — it sizes a gap, it is not a grade. | **Do not run it on camera.** The three commands in § 5 are the ones to film. |
| **`.env` at the repo root is not loaded** | There is no `dotenv` and no loader; the code reads `process.env` directly, so credentials parked there do nothing. | Export anything you need in the shell. Treat that file as secret — it can hold live device credentials. Never open it on camera and never commit it. |
| **Forgetting the fuse pin** | Unpinned, the adaptive fuse hands out a **30 s** probe on ~45% of early drifts, so the overlay reads 30 while you say "ten seconds". | Use the PowerShell form in § 2. This is the single most likely take-ruiner. (`DEMO-SCRIPT.md` and `DEMO-TODAY.md` now print the PowerShell form first, with the bash form labelled as such — the old trap where they only showed bash syntax is gone.) |
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
| **1:58–2:22** | Desk AI | **B** — cover the lens or leave the chair → **Away** → blocklist apps quit, and at 15 s the clock stops too **if you are filming `deskModelId: "custom"`** and left that switch on | "This is the part a timer can't do. I left the desk. High-confidence Away kills blocked apps even if they were never in focus — and uncertain never kills on the camera alone." *(custom model only)* "Fifteen seconds gone and it stops the clock as well: that wasn't study time, and it won't restart until I press the button — and only the model we trained is allowed to do that, because the default detector is right about 42% of the times it says away." |
| **2:22–2:35** | The proof lives here | **B** — press **Console** in the lock bar (the session keeps running and stays armed), open **Log**: Window → Distracted → Countdown → Kill | "The log is the receipt. Sensor, decision, fuse, kill — same labels as the overlay." |
| **2:35–3:00** | **The number it leaves you** | **B** — **Back to lock mode**, then hold **End**; the Session panel returns carrying the debrief for the round you just filmed, and the plan for the next one | "And it was measuring me the whole time. Every round it records one thing — how many minutes I held before my first drift — using the same definition of drift the forecast uses, not a friendlier one. That round: *N* minutes. One round is a mood, not a pattern, and it says so itself; it won't call a trend until seven separate gates pass. None of this enforces anything. It's an offer." |
| **3:00–4:10** | **How it actually works** | **C** or slides over B-roll | *see § 4* |
| **4:10–4:40** | **Proof on camera** | **C** — terminal | *see § 5* |
| **4:40–5:00** | Close | The lockup, or hold on the debrief card | "It sees the drift coming, it knows whether I'm in the chair, and the kill is what makes the timer mean something. Every other timer asks you to keep it. This one keeps it for you — and tells you tomorrow whether you're getting better." |

---

## 4. The AI beat (3:00–4:10) — do not cut this

Hyperbloom scores AI/ML as central, not decorative, and this is the minute where
you are not an LLM wrapper. Roughly 210 words, which is 70 seconds at the pace
your intro measured:

> "The camera call is a model we trained, not an API. It stacks three signal
> families — a BlazeFace detector run on the frame plus three crops so
> off-centre faces still fire, a MobileNet scene-feature vector, and about
> twenty hand-built descriptors: luma grids, gradient histograms, blur, skin
> tone. Two thousand dimensions into a small MLP head that outputs at-desk,
> away, or uncertain. Held-out it's 95.2% three-way; the face-detector heuristic
> we started with was 46.9%.
>
> A second model does something harder than seeing. Twenty-four behavioural
> features scored once a second — how fast I'm switching windows, how long I
> loiter in apps on neither list, my desk confidence sagging — into a
> nine-hundred-and-thirty-seven-parameter net that puts a number on the drift
> that hasn't happened yet. Cross the line and it warns me; higher, and it
> halves the fuse before I've broken a single rule. Seven drifts in ten warned,
> sixteen seconds of median lead.
>
> All of it runs on-device: local graph models, plain arithmetic, no network
> calls, and the app's content policy is `default-src 'self'` — nothing can
> leave the machine. The fuse is learned too: it watches whether you come back
> after a drift and how fast, and spends longer fuses on the drifts you recover
> from. On our sampler that's 77% recovery at 8.4 seconds, against 69% at 9.4
> for a fixed countdown."

Show while you say it: the `docs/CUSTOM-MODEL.md` results table, the browser
demo's risk meter and feature attributions (`npm run demo:dev`) under the
forecast paragraph, the `test:desk` output from beat C, or the Log with the fuse
column. **Not** the Settings desk-model picker — see § 2b.

Three precision points, because each is easy to overclaim:

- Say **"held-out on our eval set"**, not "95% accurate". It is a dataset
  number on 3rd-person stock images; the runtime camera is 1st-person. The
  95.2% above is only safe because § 5 volunteers the camera-sharing caveat
  thirty seconds later — **if you cut § 5, say 89% here instead**, which is the
  diverse-scene figure and the one `DEMO-TODAY.md` and `DEMO-SCRIPT.md` lead
  with.
- If you did not set `deskModelId: custom` before filming, the live run is the
  fast BlazeFace detector. In that case say the trained model is the selectable
  one and show its eval — do not narrate it over footage of the default.
- **Nothing in this minute claims phone detection**, and neither should you.
  The attention head that reads `focused` / `unfocused` / `phone` scores 57.0%
  on the hard held-out set against an always-`focused` baseline of 83.7%, which
  is why stopping the clock on a `phone` call ships off. Claim the pipeline,
  never the detector.

---

## 5. Proof beat (4:10–4:40) — run it live

Three commands, on camera, in one terminal. Do not talk over the output.

```powershell
npm run test:desk        # desk gauntlet PASS — includes the missing-weights fallback
npm run gauntlet:adapt   # adaptive fuse: 77.5% / 8.4s vs the shipped fuse's 69.4% / 9.4s
npm run test             # full suite green — 99 files / 1278 tests on 2026-09-13
```

Read the suite total off the terminal, not off this line. 1278 is what this tree
printed on 2026-09-13; if you add a test before you film, the number on screen
wins and this caption is the thing that is wrong.

Then say the caveats out loud. **This is worth more than another feature:**

> "Honest about the numbers: the Edinburgh slice of that eval shares a camera
> with its training split, so the diverse-scene figure is the one to trust —
> 89%. The fuse and the forecast were both fitted on simulated sessions, so they
> encode our sampler's assumptions, not a real student's. Cold installs ship the
> plain Settings value until it has your data. The one number that isn't
> simulated is the one on the debrief card — that's my own round, measured."

A judge who hears you volunteer that trusts the other numbers.

---

## 6. Hard fails (reshoot)

All of `DEMO-SCRIPT.md` § Hard fails, plus:

- You pitch the countdown without the kill in the same breath
- **You say a Focus Plan number that did not come off this take** — the seeded
  scenes (`plan:stills`, `?scene=plan-measured`) are fixture ledgers, and passing
  one off as your session is the one lie that would sink the whole submission.
  The same goes for a ledger `npm run demo:seed` wrote into the running app: if
  you seeded, say so in the same breath as the number (the app says it too, in
  **Log** under the *Focus Plan* filter). This 5-minute cut does not need a seed
  — its 2:35 beat reads the round you just filmed
- You claim the eval figure without the caveat
- The AI minute becomes a settings tour instead of the model
- **Internal copy is on camera** — the desk-model picker's placeholder line (§ 2b)
- **The overlay reads 30 while you say "ten-second fuse"** — you forgot the pin
- **The overlay reads 5 while you say "ten-second fuse"** — the forecast
  pre-armed, which is a *better* story than the one you scripted. Say it ("it
  saw this coming, so five seconds instead of ten") rather than reading the
  script over the wrong number. 10 and 5 are the only two fuse numbers that are
  ever safe to say out loud, and only with the pin on
- You run long — 5:10 is the ceiling, and going over reads as not knowing what
  matters

---

## 7. Handing it to the editor

Put this in a folder with the four files and hand over:

- This document (the clock is the edit decision list)
- `focusplug-intro-hook.mp4` — **locked, do not re-cut**
- The take log: which take of B and C is the keeper
- `voiceover.wav`
- The § 8 plug tag only if you shot one, marked optional — the cut has to work
  without it

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

---

## 8. Optional — the plug tag (cut this first)

Smart plugs ship, they are tested, and `docs/SMART-PLUGS.md` is the reference
page. They are **not** in this film, on purpose:

- The rubric rewards the AI being the hard part. A plug is an actuator; the
  models are the claim.
- GatewayHacks is an **equity in education** track. A feature that needs a
  student to buy hardware argues against the pitch.
- Hardware on camera is a live failure risk, and a judge cannot verify the lamp
  on the other side of the lens anyway.

If you still want a fifteen-to-twenty-second tag *after* the close, shoot it as
its own file so the edit works without it:

```powershell
$env:FOCUSPLUG_TAPO_USERNAME = "you@example.com"
$env:FOCUSPLUG_TAPO_PASSWORD = "your-tp-link-password"
npm run probe:plugs -- --ip <plug-ip>          # prove the real P110M answers
npm run probe:plugs -- --ip <plug-ip> --off    # and that it actually cuts
```

Do that **before** you point a camera at it. A P110M that has been re-handshaked
too often trips its local-auth throttle and reports "challenge did not match",
which looks identical to a wrong password. If the hardware misbehaves on the
day, drop the tag — or fall back to `npm run mock:tapo` and say plainly that you
are showing the driver against a protocol simulator. That is still a real socket
server exercising the real handshake, and judges respect the distinction more
than a silent fake. **Never** imply a mock is hardware.

One thing worth knowing even if you skip all of this: with no plugs configured
the kill overlay still carries a **Plugs** chip reading *No plugs armed* and a
*Plugs cut* card with nothing in it. That is the UI being literal, not a broken
feature — and the study PC can never be one of those devices, which is a frozen
contract rather than a setting.
