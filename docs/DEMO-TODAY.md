# DEMO-TODAY — the two-minute take, in order

The page you keep open on the second monitor while you film. `DEMO-SCRIPT.md`
is the fuller 2:45 cut and every one of its *Hard fails* still applies; this is
the version that fits in about two minutes with **no dead air**, and it says
which setting each beat depends on so nothing is a surprise mid-take.

**Say this once, before you roll:** *"Every other focus timer asks you to keep
it. FocusPlug sees the drift coming, decides at-desk vs away on-device, and the
kill is how it keeps it for you."*

---

## 1. Off camera — five minutes, do it in this order

```powershell
npm run probe:golden                 # must print GOLDEN PATH PROBE: PASS
npm run demo:seed -- --settings      # seeded plan history + the filming settings
$env:FOCUSPLUG_NO_ADAPT = "1"; npm run dev
```

```bash
FOCUSPLUG_NO_ADAPT=1 npm run dev     # bash / git-bash only
```

1. **`probe:golden` must pass.** It drives the real wiring against your real
   foreground window and kills nothing. If it fails the window sensor is dead
   on this machine and beat 4 is unfilmable.
2. **`npm run demo:seed -- --settings`** does two things and prints both.
   - It writes a **seeded** Focus Plan ledger into `<userData>/focus-plan.json`
     — three past rounds that drifted at 19, 22 and 20 minutes, built from the
     named fixtures in `src/shared/plan/fixtures.ts` and slid onto the last
     three real days. Without it the plan card correctly says *"start with 25
     minutes, then 5 off — the pomodoro default, not a reading of you"*, and
     the best beat in the feature has nothing to show. If you would rather show
     a **trend** than a median, `--preset improving` writes 20 rounds over 10
     days and the card then reads *"Up 7 minutes: 21 minutes now against 15
     earlier, across 20 drifts on 10 days"* — a bigger fabrication to disclose,
     so only take it if beat 1 is the beat you are selling.
   - `--settings` pins the pre-flight in `settings.json` rather than on camera:
     **`deskModelId: "custom"`**, `pauseOnAwayEnabled: true`, `countdownSec: 10`,
     strict mode on, webcam on, forecast + pre-arm on, `plugMode: "nudge"`.
     Set it here, not in the UI — it is faster than clicking seven controls on
     camera, and it cannot go wrong mid-take.
3. **`deskModelId: "custom"` is load-bearing, not a preference.** Beat 6 — walk
   away, the clock stops — is gated on the trained presence head by
   `deskModelMayPauseOnAway`. Stock BlazeFace has no `away` class: it answers
   `away` for any frame it cannot find a face in, and is right on **42.1%** of
   those calls against the trained head's **92.5%**. On the default model
   nothing stops the clock, whatever the switch says, and Settings prints a
   card saying so. Check the seeder's output line — it reports the model.
4. **`FOCUSPLUG_NO_ADAPT=1`** pins the fuse to the Settings number. Unpinned,
   the adaptive fuse hands out a longer probe fuse on some early drifts and the
   overlay reads 30 while you say "ten seconds". Pinned, the beat is exactly
   **10 s, or 5 s if the forecast pre-armed** — the only two fuse numbers you
   may script.
5. **Lists:** Allowlist has Chrome / Google Docs. Blocklist has Discord.
   Discord signed in. Two or three *unlisted* windows to flick between — File
   Explorer, Notepad, a settings window.
6. **No hardware, and nothing to set up for it.** Every beat below is this one
   Windows PC and its own models — same rule as `DEMO-SCRIPT.md` and
   `DEMO-5MIN.md`. Smart plugs still ship and still work, but they are not in
   this film: a lamp is an actuator, the models are the claim, and hardware on
   camera is a failure you cannot recover from in two minutes. If you happen to
   have a plug armed it will light on the walk-away nudge — say nothing about
   it, and never narrate a lamp that is not in shot.
7. Sit in frame, hold the switch once, check the sensor line reads **At desk**
   with a real confidence, hold the **Hold to end** switch, and hide this page.

> **Seed before you start the app, not after.** Main caches the ledger and the
> settings in memory and rewrites them when a round closes, so seeding under a
> running FocusPlug gets quietly overwritten. If you already had it open, close
> it and run `npm run dev` again.

---

## 2. The take — 2:00, eight beats

