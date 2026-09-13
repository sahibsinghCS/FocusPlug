# FocusPlug — the run sheet: what you say, what you do

**This is the page you keep open on the day.** Every beat below is a pair: the
words in the **Say** column are spoken verbatim, the **Do** column is what your
hands are doing while those words are said. `[Square brackets]` are directions,
not words.

The other three demo docs each own one job and this one owns the take:

| Doc | What it is for |
| --- | --- |
| **this file** | The words, paired with the actions. Read this while filming. |
| [DEMO-5MIN.md](DEMO-5MIN.md) | Capture mechanics — the six files, resolutions, what the editor gets |
| [DEMO-SCRIPT.md](DEMO-SCRIPT.md) | The 2:45 enforcement-only cut, and the *Hard fails* list that governs both |
| [EDIT-PROMPTS.md](EDIT-PROMPTS.md) | HyperFrames assembly prompts |

**Target 5:00, band 4:40–5:10.** The 3:00 trim is at the bottom.

## How the say/do pairing actually gets recorded

You are not narrating live. Shoot the picture first in the six pieces
[DEMO-5MIN.md § 1](DEMO-5MIN.md) lists, then read the whole **Say** column top
to bottom in **one clean voiceover pass** with no picture in front of you, and
let the editor slide the picture to the voice. The pairing in this document is
what tells you which picture has to exist under which sentence — it is a shot
list as much as a script.

Two consequences, both of which save a take:

- **While you are shooting picture, say nothing.** Mouth it if it helps you
  pace, but the microphone is off. A fluffed line then costs you nothing.
- **Beat B — arm through log — is one continuous take.** It is a causal chain
  and a judge can tell when it was cut together. Everything else assembles.