| # | Time | On screen | Say | Depends on |
| --- | --- | --- | --- | --- |
| 1 | 0:00–0:15 | **Session** page. The plan card reads *"20 minutes of work, then 4 off"* / *"Your last rounds drifted at 19, 22 and 20 minutes — the middle of that is 20."* Under it the debrief of the last round. Tap **Why this?** for one second — three rows, each with its own outcome | "**This history is seeded — I wrote three past sessions in so the card has something to read. The round you are about to watch is real.** It plans to what it measured: minutes until your first drift, Kaplan-Meier because a clean round is censored, not a hold of exactly its length." | `demo:seed`; `focusPlanEnabled` on |
| 2 | 0:15–0:25 | Press **Use this plan** — the Length dial jumps to 20 / 4. Sit in frame, **hold the switch**. Lock mode takes the screen; sensor line reads **On task** | "It is an offer, not a rule — the dial stays mine, and it measures whether I took it. Wheels up. Chrome on the assignment, me at the desk." | Strict mode on; webcam on |
| 3 | 0:25–0:50 | Press **Console** in the lock bar. Flick the unlisted windows for ~15 s, leaning out of frame. The risk meter climbs; the 24 feature attributions move; the `logit → Platt → risk` line is readable. A **nudge** fires at 0.50 with nothing enforced | "Nothing is broken yet. A 937-parameter net is scoring the next thirty seconds once a second off my own behaviour — window churn, grey-app loiter, desk confidence sagging. That is the nudge. Nothing has been enforced." | `forecastEnabled`; Console keeps the session armed |
| 4 | 0:50–1:10 | **Back to lock mode**, then alt-tab to Discord. Opaque overlay: **Killing blocked apps in 5…**, with *✔ Forecast pre-armed N s before this fuse*. It hits zero; Discord quits | "Crossing 0.65 pre-armed it, so the fuse is five seconds instead of ten — shortened before I broke any rule. That line is the receipt. Discord is gone." | `forecastPrearmEnabled`; `FOCUSPLUG_NO_ADAPT=1`; Discord on the blocklist |
| 5 | 1:10–1:20 | Alt-tab back to Docs, stay in frame. Overlay gone, decision **On task** | "Back on the assignment and still in the chair — unlocked. Strict mode needs both." | Strict mode on |
| 6 | 1:20–1:42 | Stand up and leave frame. The window pulls itself forward with the away nudge on it. Hold it 15 s: the clock **stops** and the screen reads *"Paused — you left the desk"* | "Now the part a timer cannot do. Fifteen unbroken seconds of the camera not seeing me and it stops counting — time out of the room is not study time. It will not restart itself." | **`deskModelId: "custom"`** + `pauseOnAwayEnabled` |
| 7 | 1:42–1:50 | Sit back down, press **Start the clock again** | "It costs me a click to get it back. And notice the lock lifted while it sat there — a stopped clock is the app being *less* aggressive, not a second lock." | — |
| 8 | 1:50–2:05 | Hold the **Hold to end** switch. Back on **Session**: a new debrief — *"You held N minutes… Minutes to first drift: N. Your median is M across 4 rounds."* — and the plan card recomputed with it | "That debrief is real. It just measured the drift you watched happen and folded it into the plan. Three seeded rounds in, one measured round on top." | `focusPlanEnabled` on |

Beat 8 is why the block is 20 minutes and you end it early: a round that
**drifted** is real, informative data and is counted whatever its length — only
a *clean* round under five minutes is thrown away. So **Hold to end** right
after beat 7 buys the debrief with no waiting at all. Read the numbers off the
screen; they are whatever the round actually was.

---

## 3. Numbers — what is safe out loud, and what is not

**Safe, with the caveat attached in the same breath:**

- **Focus Forecast — 0.9330 lead-censored AUC**, against the strongest
  24-feature logistic baseline's 0.9259, on a disjoint 900-session corpus.
  Median lead 16 s. **Say "simulated"** — both corpora come from our own
  behaviour simulator; no student data was collected.
- **Presence head — 89.44%** held-out 3-way on the diverse-scene slice. Prefer
  this to 95.16%, whose Edinburgh slice shares a camera with its training
  split. The eval imagery is 3rd-person stock; your webcam is 1st-person.
- **Away, on the model that ships the pause — 92.5%** of the trained head's
  `away` calls are right, against **42.1%** for BlazeFace. That asymmetry is
  the whole reason the pause is gated on the trained model.
- **The seeded history is seeded.** Say it in beat 1. The app says it too: the
  ledger carries a `seed` stamp the recorder can never write and never drops,
  and **Log → the *Focus Plan* filter** shows `SEEDED DEMO HISTORY · 3
  fabricated rounds written by npm run demo:seed …` at start-up and again for
  the round you arm on top of it. If a judge asks, that filter is the proof.

**Do not say:**

- **Anything about phone detection.** The attention head scores **57.0%** on
  the held-out stock proxies against an always-`focused` baseline of **83.7%**
  — it does not beat "assume they are working" off-distribution. Claim the
  pipeline, never the detector. Pause-on-phone ships **off** for this reason.