Talk at the speed you would explain this to someone at the next desk — about
160 words a minute. The intro takes that sounded real measured 167–193 wpm; the
robotic ones were 71–126. Do not perform it. Slate each take out loud ("B, take
two").

Total spoken below: ~700 words ≈ 4:15 of speech inside a 5:00 cut. **The gaps
are deliberate.** Silence while the fuse counts down is the most persuasive
fifteen seconds in the film.

---

## Before you roll — nine pins, ten minutes

Do not start the camera until all nine are true. Six of them are here because
they have already ruined a take.

1. **`npm run probe:golden` prints `GOLDEN PATH PROBE: PASS`.** Ten seconds, no
   GUI, kills nothing. If the window sensor is dead on this machine, beat B is
   unfilmable and nothing else matters.
2. **Pin the fuse.** PowerShell, not bash:
   ```powershell
   $env:FOCUSPLUG_NO_ADAPT = "1"; npm run dev
   ```
   Unpinned, the adaptive fuse hands out a 30 s probe fuse on a fraction of
   early drifts and the overlay reads **30** while you say "ten seconds". This
   is the single most likely take-ruiner. Pinned, the only two numbers you can
   say out loud are **10 s**, or **5 s if the forecast pre-armed**.
3. **Pick the desk model in the settings file, not the UI:** `{ "deskModelId":
   "custom" }`. The 95.16% figure belongs to `custom`. On the default
   `blazeface` you are filming a face detector, the away beat has no clock stop
   in it, and the "model we trained" line is not true about what is on screen.
   Do not open the desk-model picker on camera — it ships internal copy.
4. **Decide about the clock stop now.** *Stop the clock when you leave* is on by
   default but needs `deskModelId: "custom"`; with that set, fifteen unbroken
   seconds of `away` stops the study clock after the force-quit. Either narrate
   it or switch it off. A clock that stops on camera without a word reads as a
   crash.
5. **Settings:** Countdown **10s**, Strict mode **on**, Desk AI webcam **on**,
   Focus Forecast **on**, Pre-arm **on**, nudge 0.50, pre-arm 0.65.
6. **Lists:** allowlist has Chrome / Google Docs; blocklist has Discord.
7. **Windows open:** Discord signed in, Google Docs in Chrome with
   `docs.google.com` in the title, and three unlisted windows to flick between
   for the forecast beat — File Explorer, Notepad, anything on neither list.
   If you want the lamp in the away beat, add and arm the plug on *Plugs* now —
   the app ships with none.
8. **Never touch on camera:** the Settings face grid (it is dead — it writes a
   setting lock mode does not read), the desk-model picker, `.env`, and
   `npm run eval:titles` (it prints 51.4% wrong; the set is adversarial by
   construction and sizes a gap rather than grading anything).
9. **Rehearse the forecast beat once** and count how much window-flicking your
   machine needs before the fuse opens on 5. Then hide this script.

Have **Demo kill** ready as the rescue path for any beat that stalls. It is in
the lock-mode bar, and on the overlay as *Demo Kill — skip wait*.

---

## The script

### A · 0:00–0:15 — Cold open

**Do:** nothing. `focusplug-intro-hook.mp4` is rendered and locked; do not
re-cut it.

**Say:** nothing. The cut carries itself.

---

### B1 · 0:15–0:38 — The claim

**Do:** Session panel, nothing locked. Let the nine faces preview side by side
for a second, then click along two or three of them. Drag the length dial to
fifty minutes and let the route and the *free by* time follow.

**Say:**

> A pomodoro counts minutes and then dings. It doesn't close the distraction,
> and it has no idea whether you left the chair.
>
> FocusPlug watches the window you're in *and* whether you're actually at your
> desk. When you drift, it takes the distraction away.
>
> Pick how you want to watch it run out. Mine's a flight — fifty minutes is
> Dubai to Doha, landing when I'm free.

**Watch for:** the faces are genuinely animating, and the *free by* clock
changes as you drag. That is the whole "commitment is legible" beat.

---

### B2 · 0:38–0:52 — The plan card

**Do:** Hold on the **Focus Plan** card above the dial. Do not click anything —
the card is a recommendation and the point is that you can ignore it.

**Say:**

> Before the round it tells you how long you can actually hold, from your own
> history — and it's honest when it doesn't know yet. On a fresh install it says
> outright that twenty-five minutes is the pomodoro default and not a reading of
> you.
>
> It recommends. It never enforces. The dial underneath stays yours.

**Watch for:** the card's kicker. `FOCUS PLAN · no history yet` is the line you
just described. If it reads `· measured` or `· provisional` instead, say
"it's read four of my rounds and it's recommending twenty-eight" — read the
card, do not read this script.

**Cuttable.** This is the first beat to go if you run long.

---

### B3 · 0:52–1:08 — Setup

**Do:** Open **Blocklist** and scroll to Discord. Open **Settings** and show
webcam on, strict mode on, Focus Forecast on. Back to **Session**.

**Say:**

> Allowlist the assignment. Blocklist Discord and the games.
>
> All of the AI runs on this machine. Camera frames never leave the PC — there
> is no network call on any inference path. And strict mode means both sensors
> have to agree before anything dies.

---

### B4 · 1:08–1:20 — Arm

**Do:** Sit square in frame. **Press and hold** *Hold to lock*. Lock mode takes
the whole screen; the aircraft leaves; the sensor line reads **On task**.

**Say:**

> Hold it. That's the commitment — you can't click your way into this, and you
> can't click your way out.
>
> Wheels up. Off the clock it only watches. A live round can kill.

**Watch for:** the sensor line naming your real window, and a real Desk AI
confidence — not 0%. If it says 0%, your camera shutter is closed and the away
beat will not work either.

---

### B5 · 1:20–1:42 — The forecast

**Do:** Leave Docs. Flick between the three unlisted windows every couple of
seconds for fifteen to twenty seconds, leaning back a little out of frame. Lock
mode stays quiet — that is by design, and that is the point of the line you are
saying.

**Say:**

> Nothing has been broken yet. I'm still allowed to be here.
>
> But a second model is reading the *shape* of this — how fast I'm switching,
> how long I'm loitering in apps on neither list, my desk confidence sagging —
> and it's calling the drift before it happens.
>
> Watch what that costs me.

**Watch for:** nothing on screen. Lock mode deliberately draws one sensor line
and no meter. The pay-off is the next beat's fuse length.

**If it does not fire** — the fuse opens on 10 instead of 5 — do not fake it and
do not cut the beat. Say this and cut to the browser page (`npm run demo:dev`,
or `dist/demo/index.html` straight off `file://`):

> That's a model with a threshold, not a scripted animation, so it fires when it
> fires. Here's the same net, same weights, on a recorded session.

That page plays the shipped weights over a 94-second session with the risk
meter, the 24 feature attributions, the nudge, the `10s → 5s` plate and the kill
receipt, in order. Say plainly that the browser renders the kill *decision* — a
tab cannot force-quit anything.

---

### B6 · 1:42–2:08 — Drift, and the kill

**Do:** Alt-tab to Discord. The room floods crimson: an opaque full-screen
overlay counting down from **5**, with the amber receipt line *✔ Forecast
pre-armed 14 s before this fuse*. Let it run to zero. Discord quits.

**Say:**

> I've tabbed to Discord. That's a distraction, and the fuse is armed — five
> seconds, not ten, because it saw this coming. That line is the receipt.
>
> If I go back to the assignment right now, this cancels and nothing happens.
>
> I'm not going back.

> **[Stop talking. Let the last three seconds and the force-quit play in
> silence. ~8s of no voice.]**

**Watch for:** the overlay is a full-window takeover, not a toast, and it names
what it is about to kill. If Discord does not die, you have a reshoot.

---

### B7 · 2:08–2:20 — Unlock

**Do:** Alt-tab back to Docs and stay in frame. The overlay is gone. Decision
reads **On task**.

**Say:**

> Back on the assignment, still at the desk — and it unlocks itself.
>
> Strict mode needs both: the right window, and a person in the chair.

---

### B8 · 2:20–2:46 — The part a timer can't do

**Do:** Re-open Discord in the background, then **leave the chair** — walk out
of frame and stay out for a full twenty-five seconds. Decision flips to
**Away**. The lamp comes on. The fuse burns and the blocklist apps quit. Then,
at fifteen seconds of unbroken away, the header changes to **Paused — you left
the desk** and the clock stops. Walk back and press **Start the clock again**.

**Say:**

> Here's the part a timer can't do.
>
> I've left the desk. No tab switch, no keystroke — the window is still the
> assignment. But the camera says nobody's there, so the blocked apps die
> anyway. And when it isn't sure, it never kills on the camera alone.
>
> Then it stops the clock. That wasn't study time, so it isn't counting it — and
> it won't restart until I press the button.
>
> Only the model we trained is allowed to do that. The stock face detector is
> right about forty-two percent of the times it says "away", so on a default
> install leaving the room nudges you and nothing more.

**Watch for:** the kill lands **before** the pause. That ordering is enforced —
a burning fuse refuses the pause at every Countdown setting — and it is the
whole reason walking away can't be used to save Discord.

**The lamp only lights if a plug is actually added and armed** on the *Plugs*
page. `plugMode` is `"nudge"` out of the box, so with an outlet armed it comes
on when you drift and you get the beat for free — but the app boots with no
plugs at all. Add it before you roll or cut the lamp from this beat.

**If you are filming the default model,** cut the last two paragraphs. The beat
is then the kill and the lamp, and you must not promise a clock stop.

---

### B9 · 2:46–2:58 — The receipt

**Do:** Hold *Hold to end*, open **Log**. The chain is there in order: Window →
Distracted → Forecast pre-arm → Countdown → Kill → Unlock.

**Say:**

> The log is the receipt. Sensor, forecast, decision, fuse, kill — in order, with
> the same labels you just saw on the overlay.

---

### C + D · 2:58–3:20 — The plug

**Do:** Two clips. **C:** screen capture of **Demo kill** cutting an armed
outlet. **D:** a phone or second camera on the lamp actually going dark. Cut C
to D on the word "cuts".

**Say:**

> And it doesn't stop at software. Demo Kill force-quits the blocked apps *and*
> cuts the plug.
>
> That's a TP-Link P110M on the local network, over their local protocol. No
> vendor cloud, no account.
>
> The one thing it will never touch is the machine you're working on. That isn't
> a setting you can get wrong — it's frozen in the contract.

**If the hardware misbehaves,** fall back to `npm run mock:tapo` and say you are
showing the driver against a protocol simulator. That is still a real socket
server doing the real handshake, and judges respect the distinction far more
than a silent fake.

---

### E · 3:20–4:20 — How it actually works

**Do:** Terminal, or the `docs/CUSTOM-MODEL.md` results table, or B-roll of the
browser demo's attribution panel. **Not** the Settings desk-model picker.

**Say:**

> Four models decide things here and every one of them runs on this machine.
>
> The one that saw the drift coming is a nine-hundred-parameter network reading
> twenty-four behavioural features once a second, and putting out a calibrated
> probability that I'm about to drift in the next thirty seconds. Cross one
> threshold and it warns. Cross the second and it shortens the fuse before I've
> broken a rule.
>
> The camera call is a model we trained, not an API. A face detector run on the
> frame plus three crops so off-centre faces still fire, a MobileNet scene
> vector, and about twenty hand-built descriptors — brightness grids, gradient
> histograms, blur, skin tone. Two thousand dimensions into a small network that
> says at-desk, away, or uncertain. Held out, ninety-five percent three-way. The
> face detector we started with was forty-seven — it can see a face, it can't
> tell you whether you're working.
>
> And the fuse is learned too. It watches whether you actually come back after a
> drift, and how fast, and it spends longer fuses on the drifts you recover
> from. Both models want a say in one number, so exactly one four-line function
> decides it: the learned length is the base, and a pre-arm scales it toward the
> floor. It never replaces it.

---

### E · 4:20–4:45 — Proof, and the caveats

**Do:** One terminal, three commands, on camera. Do not talk over the output.

```powershell
npm run test:desk        # desk gauntlet PASS
npm run gauntlet:adapt   # 77.2% recovery at 8.5s vs constant 69.4% at 9.4s
npm run test             # full suite green
```

**Say, after the output lands:**

> Now, honest about those numbers.
>
> The forecast is trained and evaluated on simulated sessions — our own
> behaviour sampler, not students. It beats the best logistic regression on the
> same features, with the build failing if it doesn't, but it's measured against
> a simulator's world.
>
> One slice of the camera eval shares a camera with its own training split, so
> the figure to trust is the diverse one — eighty-nine. The eval images are
> third-person stock and your webcam is first-person.
>
> And the attention head that spots a phone isn't reliable yet, so it's allowed
> to nudge and nothing else. We ship that switch off.
>
> A cold install gives you your plain setting until it has your data.

**This beat is worth more than another feature.** A judge who hears you
volunteer the caveats trusts every number you said before them.

---

### 4:45–5:00 — Close

**Do:** The lamp shot, or the lockup.

**Say:**

> Two sensors, one forecast, one decision — and a consequence you can hear.
>
> Every other focus timer asks you to keep it.
>
> This one keeps it for you.

---

## If you have to cut to 3:00

Drop in this order. Stop as soon as you are inside the band.

1. **B2, the plan card** (0:38–0:52) — whole beat.
2. **The AI minute** (3:20–4:20) down to two sentences: *"The camera call is a
   model we trained, not an API — ninety-five percent held out, all on-device.
   And the drift forecast is a small network reading twenty-four behavioural
   features a second."*
3. **The plug** (2:58–3:20) to one line over the lamp shot.
4. **The proof beat** (4:20–4:45) to the caveat sentences only — keep "simulated"
   and "eighty-nine", drop the terminal.

Keep the forecast, the kill, the desk-away beat and the close. Those four are
the demo.

## What not to say

**Never:** streak · gentle reminder · productivity coach · tutor · AI-powered ·
"it reminds you".

**"Nudge" is a real product word** — the forecast raises one, and so does the
lamp. Use it for that and nothing else.

**Never pitch the countdown without landing the kill in the same breath.** A
timer that counts is every other timer.

**Never quote a number without its model or its corpus.** "Ninety-five percent"
belongs to the custom desk model on a held-out set; the forecast numbers belong
to a simulated corpus. Both caveats are one short clause and they cost you
nothing.