- Any fuse number other than 10 and 5, and only with `FOCUSPLUG_NO_ADAPT=1`.
- "It stops the clock" while filming the default desk model.
- The `gauntlet:plan` and `gauntlet:adapt` tables without the word *simulated*.
- That the browser demo killed anything. A tab renders the kill **decision**.

---

## 4. If it goes wrong on camera

| It happened | Do this |
| --- | --- |
| The fuse opens on **10**, not 5 | Do not fake it. Say *"that is a model with a threshold, not an animation — it fires when it fires"*, finish the kill, and cut to the browser page (§5) for the pre-arm. |
| The overlay reads **30** | You forgot `FOCUSPLUG_NO_ADAPT=1`. Either restart with it, or read the number off the overlay and say the fuse is learned per person. |
| The clock does not stop on beat 6 | You are on `blazeface`. Cut beat 6 to the away nudge alone — the window pulling itself forward — say nothing about stopping the clock, and re-run `npm run demo:seed -- --settings` before the next take. |
| Discord will not launch | Skip to **Demo kill** in the lock bar — same force-quit, no fuse — and say it is the filming path. |
| The plan card says *"Start with 25 minutes"* | The seed did not land. Check the seeder printed your real userData path; `FOCUSPLUG_USER_DATA=<path> npm run demo:seed` overrides it. |
| The debrief in beat 8 says *"not counted"* | The round closed with no drift recorded — the Discord beat did not register as a drift. It is still honest; read the line as written, or re-take. |
| Anything stalls for more than three seconds | **Demo kill**, then **Log**, and point at the `countdown → kill → unlock` chain. Dead air is worse than a shortened beat. |

---

## 5. The 30-second fallback — the browser demo

```bash
npm run demo:dev        # http://localhost:5190
```

The shipped weights, the real feature extractor, the real escalation reducer
and the real policy engine over a scripted 94-second session: risk meter with
its attributions, the nudge, the pre-arm shortening 10 s to 5 s, the kill
decision with its lead-time receipt. There is a 2× toggle and chapter marks, so
the pre-arm beat is about 30 seconds of film. `dist/demo/index.html` after
`npm run demo:build` opens straight from `file://` if the dev server is a
problem. **Say that a browser tab cannot force-quit a process** — the page
renders the decision, and its own footer says so.

---

## 6. After the take

```bash
npm run demo:unseed
```

Restores whatever ledger and settings were there before, and refuses to delete
a `focus-plan.json` that carries no seed stamp — real measured history is never
what this command removes.

Where the machinery lives, if a judge asks: `scripts/demo-seed.ts` writes it,
`src/shared/plan/fixtures.ts` supplies the shapes, the `seed` stamp is defined
and argued in `docs/FOCUS-PLAN.md § 5.1`, and `src/main/focusplan/recorder.ts`
is what prints it into the Log. The Length-dial pin lives in the renderer's
`features/timer/plan.ts`. Both are covered by `npm run test:plan` and `npm test`.

---

## 7. Optional — the "Session complete" ending

Beat 8 ends on the Session page. If you would rather land on the full-screen
**Session complete** panel, with the debrief *and* the session roll-up, the
block has to run out on its own — and a block only counts as *completed* by
serving its planned length. The shipped floor on the Length dial is five
minutes and stays five minutes for real users, so there is a filming pin, in
the same spirit as `FOCUSPLUG_NO_ADAPT` and `FOCUSPLUG_NO_PLAN`:

```powershell
$env:RENDERER_VITE_FOCUSPLUG_DEMO_ROUND = "1"; $env:FOCUSPLUG_NO_ADAPT = "1"; npm run dev
```

In a packaged build, or if you would rather not restart: open DevTools and run
`localStorage.setItem("focusplug.demo.round", "1")`, then reload.

Pinned, the Length dial goes down to **1 minute in steps of 1**. Skip the **Use
this plan** press in beat 2; instead drag the Length fader all the way left (it
lands on 1) and press **+** once for 2. Or set the whole plan at once from
DevTools and reload:

```js
localStorage.setItem("focusplug.demo.round", "1");
localStorage.setItem(
  "focusplug.plan.v1",
  JSON.stringify({ shape: "custom", focusMin: 2, breakMin: 4, rounds: 1 }),
);
```

Then let the block land on its own. Budget about 40 extra seconds, because the
clock does not tick while beat 6 has it stopped. The pin changes nothing else:
not the fuse, not a threshold, not a claim, not what is recorded. Unset it and
`clampPlan` pulls a stored 2-minute plan back up to 5 on the next read, so
forgetting cannot leave anyone on a one-minute floor.
