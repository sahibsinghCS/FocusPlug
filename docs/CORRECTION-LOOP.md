# The correction loop — Design (build-ready)

> The timer stopped. The student was working. They say so, and two things
> happen on two clocks: the app obeys **now**, and the model learns **later**.

---

## 0. One paragraph, and the four things this must never do

FocusPlug now pauses the study clock on a confirmed `away` or `phone`
(`docs/CONTRACTS.md § Drift pause`). `away` rides the trained presence head,
which is right on 92.5% of the frames it calls `away`. `phone` rides the
attention head, which is **not** reliable: 50–69% phone recall, and roughly
17% of non-phone photos come back `phone`. So sooner or later this product
will stop a student's clock while they are working. When it does, the paused
screen asks one question and offers two answers — *I was working* and *you were
right* — and each answer does two things. **Immediately**, the app obeys: it
resumes, and it silences that kind of pause for a stated cooldown. **Later**,
the frames that caused the pause are stored on that machine with the student's
label, and once enough have accumulated the student can ask for a refit that is
allowed to replace the shipped attention head **only if it beats a gate**.

The four rules everything below protects:

1. **The student is the authority in the moment.** The behavioural half never
   waits for a model, a threshold or a refit. It is a boolean and a clock.
2. **One click never retrains anything.** Recording a correction writes JPEGs
   and one JSON record and touches no weights. The refit is a separate,
   explicit action, and even *that* does not install a head — the gate does.
3. **A personal head that is worse does not ship.** Same shape as the
   forecast's CI gate (`must not be beaten`, margin 0) and Focus Plan's seven
   trend gates (named, ordered, and it says which one stopped it). Both scores
   are reported, and the UI names the head that is running.
4. **The images never leave the machine.** They live in the user data
   directory, they are listed on screen with thumbnails, they are deletable in
   one action, and no code in the shipped app uploads anything. The only path
   off the machine is a developer running an export script on their own laptop,
   and it is described in §10 so nobody has to guess.

A fifth fact falls out of the existing contracts and is worth stating up front:
**on a default install the correction loop is unreachable.** A correction can
only come from a pause; only `deskModelId: "custom"` can pause
(`deskModelMayPauseOnAway`, and only that model has an attention head at all);
so a `blazeface` install never captures a frame, never writes a file and never
shows a chip. The loop is opt-in by exactly the same construction the pause is.

### What already exists, and is reused rather than rebuilt

| Reused | Where | For |
| --- | --- | --- |
| the pause itself, its sustain counters and floors | `src/main/session/nudge.ts` | the moment a correction can exist |
| `NudgeEvent` (`pause?: boolean`) | `src/shared/nudge.ts` | the wire the verdict hangs off |
| the paused lock screen and `pauseNotice` | `src/renderer/src/pages/LockPage.tsx` | where the two buttons live |
| the attention CSV's ten columns and its `group` discipline | `datasets/desk-attention-labels.csv`, `scripts/desk-model/first-person.ts` | the on-disk label schema, unchanged |
| `first-person/` path prefix ⇒ `isFirstPersonRow` | `scripts/desk-model/first-person.ts` | the trainer and eval already treat these rows correctly, with **no code change** |
| `extractDeskFeatures`, `headProbabilities` | `src/main/desk/model/your-model.ts` | one definition of how a frame becomes numbers |
| prior-anchored on-device learning | `src/shared/adapt/model.ts` | the refit's regulariser, one layer up |
| `stepOnset` / `classifyRound` / the ledger | `src/shared/plan/drift.ts`, `src/main/focusplan/**` | retracting a drift that was not one |
| `writeJsonAtomic`, `ConfirmAction`, the log filters | `src/main/store/appStore.ts`, renderer | persistence and UI, in the house style |

### The structural fact that shapes everything

The pause **stops the session**, which stops the desk monitor, which releases
the camera (`docs/CONTRACTS.md § Drift pause`). By the time the student reads
the screen and decides, there is no camera and no frame. So the frames must be
captured **at the instant the pause is raised**, out of what the monitor
already had in hand, and held in memory until the student answers. Everything
in §2 follows from that one sentence.

---

## 1. What a correction is, and the four cases

### 1.1 Two questions is one question, and there are only two buttons

The paused screen already carries `pauseNotice(kind)`: a kicker, a line, and
one button that starts the clock again. It gains a verdict row above that
button:

```
Paused — phone
The clock stopped because the camera kept seeing a phone, and it will not
start itself. Put it face down and start again — nothing is enforced until
you do.

Was that right?           [ I was working ]   [ You were right ]
saves 3 webcam photos to this computer · Settings → Desk model

                  [ Start the clock again ]
```

Three controls, three meanings, and no fourth:

* **I was working** — records `verdict: "wrong"`, arms the cooldown, retracts a
  false drift from Focus Plan where one exists, **and resumes the clock in the
  same tap**. The student said the app was wrong; making them press a second
  button to undo the app's mistake would be the app arguing.
* **You were right** — records `verdict: "right"`. It does *not* resume: they
  were on their phone, and the way back is to put it down and press the
  primary button, which is right there.
* **Start the clock again** — unchanged, and records **nothing**. Silence is
  not a label. A student in a hurry produces no data, which is correct: a
  verdict they did not give is not evidence, and a UI that harvested one from
  a dismissal would be manufacturing training data out of impatience.

There is no third chip for "I was at my desk but not really working". The
attention vocabulary has an `unfocused` class and this UI deliberately cannot
produce it: `unfocused` is the vaguest thing the head says, it can never stop a
clock (`PauseKind` excludes it), and asking a tired student to grade their own
attention on a three-point scale at the moment they are annoyed produces worse
labels than not asking. Two buttons, both of which the student can answer
without thinking.

**Not on the nudge overlay.** `NudgeOverlay` auto-dismisses after
`NUDGE_VISIBLE_MS` (12 s). Verdict controls that vanish on a timer are a
trap — the student looks up, reads, reaches, and the buttons are gone. The
overlay keeps its single *Got it*; the verdict lives on the paused `LockPage`
behind it, which sits there until they act. That is the same reasoning that
already put `pauseNotice` and the restart button there rather than on the
console.

### 1.2 The four cases, in full

`kind × verdict` is four rows and this table is the heart of the contract. It
is one exported constant (`CORRECTION_MEANING`, appendix §1), not four `if`s
scattered across main and the renderer.

| pause kind | verdict | the student said | `attention` col | `pack_label` col | trains the personal head | cooldown | Focus Plan |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `phone` | `wrong` | "I was working" | `focused` | `focused` | **yes**, as `focused` | phone silenced 25 min | nothing to retract — see below |
| `phone` | `right` | "I was on my phone" | `phone` | `phone` | **yes**, as `phone` | none | nothing |
| `away` | `wrong` | "I was here" | *(empty)* | `at_desk` | no — §1.3 | away silenced 10 min | **retract the drift** — §5 |
| `away` | `right` | "I had left" | *(empty)* | `away` | no — §1.3 | none | nothing — the drift was real |

Two consequences of this table are worth saying out loud because they are not
obvious:

**A phone correction retracts nothing from Focus Plan, and that is correct.**
The policy engine never reads `DeskSnapshot.attention` — `classify()` in
`src/shared/policy/evaluate.ts` looks only at `focus` and `deskPresence`. So a
`phone` reading, right or wrong, never produces a `DISTRACTED` or `AWAY`
`Decision`, never produces a drift onset, and never touched the student's
minutes-until-first-drift in the first place. There is nothing to undo. What a
false phone pause *did* cost is the interruption, and the cooldown is the
answer to that.

**A confirmed-right pause is data, not a shrug.** "Yes, I was on my phone" is a
first-person, in-the-room, positive example of *this student's* phone pose,
captured at exactly the moment the model was making its call. It is the class
the shipped head is worst at, from the camera the shipped head never trained
on. It costs one tap and it is worth as much as the correction — arguably more,
because a loop that only ever hears "wrong" teaches the head one lesson ("say
`phone` less") and a loop that hears both teaches it where the line is. The UI
therefore gives both chips equal weight, equal size, and no default.

### 1.3 Why an `away` correction does not train the attention head

An `away` correction is *presence* evidence: the student is telling you the
person in the frame was at the desk. That is the most valuable thing they could
say about the presence head — and this design deliberately does not act on it.
Two reasons, both structural:

1. **The presence head is the one whose number bought a consequence.** 92.5%
   precision on `away` is what `deskModelMayPauseOnAway` is proportioned
   against, and it is the only number in this product that licenses stopping a
   clock. A dozen frames from one room are not allowed to move it. The rule
   this repo already uses — *the head with the number carries the
   consequence* — read in the other direction: the head with the consequence
   does not get refit from a handful of local frames.
2. **Off-distribution for the head that IS refit.** At runtime the attention
   head is consulted only when presence says `at_desk`
   (`YourModel.infer`). An `away`-corrected frame is by construction one the
   presence head called `away`, so it is a frame the attention head would never
   have been shown. Training it on those frames is the same category of error
   `readFeatureRows` already guards against when it keeps proxy rows out of the
   presence head by default.

So `away` corrections are **captured, stored, listed, deletable, counted,
retracted from Focus Plan, and exported** — they simply do not enter the
personal refit pool. The CSV rows carry `attention: ""`, which means
`train-attention.ts`'s existing filter (`labels.includes(row.attention)`) skips
them with **no code change at all**, and `pack_label: at_desk` / `away` leaves
them legible to a future presence-head pipeline. If the presence head is ever
refit from first-person data, that is a separate design with its own gate, and
this file's data is waiting for it.

---

## 2. Capture: which frames, how many, and how they leave the monitor

### 2.1 The ring, and when it exists at all

`DeskMonitor.step()` grabs an `RgbFrame`, hands it to `analyzeDeskFrame`, and
drops it. The monitor gains one small ring:

```ts
class DeskMonitor {
  private readonly ring = new FrameRing();   // src/main/desk/frameRing.ts
  peekFrames(sinceMs: number): RetainedFrame[];
}
```

* **Bounded**: `CORRECTION_RING_FRAMES` = 6 slots, and a frame is only admitted
  if it is at least `CORRECTION_RING_SPACING_MS` (5 s) newer than the slot
  before it. Six slots × 5 s covers 30 s — exactly `PAUSE_SUSTAIN_PHONE_MS`,
  the longest run that can produce a pause. At 640×480×3 that is 5.5 MB of RAM,
  held only while it can be used.
* **Conditional**: the ring retains nothing unless a correction could actually
  come out of it — `deskCorrectionsEnabled` **and** `deskModelId === "custom"`
  **and** at least one of `pauseOnAwayEnabled` / `pauseOnPhoneEnabled`. The
  controller pushes that boolean down with the same `syncDeskEnabled` /
  `syncDeskModel` machinery it already uses for the other two. On a default
  install the ring is a `null` and the `if` is one comparison per frame.
* **Cleared** on `DeskMonitor.stop()`, on `setEnabled(false)`, and on a model
  swap. A stopped session holds no pictures of anybody.
* **250 ms spacing is not admitted.** Consecutive readings are the same
  photograph; keeping six of them would be six copies of one moment, which is
  the exact near-duplicate trap `first-person.ts` exists to close. The ring
  enforces the spacing rather than trusting the selection step to fix it later.

### 2.2 Selection: three frames, spread across the run that tipped it

When `NudgeTracker` returns `{ pause: true }`, the controller — **before**
anything else, and in particular before the renderer's pause reaches
`stopSession()` and tears the camera down — asks the ring for the frames inside
the confirmed run:

```ts
const sinceMs = kind === "away" ? PAUSE_SUSTAIN_AWAY_MS : PAUSE_SUSTAIN_PHONE_MS;
const frames = this.deskMonitor.peekFrames?.(now - sinceMs) ?? [];
```

No new camera is opened, no new grab is issued, and the desk monitor's loop is
not touched: these are frames the model already looked at, on their way to
being garbage collected. That is the whole of "how the desk monitor hands it
over".

From those, take `CORRECTION_FRAMES_PER_CORRECTION` = **3**: the first, the
middle and the last of the window. Three because that is enough for the student
to recognise the moment on the review screen and enough to average over a blink
or a hand crossing the lens, and few enough that 120 corrections fit in about
9 MB of the student's disk. Fewer than three available (a short ring after a
camera restart) is fine — one frame is a valid correction; **zero** frames
means no `correctionId` is issued and the chips do not appear.

**Three frames are still one sample.** They are five seconds apart, same room,
same pose, same light. §3.4 is where that becomes a schema rule; it is stated
here because it is the reason the number is 3 and not 30.

### 2.3 Encode once, and extract features from the encoding

Each retained frame is encoded to JPEG at `CORRECTION_JPEG_QUALITY` = 85 at the
camera's native grab size — **not resized**. A resized frame is not the frame
that caused the pause, and the review screen's whole job is to show the student
what the model actually saw.

Then the rule that keeps one definition:

> The cached activation for a correction frame is extracted from the **encoded
> JPEG, decoded back**, never from the pre-encoding `RgbFrame`.

`decodeImageBuffer(jpeg) → extractDeskFeatures(...)`. It costs one extra
decode and it buys exact agreement between the on-device cache and anything
`extract-features.ts` computes from the same file after an export. Without it
the two would differ by JPEG loss, and the first time a number disagreed
between the app and the pipeline nobody would know which was right.

Quality 85 rather than `capture-attention.ts`'s 88 is a deliberate, small
concession: these accumulate unattended on a student's disk, where the capture
tool's clips are a two-minute deliberate act.

### 2.4 Nothing is written until the student answers

The three JPEGs are held **in memory** as a `PendingCorrection`, keyed by a
`correctionId` that rides out on the nudge (`NudgeEvent.correctionId?: string`,
one optional field, exactly as `pause?: boolean` was added). The pending
capture is dropped, and the bytes with it, when any of these happens first:

| dropped when | why |
| --- | --- |
| the student answers | it has become a record, or been discarded |
| they press **Start the clock again** with no verdict | silence is not a label |
| `CORRECTION_ANSWER_WINDOW_MS` (10 min) elapses | a verdict given ten minutes and one context switch later is about a moment they no longer remember |
| another pause is raised | one pending capture at a time; the newer moment is the one on screen |
| the app quits | memory is memory |

So the disk only ever holds frames a student deliberately labelled, and the
default path through the feature — pause, restart, carry on — writes nothing at
all. This is the single most important privacy property in the design and it is
structural rather than a setting: there is no code path from "a pause happened"
to "a file exists".

When the window lapses the renderer hides the chips (the pushed
`DeskCorrectionsState.pending` goes null), so the screen never offers a button
that would fail.

### 2.5 The cap, and why it does not delete anything

`CORRECTION_CAP_GROUPS` = 120 (≈ 9 MB at three frames each). At the cap the
loop **stops storing photos** and says so; it does **not** delete the oldest.
Auto-deleting a student's own images to make room for more of their images is
exactly the kind of quiet decision this feature exists to stop making.

At the cap the verdict chips still work and still mean everything they meant:
the record is written with `capped: true` and `frames: []`, the cooldown arms,
the Focus Plan retraction happens, the count goes up. Only the photos are
skipped, and Settings says: *"120 corrections stored — the most this keeps.
Delete some, or retrain, to record more."* The behavioural half is the
student's authority and is never rationed; the statistical half is disk and is.

---

## 3. On disk

### 3.1 The directory

```
<userData>/desk-corrections/
  corrections.json                  the index — records, counts, cooldowns
  frames/
    dc-0007/frame-0001.jpg          what the model saw, native size, q85
    dc-0007/frame-0002.jpg
    dc-0007/frame-0003.jpg
    dc-0007/thumb.jpg               160px, q70 — the review list
  personal-attention-head.json      ONLY when the gate passed (§7)
  refit-report.json                 every refit, passed or failed
```

A sibling of `adaptive-model.json` and `focus-plan.json`, and for the third
time the same stated reason: derived data that can always be thrown away, and
losing it must never take settings or the log with it. `DESK_CORRECTIONS_DIR`
and `correctionsPath(dir)` are exported from `src/main/store/appStore.ts`
beside `planLedgerPath`, so a tool cannot invent the filename.

`corrections.json` is written with the store's existing `writeJsonAtomic`, on
record / delete / refit only — a handful of writes a day.

### 3.2 `corrections.json`

```jsonc
{
  "v": 1,
  "lifetimeCorrections": 41,
  "corrections": [ /* DeskCorrection, oldest first, cap 120 */ ]
}
```

One `DeskCorrection` (full type in the appendix) carries: an id, the epoch ms
and local day of the pause, the `kind` that paused, the `verdict`, what the
model said and how sure it was, the resolved `label` and `head`, the split, the
desk model id, the hash of the attention head that was running, the frame list,
and the Focus Plan retraction if there was one.

Each `DeskCorrectionFrame` carries its file name, size, the model's own call on
*that* frame, and — the only derived numbers kept — the **16 hidden
activations** of the frozen `1280 → 16` layer, stamped with the base head hash
they were computed against:

```jsonc
{ "file": "frames/dc-0007/frame-0002.jpg", "at": 1773... , "bytes": 34112,
  "predicted": "phone", "confidence": 0.9412,
  "hidden": [0, 1.83214, 0, 0.41277, ...],   // 16 numbers
  "hiddenFor": "9f2c1ab4e7d05613" }
```

**Sixteen numbers, not 2025.** The refit fits the output layer only (§6.2), so
sixteen activations are the whole of what it needs. Storing the full 2025-d
`extractDeskFeatures` vector would be 8 KB per frame of derived data the JPEG
can always regenerate, and keeping less of the student's data on disk is the
point. If a future app update ships a different attention head, `hiddenFor`
stops matching and the activations are recomputed from the JPEGs — the JPEG is
the durable source of truth, the activation is a cache.

**When the cache is filled.** Extracting features costs ~1.0–1.4 s per frame
and must never compete with the enforcement loop, so the extraction queue runs
**only while no session is active** — it drains on session stop and at app
start, three frames at a time, guarded, and a failure leaves `hidden: null` and
costs nothing but a slower refit. `refit` fills any gaps itself before it fits,
with a progress line, so a machine that never idled still works.

### 3.3 The CSV, in the existing ten columns

`<userData>/desk-corrections/` holds no CSV. The CSV is written by the
**export** script (§10) into `datasets/desk-attention-labels.csv`, in its
existing ten columns, with no new column and no existing row touched — the same
promise the proxy ingest and the first-person capture both kept.

| column | value | why |
| --- | --- | --- |
| `path` | `first-person/corrections/dc-0007/frame-0002.jpg` | the `first-person/` prefix is **load-bearing**: `isFirstPersonRow` is true, so the trainer, the eval, the group-count gate, `--first-person-weight` and `readFeatureRows`'s bucket skip all already do the right thing with zero code changes |
| `split` | odd correction number → `train`, even → `eval` | exactly `clipSplit`; assigned per correction, never per frame |
| `group` | `dc-0007` | **one correction is one group** |
| `attention` | `focused` / `phone`, or `""` for a presence correction | §1.2 |
| `person` | `face_or_body` | derived, as `buildCaptureRow` derives it |
| `workspace` | `True` | derived |
| `phone` | `in_use` when `attention` is `phone`, else `none` | derived |
| `gaze` | `phone` / `work` / `elsewhere` | derived |
| `note` | `first-person correction: the model said phone at 0.94, the student said focused; labelled in-app at the pause, not annotated` | so nobody ever mistakes these for annotated photos, and so the model's own call survives next to the truth |
| `pack_label` | `focused` / `phone` / `at_desk` / `away` | honestly where the row came from — the student's verdict, in the vocabulary of the head it is evidence for |

`person` / `workspace` / `phone` / `gaze` are **derived from the verdict, not
observed** — identical to the rule for self-labelled clips and bucket-labelled
proxies, and the `note` says so on every row.

### 3.4 One correction is one group, and the eval already knows it

Three frames five seconds apart are one independent sample. Putting the
correction id in the `group` column buys, for free and with no new code:

* the train/eval split can never cut a correction in half
  (`train-attention.ts`'s validation split is group-aware);
* `eval-attention.ts` counts **clips, not frames**, on every printed
  first-person number, and `assertClipCounted` throws rather than print a
  percentage with no group count behind it;
* `FIRST_PERSON_MIN_EVAL_GROUPS` (3) already refuses to print a first-person
  accuracy at all below three independent groups, and prints the census
  instead.

The on-device refit inherits the same discipline explicitly (§6.4): its
per-frame weights are `1/framesInGroup`, so **a correction is one vote however
many frames it carries**, and every number the UI prints names corrections, not
photos. Nothing in this feature is allowed to say "36 samples" about 12
corrections.

### 3.5 Privacy, structurally

The claim is not "we promise". It is a list of places where the alternative is
absent from the code:

* **Nothing is captured on a default install.** The ring is null unless the
  trained model is running with a pause switch on; a `blazeface` install cannot
  reach any of this.
* **Nothing is written without a deliberate tap.** §2.4. No timeout writes, no
  dismissal writes, no background sampling. The frames of a pause nobody
  answered are freed.
* **Nothing is uploaded.** There is no network module in `src/main/desk/**` and
  none is added; the purity fence over `src/shared/correction/**` forbids one
  the same way `src/shared/plan/purity.test.ts` does for the plan core. The
  export script (§10) is a developer command that is not shipped to students
  and does not run in the app.
* **Nothing is hidden.** Settings lists every correction with a thumbnail, the
  date, what the model said, what the student said, and the byte count, plus a
  *Reveal folder* button that opens `<userData>/desk-corrections/` in the OS
  file manager. Seeing the actual files is a stronger guarantee than any
  sentence this doc can write.
* **Deletion is one action and it is real.** *Delete all my correction photos
  (41 · 3.1 MB)* behind `ConfirmAction` removes the frame tree, the index, the
  personal head and the refit report with `rmSync(..., { recursive: true })`.
* **A head fitted on deleted data is deleted data.** Clearing corrections
  deletes `personal-attention-head.json` too and reverts to the shipped head.
  Keeping a model fitted on photographs the student just erased would be the
  loophole that makes the erase cosmetic.
* **…and it reverts on the next reading, not the next restart.** Unlinking the
  file is only half of removing a head. `YourModel` reads its weights once in
  `init()` and `factory.ts` caches that instance across session start and stop,
  so a deleted head would go on deciding every frame — the frames that stop the
  clock — while Settings, re-reading the now-missing file, truthfully said
  *shipped*. Running one head and claiming the other is the exact failure
  `personalHeadFits` exists to stop, and it may least of all happen on the
  privacy action. `clear()` therefore calls `syncPersonalHead({ force: true })`
  in a `finally`, dropping the cached model the way a finished refit already
  does; `force` because the path did not move, only the file did.
  `src/main/desk/corrections/delete-all.test.ts` asserts this on a real
  inference through the real factory: `debug.attentionHead` is `personal`
  before the tap and `shipped` on the very next reading after it, and the
  reading's label flips with it.
* **What deletion does *not* undo, and says so:** a Focus Plan retraction. The
  student said "that drift was wrong" and their history was corrected; deleting
  the photographs is a statement about the photographs. The Settings copy says
  this in one sentence rather than leaving them to find out.

The frames are the student's own webcam images of the student's own room. This
design treats them the way the rest of the repo treats the desk-data pack:
**only learned numbers travel, and never the pictures.**

---

## 4. The immediate half: resume, and the cooldown

### 4.1 What the cooldown suppresses, and what it must never touch

A `verdict: "wrong"` arms a per-kind silence. While it is armed, a reading of
that kind is treated by `NudgeTracker` as **unsure** — the same class as a
low-confidence reading, an `uncertain` label or a webcam that is off. It breaks
both streaks, re-arms nothing, and produces neither a pause nor a nudge. One
mechanism, one code path:

```ts
// readDrift(), src/main/session/nudge.ts
if (isPauseKind(kind) && policy.silenced.includes(kind)) {
  return null;      // unsure: not a drift, and not a recovery either
}
```

`DriftPolicy` gains exactly one field, `silenced: readonly PauseKind[]`, and
`silenced: []` reproduces today's behaviour byte for byte.

The nudge is silenced along with the pause, not only the pause. The student has
just told you, in words, that this reading is wrong about them *right now*; the
window jumping to the front and the lamp coming on every 30 s for the rest of
the round is the nag, and "so it cannot nag" is what the cooldown is for. The
false-`phone` pose this loop exists to fix — head down over a notebook — is one
a student holds for a whole round, at 0.99 confidence
(`docs/CUSTOM-MODEL.md § Stock attention proxies`), so a cooldown that silenced
only the pause would leave them nudged sixty times.

**Five things the cooldown must never touch, and does not:**

| never touched | why it is safe |
| --- | --- |
| the fuse and the kill | the cooldown lives in `NudgeTracker`, which has no seam into `PolicyEngine`. A silenced `away` still produces `Decision: AWAY`, still arms the countdown, still force-quits Discord. Enforcement is not a coaching decision and the student's verdict does not get a vote in it. |
| `blocked` nudges | a different `NudgeKind`, never silenceable — `silenced` is typed `PauseKind[]`, so a blocked-app nudge cannot be suppressed by construction |
| `unfocused` | same: not a `PauseKind`, cannot be corrected, cannot be silenced |
| the other kind | correcting a phone pause silences `phone`. `away` keeps working. |
| Focus Plan's drift definition | the retraction (§5) removes an onset that was recorded; it does not stop new ones being recorded |

So the worst case of a cooldown is: for ten minutes after a student swore they
were at their desk, if they then leave, the lamp does not come on. They still
get force-quit. That is a price worth naming and worth paying.

### 4.2 It is derived, not stored, and that is what makes it survive the resume

The obvious implementation — a timestamp in `NudgeTracker` — is wrong, and
wrong in a way that would ship and never be noticed. **"I was working" resumes
the clock**, the resume calls `startSession()`, and `SessionController.start()`
calls `this.nudges.reset()`. The cooldown would be wiped by the very tap that
armed it.

So the cooldown is not stored anywhere. It is **derived from the correction
records**, which are already on disk:

```ts
silencedUntil(kind, now) = max over corrections c where
    c.kind === kind && c.verdict === "wrong"
  of c.at + CORRECTION_COOLDOWN_MS[kind]
```

`SessionController.driftPolicy()` — which is already rebuilt from settings on
every single reading, precisely so a mid-session switch takes effect on the
next frame — asks the corrections service for the currently silenced kinds and
ANDs them in, exactly as it already ANDs `deskModelMayPauseOnAway` into
`pauseOnAway`. Three properties fall out for free:

* it survives `NudgeTracker.reset()`, so the resume cannot cancel it;
* it survives an app restart, so a crash does not resurrect the nag;
* **deleting a correction drops the cooldown it armed** — the state and the
  evidence for the state are the same object, so they cannot disagree.

There is no second piece of state, and therefore no way for the two to drift
apart.

### 4.3 Lengths, and why they differ

| kind | cooldown | reasoning |
| --- | --- | --- |
| `phone` | **25 min** = `PLAN_DEFAULT_FOCUS_MIN` | one Classic focus block. The head is wrong on ~17% of non-phone frames and its worst error is a *pose* (head down over a notebook at 0.9955) that lasts as long as the work does. A five-minute silence would simply re-fire. |
| `away` | **10 min** | the presence head is right on 92.5% of its `away` calls, and its false positives are transient — bending down for a pen, a dark second, a hand across the lens — not a pose. A shorter silence costs less because the signal is better, and being wrong about a real departure for ten minutes is a lamp, not a kill. |

Both are constants, not settings. A slider here would be a slider on how much
the app is allowed to disbelieve you, which is not a number a student should
have to think about.

**What the screen says.** After the tap the paused screen becomes, for the
second before the clock takes over:

> *Started again. FocusPlug will not pause you for a phone for the next
> 25 minutes, and the photos from that moment are saved on this computer.*

and Settings shows any live cooldown as *"Phone pauses are off for another
18 minutes — you corrected one at 21:04."*

---

## 5. Retracting a false drift from Focus Plan

### 5.1 What can be retracted, and what cannot

Only an `away` correction retracts anything (§1.2): only the presence label
reaches `classify()`, so only it can have produced a drift. And what it
produced is one entry in `PlanRound.driftsSec` — possibly the round's
`firstDriftSec`, which *is* minutes-until-first-drift, the one headline number
Focus Plan computes.

Three things are **not** retracted, deliberately:

* **`countdowns` and `kills`.** They happened. Discord really was force-quit.
  The debrief's cost line still reports them, and it should: "the fuse burned,
  and you told us that drift was wrong" is the honest sentence, not "no fuse
  ever burned".
* **A `tab_out` onset.** If a blocked app was in front, `classify()` returns
  `DISTRACTED` before it ever looks at the desk, so the onset is about the
  window and not about the camera. §5.2's rule refuses those by name.
* **Anything in a round that has already been superseded.** §5.5.

### 5.2 The rule: the last still-open `walk_away` onset, and nothing else

The pause fires *inside* an away episode, but the onset that episode produced
happened earlier — as soon as `desk.confidence` cleared `deskThreshold` (0.60),
well before it cleared `pauseAwayConfidence` (0.75) for fifteen seconds. So
"retract the onset at the pause instant" would retract nothing. And "retract
every `walk_away` onset in the round" would delete real drifts from earlier in
the evening.

The rule that is exactly right, and turns out to be simple:

> Retract **the last recorded onset**, and only if
> (a) the round's decision stream was still drifted when the round closed, and
> (b) that onset's drift type is `walk_away`.

Because `stepOnset` only records an onset when the stream *enters* a drift from
a non-drifted state, and merges onsets within `DRIFT_DEBOUNCE_SEC` (30 s), the
currently-open episode has exactly **one** onset: the last one. Condition (a)
says the episode is the one still running when the pause stopped the clock;
condition (b) says the camera caused it.

This rule has a happy consequence. `PlanRound.firstDriftType` is only ever
recorded for the *first* onset. Retracting the last onset can only affect
`firstDriftType` when the last onset **is** the first — i.e. when
`driftsSec.length === 1` — in which case the round becomes censored and both
`firstDriftSec` and `firstDriftType` go to `null` together. In every other case
the first onset survives untouched. **`firstDriftType` never needs
recomputation**, and there is no case where the ledger has to store a drift
whose flavour it does not know.

### 5.3 Reclassify, do not just subtract

After the onset is removed:

```ts
round.driftsSec        = drifts without the retracted offset
round.retractedDriftsSec = [...(round.retractedDriftsSec ?? []), offset]
round.firstDriftSec    = round.driftsSec[0] ?? null
round.firstDriftType   = round.firstDriftSec === null ? null : round.firstDriftType
round.status           = classifyRound({ servedSec, plannedFocusSec, firstDriftSec, sawStatus: true })
```

The re-run of `classifyRound` is not decoration. Its short-round rule is
asymmetric on purpose — *a short round **with** a drift is real data; a short
round without one is noise* — so a four-minute round whose only drift has just
been retracted must become `discarded`, not enter the estimator as a censored
four-minute observation. Reusing the pure function is what keeps that rule in
one place.

The rewrite is applied in **two** places or it does not stick:

1. `PlanRecorder.carried` — the segment the pause left behind. A resume under
   the same `roundKey` seeds the next segment's onsets from
   `carried.round.driftsSec` (§3.4 of the Focus Plan design), so an un-retracted
   `carried` would resurrect the drift on the very next tick.
2. The ledger entry with that `roundKey`, via `appendPlanRound`, which already
   replaces by key. `lifetimeRounds` is untouched — nothing was added or
   removed, one round changed.

### 5.4 Disclosure: a retraction is never silent

Editing a student's measured history quietly would be worse than the false
drift. So:

* `PlanRound` gains **one optional field**, `retractedDriftsSec?: number[]`,
  the offsets that were removed. Optional and absent by default, exactly as
  `FocusPlanLedger.seed?` is, so `revivePlanLedger` needs no version bump and
  every older ledger reads unchanged.
* The evidence row (`PlanEvidenceRow`) renders *"one drift retracted — you told
  us the camera was wrong"* under the held minutes, in the same grey the
  ineligible rows already use. A student who reads "held 24 minutes" in the
  card and remembers being interrupted at six can always find out why the two
  disagree. That is H9 applied to a new way of disagreeing.
* One log line, kind `plan`, next to the round it belongs to:
  `plan · round 2 — drift at 6.2 min retracted (the away reading was wrong)`.
* One log line, kind `correction`, for the correction itself.

### 5.5 The refusals, named

`retractLastAwayDrift()` returns a `PlanRetraction` and never throws — it runs
under the recorder's existing `attempt()` guard, so a retraction that fails
costs the retraction and never the session. When it refuses it says which gate
stopped it, exactly as `PlanTrend.blockedBy` does:

| refusal | when |
| --- | --- |
| `plan-off` | `focusPlanEnabled: false` — there is no history to correct |
| `pinned` | `FOCUSPLUG_NO_PLAN=1` — the filming pin writes nothing, including this |
| `no-round` | no `carried` round: the app restarted between the pause and the answer, or the round never opened |
| `no-onset` | the round recorded no onsets at all |
| `not-open` | the round did not close while still drifted — the episode had already ended, so the pause and the last onset are not the same event |
| `not-away` | the last onset is a `tab_out`: a blocked app caused it, not the camera |
| `capped` | the round hit `PLAN_MAX_DRIFTS_PER_ROUND` (12), so "the last recorded onset" is not necessarily the last onset and cannot be identified |

A refusal is reported in the UI as one quiet line (*"your focus history was not
changed — that round had already ended"*) and never as an error. The
behavioural half — resume and cooldown — has already happened and does not
depend on it.

---

## 6. The deferred half: the refit

### 6.1 One click never retrains, in four structural steps

| # | guarantee | how |
| --- | --- | --- |
| 1 | recording touches no weights | `CORRECTIONS_RECORD` writes JPEGs and one JSON record. There is no call path from the record handler to any fitting code; `integration.test.ts`'s analogue asserts it. |
| 2 | the refit is a separate, explicit action | `CORRECTIONS_REFIT`, reachable only from Settings → Desk model, behind a button that is disabled until the floors are met and refused outright while a session is active |
| 3 | the refit cannot overwrite the shipped head | it writes `<userData>/desk-corrections/personal-attention-head.json`. `src/main/desk/model/weights/attention-head.json` is never opened for writing by the app, and on a packaged install it is inside a read-only bundle. |
| 4 | passing the refit is not the same as installing it | the gate decides (§7). A failing refit **deletes** any personal head that was there and writes only `refit-report.json`, so there is no "inactive head" file for a bug to load by accident. |

The floors, mirroring the numbers this repo already uses rather than inventing
new ones:

* `CORRECTION_REFIT_MIN_GROUPS` = **12** independent corrections, which is
  `CONFIDENCE_DRIFTS` from `src/shared/adapt/model.ts` — "real drifts after
  which the model is trusted as far as it will ever be". The same bar, one
  layer up, for the same reason `PLAN_CONFIDENCE_ROUNDS` borrowed it.
* `CORRECTION_REFIT_MIN_TRAIN_GROUPS` = 6 and
  `CORRECTION_REFIT_MIN_EVAL_GROUPS` = 3, the latter being exactly
  `FIRST_PERSON_MIN_EVAL_GROUPS`. Below either, the refit prints the census and
  a refusal **instead of a number**, which is the same shape as
  `firstPersonRefusal`.

**Automatic or asked for?** Asked for. Three reasons, in order of weight: a
model that changed itself without the student asking is the exact failure this
whole feature exists to correct; the fit is a few seconds of CPU that should
not start behind their back; and the swap is a thing they are entitled to
notice. The app *offers*, in one place — Settings → Desk model, where the head
status card counts what is stored, says how many more are needed and enables
*Fit a personal head* only once the floors are met — and nothing happens until
the student presses it. The offer is deliberately **not** carried into the
debrief: a coaching screen that asks to retrain a model is a coaching screen
that has started selling something.

### 6.2 What is refit: fifty-one numbers

The shipped attention head is `1280 → 16 → 3`
(`attention-head.json`: `inputSlices [[745, 2025]]`, `featureDim 1280`,
layers `(16×1280 + 16)` then `(3×16 + 3)`). The refit fits **the output layer
only** — 3×16 weights plus 3 biases, **51 numbers**. The 1280→16 representation,
the slice, the mean and the std are the shipped ones and are not touched.

Why this and not the whole head:

* **51 parameters is a number twelve independent samples can honestly move**,
  and it is the same order as the 17-parameter logistic `src/shared/adapt`
  fits from a dozen drifts. 20,000 parameters is not.
* **"A gradient step cannot wreck a head fitted on thousands of images"
  becomes structural**, not a hope: the thing that was fitted on thousands of
  images — the representation — is physically not in the file the refit writes.
* **The personal head is 51 numbers on disk**, not a 289 KB copy, so a
  `baseHeadHash` mismatch after an app update discards a delta rather than
  silently keeping a stale full model.
* **It makes the gate's anchor set 16 numbers per image instead of 1280**
  (§7.1), which is what lets a held-out eval ship in a small JSON file.

### 6.3 The blend: prior-anchored, because the shipped images cannot ship

"Blend shipped data with personal corrections" has an obvious implementation —
put both in one training pool — and it is not available here, for a reason
worth stating rather than working around:

> **The shipped head's training images cannot be redistributed.** The
> desk-data pack is third-party stock, and one bucket (`nc/`, the Edinburgh
> office webcam frames) is CC BY-NC-SA. `docs/CUSTOM-MODEL.md` says it in as
> many words: *only learned weights ship, never the images.*

So the shipped data is present in the only form we are allowed to have it in —
**the shipped weights** — and it enters the fit as the point the regulariser
pulls toward. This is not a workaround; it is exactly what
`src/shared/adapt/model.ts` already does on this machine:

> *The regulariser pulls toward the shipped prior rather than toward zero, so
> four samples cannot run away with the model — it stays close to sensible
> defaults until it has earned the right to disagree with them.*

The objective, over the output layer `θ = (W, b)` with the shipped layer
`θ₀`, correction frames `(h_i, y_i)` and per-frame weights `w_i`:

```
L(θ) = ( Σ_i w_i · crossEntropy(softmax(W h_i + b), y_i) ) / Σ_i w_i
     + λ · ‖θ − θ₀‖²

λ = CORRECTION_ANCHOR_L2 · ANCHOR_EVIDENCE / (ANCHOR_EVIDENCE + G)
```

where `G` is the number of independent correction **groups** and
`ANCHOR_EVIDENCE` = **693**, the labelled train rows the shipped head was
actually fitted on (`attention-head.metrics.json`: `dataset.train` 584 +
`dataset.val` 109 — a test asserts the constant still equals what that file
says, so it cannot rot).

That λ is a literal statement of how much evidence each side has. At the floor
of 12 corrections the ratio is 693/705 = 0.983, so the anchor is at full
strength and twelve corrections tilt the boundary rather than redraw it. At the
120-correction cap it is 0.85 — still a strong pull. **The ratio only becomes
visible in the hundreds, which is the arithmetic meaning of "a handful of
corrections must not dominate."**

**About `CORRECTION_ANCHOR_L2 = 1.5`, honestly.** It is not derived, and it is
no longer a guess either: it was measured against the two controls in
`src/shared/correction/gauntlet.ts` (`npm run gauntlet:corrections`), over 200
synthetic students per arm, and nothing else. The whole sweep, so nothing is
hidden — installs on shuffled labels / installs on real signal:

| `CORRECTION_ANCHOR_L2` | false install | true install | typical drift |
| --- | --- | --- | --- |
| 0.05 *(the original guess)* | 0.0% | **0.0%** | 50% |
| 0.5 | 0.0% | **0.0%** | 19% |
| 1.0 | 0.5% | 84.5% | 12% |
| **1.5** | **1.0%** | **95.5%** | **8%** |
| 3.0 | 2.0% | 99.0% | 5% |
| 4.0 | 3.0% | 97.0% | 4% |

The first two rows are why this number moved. At the original 0.05 the fit
travelled half the length of the output layer for a clean, easily separable
signal, `drifted-too-far` refused it, and **no student's corrections could ever
have installed anything** — the deferred half of the feature was dead while
looking alive. The gates were doing their job; the fit was too aggressive for
them to have anything to weigh. `refit-report.json` prints the λ it used, so a
bad value is still visible in the artifact rather than inferred from behaviour.
Anyone tuning it again should tune it against that gauntlet, not against one
student.

**A hard trust region on top.** Even with the anchor, the fit refuses to travel
far: if `‖θ − θ₀‖ > CORRECTION_MAX_DRIFT_RATIO · ‖θ₀‖` (ratio 0.5) the refit
fails with gate `drifted-too-far`. A scale-free belt over the braces, and one
more thing that has to be true before anything installs.

### 6.4 A correction is one vote, however many frames it carries

Two weightings, in this order:

1. **Group normalisation.** Each frame's weight starts at `1 / framesInGroup`.
   Three frames of one correction contribute one unit of evidence between them.
   This is the single most important line in the fit, and it is the same rule
   `first-person.ts` enforces on the eval side: *a clip is one sample however
   many frames it holds.*
2. **Class balancing**, over the correction pool, capped at
   `CORRECTION_CLASS_WEIGHT_CAP` = 4 — the identical rule and identical cap
   `train-attention.ts` uses, so the two trainers cannot disagree about what
   class imbalance means.

The realistic failure mode this pair does *not* fix, and the gate does: a
student who only ever taps **I was working** teaches the head one thing, "never
say `phone`". Nothing in the fit stops that. What stops it is the shipped
anchors: a head that never says `phone` loses every one of the 85 `phone`
images in the held-out eval, fails the no-regression gate by a mile, and never
installs. The guard is where it belongs — on the outcome, not on the student's
honesty — and it is why the confirmation chip matters even though the fit does
not require it.

### 6.5 Determinism, for free

Fifty-one parameters over at most 360 frames is a **full-batch** problem. The
fit starts at `θ₀`, takes `CORRECTION_REFIT_EPOCHS` = 300 full-batch gradient
steps at `CORRECTION_REFIT_LR` = 0.05, and stops. There is no minibatching, no
shuffling, no random initialisation and therefore **no PRNG and no seed** — the
refit is a pure function of (shipped layer, corrections, constants), which is
also why `src/shared/correction/refit.ts` can be pure and unit-tested without a
data pack.

There is also **no early stopping**, deliberately. `docs/CUSTOM-MODEL.md`
already records what early stopping on one small validation slice does to this
head — *"one run of this recipe is a lottery; at seed 42 the best epoch was
epoch 3"*. With six training groups there is nothing to early-stop on that is
not noise. Fixed steps plus a strong anchor is the honest configuration.

### 6.6 Always anchored to the shipped layer, never to the last personal one

Every refit starts from `θ₀` = the **shipped** output layer, never from the
personal head currently installed. Refitting from the last personal head would
compound: ten refits and the anchor means nothing, the trust region has been
paid for ten times over, and the head has walked arbitrarily far from anything
that was ever evaluated. Starting from the shipped layer every time means the
distance from the shipped head is bounded by one trust region **forever**, no
matter how many times the student presses the button.

---

## 7. The gate

### 7.1 The anchors: a held-out eval that fits in a JSON file

The gate compares the personal head with the shipped head **on the existing
held-out eval** — the same 286 images `eval-attention.ts` scores today (200
Adaption-annotated stock + 86 stock attention proxies). That eval has to be on
the student's machine, and shipping 286 photographs is out of the question.

It does not have to be. Because only the output layer is refit, both heads
share the frozen `1280 → 16` bottleneck, so the only thing either head needs
from an eval image is its **16 hidden activations**:

```
src/main/desk/model/weights/attention-anchors.json     ~60 KB, committed
{ "v": 1,
  "baseHeadHash": "9f2c1ab4e7d05613",
  "hiddenDim": 16,
  "labels": ["focused","unfocused","phone"],
  "rows": [
    { "path": "eval/at_desk/main_at_desk_f1f031b4c4fb.jpg",
      "slice": "adaption", "truth": "focused",
      "hidden": [0, 1.83214, 0, 0.41277, ...] },
    ...286 rows
  ] }
```

Sixteen numbers out of a frozen bottleneck is categorically the same kind of
artifact as the learned weights this repo already ships, and categorically
unlike a photograph: no image is recoverable from it, and the `path` strings
are already public in `datasets/desk-attention-labels.csv`. The builder
(`npm run anchors:attention`) enforces the one hard licence rule anyway —
**no row whose path is in the `nc/` bucket may enter the pack** — which is
today vacuous (no `nc` image was ever attention-labelled) and is asserted so it
stays vacuous.

Two properties make the anchors trustworthy rather than merely convenient:

* **`baseHeadHash`.** The activations are only meaningful for the layer 0 they
  were computed against. If an app update ships a different attention head and
  someone forgets to rebuild the anchors, the hashes disagree, the gate fails
  with `stale-anchors`, and no head installs. It cannot silently score the
  wrong thing.
* **A parity test.** `anchors.test.ts` scores the shipped output layer over the
  anchors and asserts it reproduces, to the last image, the numbers
  `eval-attention.ts` prints for the same slices. That is the same move
  `eval.ts --e2e` makes for the presence head: the shortcut is only allowed to
  exist because it is pinned to the long way round.

### 7.2 The gates, in order, and it names the one that stopped it

Evaluated in this order; the **first** failure is `blockedBy` and the rest are
still reported. Exactly the shape of `PlanTrendGate`.

| # | gate id | bar |
| --- | --- | --- |
| 1 | `not-custom-model` | `deskModelId === "custom"` — there is no attention head otherwise |
| 2 | `session-active` | no session is running. The instrument does not change mid-measurement, and the refit does not compete with the enforcement loop for CPU. |
| 3 | `too-few-corrections` | ≥ `CORRECTION_REFIT_MIN_GROUPS` (12) attention-head corrections |
| 4 | `too-few-train-groups` | ≥ 6 on the train side |
| 5 | `too-few-eval-groups` | ≥ 3 on the held-out side — `FIRST_PERSON_MIN_EVAL_GROUPS` |
| 6 | `stale-base` / `stale-anchors` | the cached activations, the anchors and the shipped head all agree on `baseHeadHash` |
| 7 | `drifted-too-far` | `‖θ − θ₀‖ ≤ 0.5 · ‖θ₀‖` |
| 8 | **`regressed-pooled`** | balanced accuracy on all 286 anchors: **personal ≥ shipped. Margin 0.** |
| 9 | **`regressed-slice`** | neither slice (200 Adaption, 86 proxy) drops by more than `CORRECTION_MAX_SLICE_DROP_PTS` = 3.0 points of balanced accuracy |
| 10 | **`no-personal-gain`** | on the student's **held-out corrections**, scored per correction by majority vote of its frames, the personal head agrees with the student on at least `CORRECTION_MIN_GAIN_GROUPS` = **1** more correction than the shipped head does |

Gate 8 is the brief's requirement stated exactly: *a personal head that scores
worse than the shipped head on the existing held-out eval must not replace it.*
Margin 0 — "must not be beaten" — is the same bar the forecast's CI gate
settled on, for the same reason: a positive margin you cannot measure is a
number you made up.

Gate 9 exists because the repo refuses to pool those two populations
(`--exclude-proxies` / `--proxies-only` are separate commands and the report
prints which set it scored). A pooled gate alone could be passed by improving
the 200 while wrecking the 86, and the 86 are the hard negatives — the
head-down-over-a-notebook photos this whole loop is aimed at. The tolerance is
3.0 points rather than 0 because one image is **1.16 points** on an 86-image
slice: a zero-tolerance slice gate would be a coin-flip veto, and the pooled
gate at margin 0 already carries the no-regression claim.

Gate 10 exists because a head that merely did no harm should not be installed.
It is stated in **corrections, not frames, and not points**: "at least one more
held-out correction where it now agrees with you and the shipped head did not."
That is a sentence a student can check, and it scales by itself as their
corrections accumulate.

Note what gate 9's proxy slice measures: `focused` 72, `phone` 14, `unfocused`
**0**. Balanced accuracy there is macro-recall over the two classes present,
and the report says so on the line above the number rather than quietly
averaging over a class with no images in it.

### 7.3 Reported beside the gate, never as the gate

Following `scripts/forecast/eval.ts`, the report also carries what the gate is
*not* allowed to use:

* a **paired bootstrap** of (personal − shipped) balanced accuracy over the
  286 anchors, `CORRECTION_BOOTSTRAP_DRAWS` = 2000 draws, printed as
  `+0.3 pts [−1.1, +1.8]`. With 286 items and 51 refit parameters that interval
  will usually straddle zero, and the honest sentence is *"no measurable
  difference on stock photos"* — which is the correct outcome for a
  no-regression gate and must not be dressed up as an improvement;
* phone precision / recall / F1 for both heads on both slices, because a head
  that says `phone` less often is the likeliest thing this loop produces and
  the report should show it directly;
* the per-correction table for the held-out corrections: what the model said,
  what the student said, and what each head says now.

### 7.4 What none of this proves, said before anyone quotes it

The anchors are **third-person stock photographs**. A personal head fitted on
first-person webcam frames being *not worse* on third-person stock is a
do-no-harm claim and nothing else. The only first-person evidence in the whole
gate is gate 10, and it rests on between 3 and 60 independent corrections from
one person in one room.

So the UI never says "your model is better". It says, in numbers a student can
count on their fingers: *"it agrees with you on 5 of your 6 held-out
corrections; the shipped one agreed on 2."* And `copy.test.ts` enforces the
discipline that `assertClipCounted` enforces in the eval script — every
produced sentence containing a ratio or a percentage over corrections must name
the number of **corrections** behind it. Here that is enforced by the types as
well as by a test: every `SliceScore` carries its `groups`, and the copy
functions take the whole `SliceScore`, so a number without its group count is
not constructible.

### 7.5 The escape hatch, and how it records itself

`CORRECTIONS_REFIT` takes one optional argument, `{ gate: "off" }`, reachable
only from a dev build's console — never from a button. It runs the fit, skips
gates 8–10, installs the head, and **stamps `"gate": { "enforced": false }`
into `refit-report.json`**, which the Settings card then renders as
*"personal head installed with the gate off"* in red until the next real refit.
The claim can be skipped; it can never be faked. That is
`scripts/forecast/eval.ts --gate=off`, verbatim, one product layer up.

---

## 8. Which head is active, and what the UI says

`Settings → Desk model` gains a block under the model picker. Three states,
three pieces of real copy:

**No personal head, not enough corrections yet**

> **Attention head — shipped.** Trained on 693 labelled stock photographs. It
> is right about phones roughly half to two thirds of the time and calls about
> one non-phone photo in six a phone; that is why *pause on phone* ships off.
> **You have 7 corrections stored.** Twelve are needed before a head can be
> fitted from them.

**Personal head installed**

> **Attention head — personal**, fitted 12 March from 14 of your corrections.
> On the same 286-image held-out eval the shipped head scores 61.9% and this
> one 62.6%; the difference is +0.7 points, 95% interval −1.1 to +2.4, which is
> to say: no measurable difference on stock photographs. On **your own six
> held-out corrections** it agrees with you five times; the shipped head agreed
> twice.
> [ Use the shipped head ]   [ Retrain ]   [ Why this? ]

**Last refit failed**

> **Attention head — shipped.** The last refit (12 March, from 13 corrections)
> scored 60.1% against the shipped head's 61.9% on the held-out eval and was
> **discarded** — `regressed-pooled`. Your corrections are kept; nothing was
> deleted. Correct a few more and try again.

*Why this?* opens the same disclosure Focus Plan's evidence table uses: every
gate, in order, pass or fail, with its numbers, and the λ, the epochs and the
correction ids that went into train and eval. A student who wants to know why
their model did or did not change can read the whole decision.

**`personalAttentionHeadEnabled`** (default `true`) is the revert: off means
the shipped head always runs, whatever is on disk. It is a preference and not a
capability — it can only ever turn *off* a head the gate already let in.

**Loading it at runtime.** `YourModel` gains an optional third constructor
argument, the personal head path, threaded from `runtime.ts` through
`DeskMonitorOptions` and the factory. After loading the shipped attention head
it looks for the personal delta, validates it (`v`, labels, shapes, and
`baseHeadHash` against the shipped file's hash), and **replaces the last layer
only** — the delta file physically cannot alter layer 0, the slice, the mean or
the std, because it does not contain them. Any mismatch, any parse failure, any
missing file: the shipped head runs, silently and safely, the same way a
missing `attention-head.json` already degrades to presence-only.

A refit runs with no session active, so the swap has no race with the desk
loop; `clearSharedDeskModel("custom")` drops the cached instance and the next
session builds a fresh one.

---

## 9. Review and delete

`Settings → Desk model → Your corrections`, its own card:

```
Your corrections                                    41 · 3.1 MB
Photos from the moments FocusPlug got it wrong (and the ones it got
right). They are on this computer, in desk-corrections/, and they are
never uploaded.                     [ Reveal folder ]   [ Delete all ]

┌──────┐  12 Mar 21:04 · the model said phone (0.94)
│ img  │  you said: I was working          3 photos · 104 KB   [ Delete ]
└──────┘
┌──────┐  12 Mar 20:31 · the model said phone (0.91)
│ img  │  you said: you were right         3 photos · 98 KB    [ Delete ]
└──────┘
┌──────┐  11 Mar 19:12 · the model said away (0.88)
│ img  │  you said: I was here             3 photos · 112 KB   [ Delete ]
└──────┘                     presence evidence — not used to retrain
```

* newest first, a 160 px thumbnail per correction (written at capture time so
  the list costs one read), the full frames on click;
* per-row **Delete** and a single **Delete all**, both behind the existing
  `ConfirmAction`;
* **Reveal folder** → `shell.openPath(correctionsPath(userData))`. Being able
  to open the directory and look is worth more than any sentence in this doc;
* the byte count is shown because "how much of me is on this disk" is the
  question a privacy affordance actually has to answer;
* an away row is labelled *presence evidence — not used to retrain*, so the
  count in this list and the count on the refit button reconcile on screen
  (the same rule Focus Plan applies to its own greyed evidence rows);
* if a cooldown is live: *"Phone pauses are off for another 18 minutes — you
  corrected one at 21:04."*

**Delete all** removes the frame tree, `corrections.json`,
`personal-attention-head.json` and `refit-report.json`, drops the cached desk
model so the very next reading is the shipped head's rather than the deleted
one's, and appends one log line. The copy states, in one sentence, the one thing
it does not undo: *"Your focus history keeps the drifts you retracted — you
told us those were wrong, and that is still true."*

---

## 10. The export path — developer-side, opt-in, and the only way out

`npm run corrections:export -- --from "<path to a desk-corrections dir>"` is a
**developer command run on a developer's own machine**. It is not in the
shipped app, no UI reaches it, and the app contains no code that transmits a
correction anywhere. It exists so first-person corrections can eventually reach
the shipped head, which is the long-run point of collecting them.

What it does, and refuses to do:

1. copies `frames/<dc-NNNN>/frame-*.jpg` into the data pack at
   `first-person/corrections/<dc-NNNN>/`, never into the repo;
2. appends rows to `datasets/desk-attention-labels.csv` in its existing ten
   columns, through the **same** `csvWithClip` group-replacement the capture
   tool uses, so re-exporting a correction **replaces** its rows rather than
   duplicating a path;
3. refuses a group id that already exists with a different label or split —
   `clipCollision`'s rule, reused, not reimplemented;
4. `--dry-run` prints exactly which files it would copy and which rows it would
   write, and is what the docs tell you to run first;
5. prints the census in **corrections**, never frames, and refuses to print an
   accuracy at all.

Because the exported rows land under `first-person/`, everything downstream
already handles them: `extract-features.ts` picks them up by path prefix,
`readFeatureRows` keeps them away from the presence head, `train-attention.ts`
group-splits them, and `eval-attention.ts` gates them behind the clip count.
**No schema change, and no change to any of those four files.**

---

## 11. Integration seams (why these and not others)

| seam | change | why it is this small |
| --- | --- | --- |
| `src/shared/nudge.ts` | `NudgeEvent.correctionId?: string` | one optional field, exactly as `pause?: boolean` was. Present iff frames are held; absent means the chips do not render. It ties a verdict to one specific pause with no second channel. |
| `src/main/session/nudge.ts` | `DriftPolicy.silenced: readonly PauseKind[]`, one early return in `readDrift` | `silenced: []` is today's behaviour byte for byte. The type forbids silencing `unfocused` or `blocked`. |
| `src/main/session/controller.ts` | ANDs the cooldown into `driftPolicy()`; snapshots the ring on a pause; passes `correctionId` to `nudge()` | `driftPolicy()` is already rebuilt per reading; the snapshot is one call **before** the pause reaches the renderer, which is the only ordering that works |
| `src/main/desk/monitor.ts` | an optional `FrameRing` and `peekFrames(sinceMs)` | frames already in hand, kept only when a correction could use them, cleared on stop |
| `src/main/desk/model/your-model.ts` | optional personal-head path; export `headHidden()` and `ATTENTION_ANCHORS_RELATIVE_PATH` | the delta cannot express layer 0, so "the representation is frozen" is a property of the file format |
| `src/main/focusplan/recorder.ts` | one command, `retractLastAwayDrift()`, under the existing `attempt()` guard | a **command**, like `PLAN_RESET` — not a tap. Focus Plan gains no seam into the desk stack; `runtime.ts` injects the callback, so `integration.test.ts`'s uncoupling assertion still holds. |
| `src/shared/plan/types.ts` | `PlanRound.retractedDriftsSec?: number[]` | optional, absent by default, no `v` bump — the same move `FocusPlanLedger.seed?` made. The `docs/FOCUS-PLAN.md § 1` fence is updated in the same commit; `check-contracts.mjs` fails the build otherwise. |
| `src/main/session/runtime.ts` | construct `DeskCorrections`, wire it to the controller, the monitor and the plan | one owner, one directory, in the place that already owns the store and the taps |

**Not touched, and asserted:** `src/shared/types.ts` (byte-locked),
`src/shared/policy/**` (no rule mentions a correction, and none had to),
`src/main/kill/**`, `src/main/plugs/**`, `src/main/session/adaptiveFuse.ts`,
`src/main/session/fuseAuthority.ts`, `src/main/session/push.ts`,
`scripts/desk-model/{train-attention,eval-attention,extract-features,first-person,attention-report}.ts`,
and `src/main/desk/model/weights/attention-head.json`.

---

## 12. Test plan

**Pure core** (`src/shared/correction/**`, no fs, no clock)

* `meaning.test.ts` — all four `kind × verdict` cases produce the right label,
  head, CSV cells and flags; the table is exhaustive over the product type.
* `cooldown.test.ts` — `silencedUntil` over records, and the derivation that
  makes it survive `NudgeTracker.reset()`.
* `scripts/desk-model/personal-refit.test.ts` — everything the plan split
  across `refit.test.ts`, `gate.test.ts`, `score.test.ts` and
  `purity.test.ts`, against the one module that does all four jobs:
  * *the fit* — a pure function (same inputs, byte-identical output layer,
    twice); λ decays with groups exactly as specified; group normalisation
    makes a 30-frame correction weigh the same as a 3-frame one; a fit with
    zero corrections returns `θ₀` unchanged; and a finite-difference check
    that the analytic gradient is the gradient of the objective this document
    writes down, with a positive control that the check can fail;
  * *the gates* — every gate id is reachable; the **first** failure is
    `blockedBy`; a head one image worse pooled is refused; a head 3.1 points
    worse on the proxy slice is refused while the pooled number improves; a
    head that ties everywhere is refused by `no-personal-gain`; the escape
    hatch skips the three comparisons and only those;
  * *the scoring* — balanced accuracy over classes *present* in a slice;
    per-correction majority vote; a tie inside a group resolves to the model's
    own top-probability frame and the rule is pinned;
  * *purity* — no `node:*` import, no `Date`, no network, with positive
    controls, mirroring `src/shared/plan/purity.test.ts`, and pointed at
    `src/shared/correction/refit.ts` rather than at the barrel that names it;
  * *the constants* — mirrored against the frozen fence in §2 of the appendix,
    and against the shipped head's own label order and bottleneck width;
  * *the class no correction can be about* — on the real head and the real
    286 anchors, a fit leaves the `unfocused` row byte-identical and does not
    spend the class. Without the mask that recall lands near 12% against the
    shipped head's 53%, `regressed-pooled` refuses, and **no student's
    corrections could install anything**. §6.3.
* The renderer's `model.test.ts` covers what the plan called `copy.test.ts`:
  every sentence carrying a ratio names corrections, the head-status variants
  render, and the failed-refit variant names the gate. It lives beside the
  view-model that composes those sentences.

**Main**

* `refit.test.ts` — the app's own shell, end to end against the real head and
  the real anchors: a refit that wins writes a head and the desk model then
  **wears** it; every refusal path writes the report and leaves no head
  behind; a head fitted against another base is left on disk and not worn; the
  shipped column really is the shipped head's numbers.
* `corrections.test.ts` — nothing is written without a verdict; the answer
  window drops the pending capture; a second pause supersedes the first; the
  cap writes a record with no frames; delete removes the directory; clear also
  removes the personal head.
* `cooldown.test.ts` — **the headline main-side test**: a correction, then a
  resume (which calls `NudgeTracker.reset()`), and the cooldown is still armed.
  Also: it survives a restart; deleting the correction drops it; a `right`
  verdict arms nothing; a silenced `away` still produces `AWAY`, still arms the
  countdown and still kills.
* `retract.test.ts` — the last still-open `walk_away` onset is removed and
  nothing else; a `tab_out` last onset refuses with `not-away`; a closed
  episode refuses with `not-open`; a single-onset round becomes censored and
  `firstDriftType` goes null with it; `classifyRound` re-runs and a short clean
  round becomes `discarded`; the resume does not resurrect the drift; every
  refusal is reachable.
* `anchors.test.ts` — the anchors reproduce `eval-attention.ts`'s numbers for
  the shipped head on both slices, to the image (the parity test of §7.1); the
  `nc/` exclusion is asserted; `ANCHOR_EVIDENCE` equals
  `attention-head.metrics.json`'s train + val.
* `personal-head.test.ts` — a valid delta swaps only the last layer; a
  `baseHeadHash` mismatch is ignored; a corrupt file is ignored; with
  `personalAttentionHeadEnabled: false` the shipped head runs.
* `no-retrain.test.ts` — **the uncoupling test**: recording a correction
  produces no write outside `desk-corrections/frames` and `corrections.json`,
  and in particular never opens `attention-head.json` for writing. Asserted by
  spying on the fs seam, not by reading the code.

**Renderer**

* `driftPause` + verdict-row model tests: chips appear only with a
  `correctionId`, only while `status === "paused"` and `pausedBy !== null`,
  disappear when the window lapses; *I was working* records **and** resumes in
  one tap; *Start the clock again* records nothing.

**Screens** — `npm run corrections:stills`: the paused screen with chips, the
Settings review list with thumbnails, the three head-status variants. The
review-list still is the artifact that proves the privacy claim is a screen and
not a sentence.

**`npm run gauntlet:corrections`** — the CI gate, in the shape of
`gauntlet:plan`'s stationary-population gate:

* **negative control** — corrections whose labels are shuffled (no signal): the
  refit must fail the gates in **at least
  `1 − CORRECTION_GAUNTLET_MAX_FALSE_INSTALL` = 95%** of runs, or the build
  fails. A loop that installs a head from noise is worse than no loop.
* **positive control** — corrections carrying a clean first-person signal: the
  refit must install in at least `CORRECTION_GAUNTLET_MIN_TRUE_INSTALL` = 80%
  of runs, so the gate is not passing by always refusing.

  What "first-person signal" has to mean here is the whole difficulty, and
  getting it wrong is what hid the λ bug for a build. A synthetic student built
  out of the anchors themselves IS the eval set: fitting on them necessarily
  drags the stock boundary about, `regressed-pooled` refuses, and the gate
  looks broken when the population was wrong. So the student is built in the
  bottleneck's own coordinates — sitting at the anchor centroid, because they
  are a person at a desk, with their two classes separating along the
  coordinate the 286 stock photographs vary **least** in. That is what "a cue
  from your room the shipped head never had a reason to learn" is, in sixteen
  dimensions.
* **the handful test** — with 1, 2 … 11 corrections the refit refuses every
  time, and with 12 identical-label corrections the fit moves the output layer
  by less than the trust region. (In `personal-refit.test.ts`, against the real
  head.)

Measured, on the shipped constants: **1.0%** false install, **95.5%** true
install, 200 synthetic students an arm, and a personal head that moves the
output layer a median **9.4%** of its own size against a 50% trust region.

---

## 13. Risks and cut lines

**Risks**

* *The gate is never passed and the feature is decorative.* Most likely
  outcome, and it is an acceptable one: the corrections are still collected,
  still visible, still exportable, and the shipped head still runs. The report
  tells the student and the developer exactly which gate is binding, which is
  the information needed to fix it.
* *λ was tuned on synthetic students.* §6.3 prints the whole sweep. It is
  bounded by the gates on both sides and printed in the artifact, and the
  population it was tuned against is simulated — a first-person cue placed on
  the bottleneck coordinate the stock anchors vary least in. That is the right
  SHAPE of evidence and it is not a real student.
* *A student games it.* Twelve taps of *I was working* teach "never say phone",
  which fails the anchors and never installs. The only thing they can reliably
  buy with taps is the cooldown — which is the point, and is theirs to have.
* *Disk.* Capped at 120 corrections ≈ 9 MB, shown in the UI, deletable in one
  action, and never auto-deleted.
* *The anchors go stale on an app update.* `baseHeadHash` turns that into a
  named gate failure rather than a wrong number. The release checklist gains
  one line: rebuild the anchors when the attention head changes, and the parity
  test fails if you did not.
* *Feature-version churn.* If `DESK_FEATURE_VERSION` bumps, cached activations
  are invalid; they are recomputed from the JPEGs, which is why the JPEG is the
  source of truth and the activation is only ever a cache.

**Cut lines, in the order they should be cut**

1. `corrections:export` — the loop works entirely on-device without it.
2. The paired bootstrap in the report (keep the point estimates and the gate).
3. Thumbnails (list the corrections as rows; *Reveal folder* still works).
4. The refit and the personal head **entirely** — ship §1–§5 alone. The
   behavioural half plus the stored, reviewable, deletable, exportable data is
   already the whole first-person dataset the attention head has been missing,
   and it is the half that helps the student today.

**Never cut**

* Nothing is written without a deliberate tap.
* The gate. A personal head that is worse must not run.
* The review list and the one-action delete.
* The retraction's disclosure. Editing a student's history quietly is worse
  than the false drift that made it necessary.

---

## 14. Four questions a reviewer will ask

**"Can one annoyed tap change the model?"** No. It writes three JPEGs and one
JSON record. The refit is a different channel, needs twelve independent
corrections, fits 51 numbers anchored to the shipped 51 inside a trust region,
and installs only if it does not regress the 286-image held-out eval and gains
at least one held-out correction. Four separate things have to be true.

**"What if the model gets worse?"** It does not run. A failed refit deletes any
personal head and leaves `refit-report.json` saying which gate stopped it and
by how much. There is no file for a bug to load by accident, and
`personalAttentionHeadEnabled: false` reverts a passing one at any time.

**"Where are my pictures?"** In `<userData>/desk-corrections/frames/`. Settings
lists them with thumbnails and a byte count, opens the folder for you, and
deletes them — and the head fitted from them — in one confirmed action. No code
in the app sends them anywhere.

**"The app stopped my clock and it was wrong. Does saying so actually change
anything?"** Immediately: yes — it resumes, and it will not pause you for that
again for 25 minutes (10 for `away`). To your history: yes — a false `away` is
removed from your minutes-until-first-drift, and the round is reclassified and
labelled as retracted. To the model: not yet, and it says so. It says how many
more corrections it needs, and when it has them it tells you what changed and
what did not.

---
---

# The correction loop — Frozen-Contracts Appendix (exact)

Everything below is a contract. The two "complete source" fences are
byte-checked by `scripts/check-contracts.mjs` once the files land; the tables
are not machine-guarded and must be re-checked by hand against
`src/shared/defaults.ts`, `src/main/store/appStore.ts` and `src/shared/ipc.ts`.

## 1. New shared types — `src/shared/correction/types.ts` (complete source)

```ts
import type { AttentionLabel, DeskModelId } from "../types";
import type { PauseKind } from "../nudge";

/* ────────────────────────────────────────────────────────────────────────
 * What the student said
 * ──────────────────────────────────────────────────────────────────────── */

/** `wrong` — the pause was a mistake. `right` — it was not. Nothing else. */
export type CorrectionVerdict = "wrong" | "right";

/** Which head a correction is evidence for. Only `attention` is ever refit. */
export type CorrectionHead = "attention" | "presence";

/**
 * The four labels the two buttons can produce. `unfocused` is deliberately
 * absent: it can never stop a clock, so it can never be corrected, and asking
 * a tired student to grade their own attention on a three-point scale at the
 * moment they are annoyed produces worse labels than not asking.
 */
export type CorrectionLabel = "focused" | "phone" | "at_desk" | "away";

/**
 * One row of the kind x verdict table — the whole meaning of a correction, in
 * one place, so main and the renderer cannot disagree about it.
 */
export interface CorrectionMeaning {
  label: CorrectionLabel;
  head: CorrectionHead;
  /** `attention` CSV cell. Empty for a presence correction, which makes no
   *  attention claim and which `train-attention.ts` then skips unchanged. */
  attention: AttentionLabel | "";
  /** `pack_label` CSV cell: honestly where the row came from. */
  packLabel: CorrectionLabel;
  /** `person` / `workspace` / `phone` / `gaze` are DERIVED from the verdict,
   *  never observed — the same rule self-labelled clips follow. */
  person: string;
  workspace: string;
  phoneCell: string;
  gaze: string;
  /** Enters the personal attention refit pool. False for presence rows. */
  trainsPersonalHead: boolean;
  /** Arms the per-kind cooldown. True exactly for `verdict: "wrong"`. */
  armsCooldown: boolean;
  /** Asks Focus Plan to retract the drift this reading produced. */
  retractsDrift: boolean;
}

export type CorrectionCase = `${PauseKind}:${CorrectionVerdict}`;

/* ────────────────────────────────────────────────────────────────────────
 * The pending capture — held in memory, never on disk until answered
 * ──────────────────────────────────────────────────────────────────────── */

/** What the renderer needs to draw the verdict row. No pixels cross the wire. */
export interface PendingCorrection {
  /** Also `NudgeEvent.correctionId`, so a verdict names one exact pause. */
  id: string;
  at: number;
  kind: PauseKind;
  /** What the model said: "away" (presence) or "phone" (attention). */
  modelLabel: string;
  modelConfidence: number;
  /** Frames held in memory for this pause. 0 means no chips are offered. */
  frames: number;
  /** Epoch ms after which the offer lapses and the bytes are freed. */
  expiresAt: number;
  /** True when the store is at CORRECTION_CAP_GROUPS: the verdict still
   *  resumes, silences and retracts; only the photos are not kept. */
  capped: boolean;
}

/* ────────────────────────────────────────────────────────────────────────
 * The stored record
 * ──────────────────────────────────────────────────────────────────────── */

export interface DeskCorrectionFrame {
  /** Relative to <userData>/desk-corrections/, e.g. "frames/dc-0007/frame-0002.jpg". */
  file: string;
  at: number;
  width: number;
  height: number;
  bytes: number;
  /** The model's own call on THIS frame, kept so the review screen and the
   *  CSV note can show what was being corrected. */
  predicted: string;
  confidence: number;
  /** The 16 activations of the frozen 1280->16 layer. Null until the
   *  extraction queue (idle-only) fills it, or the refit fills it itself. */
  hidden: number[] | null;
  /** Base head hash `hidden` was computed against; a mismatch invalidates it. */
  hiddenFor: string | null;
}

export interface DeskCorrectionRetraction {
  roundKey: string;
  /** Served-second offset of the onset removed, or null when refused. */
  retractedAtSec: number | null;
  refusal: PlanRetractionRefusal | null;
}

export interface DeskCorrection {
  v: 1;
  /** "dc-0007". Also the CSV `group`: one correction is one group. */
  id: string;
  at: number;
  /** Local "YYYY-MM-DD", stamped in MAIN so the pure core never touches Date. */
  day: string;
  kind: PauseKind;
  verdict: CorrectionVerdict;
  /** What the model said, and how sure it was, at the moment it paused. */
  modelLabel: string;
  modelConfidence: number;
  label: CorrectionLabel;
  head: CorrectionHead;
  /** Odd correction number train, even eval — exactly `clipSplit`. */
  split: "train" | "eval";
  deskModelId: DeskModelId;
  /** sha256(attention-head.json).slice(0, 16) at capture time. */
  baseHeadHash: string;
  featureVersion: number;
  frames: DeskCorrectionFrame[];
  /** Total bytes on disk for this correction, thumbnail included. */
  bytes: number;
  /** True when the cap was reached: `frames` is empty by design, not by loss. */
  capped: boolean;
  /** The Focus Plan round this pause interrupted, when there was one. */
  retraction: DeskCorrectionRetraction | null;
}

/** On-disk shape of <userData>/desk-corrections/corrections.json. */
export interface DeskCorrectionsFile {
  v: 1;
  lifetimeCorrections: number;
  /** Oldest first, capped at CORRECTION_CAP_GROUPS. */
  corrections: DeskCorrection[];
}

/* ────────────────────────────────────────────────────────────────────────
 * Focus Plan retraction — the command's answer
 * ──────────────────────────────────────────────────────────────────────── */

export type PlanRetractionRefusal =
  | "plan-off"
  | "pinned"
  | "no-round"
  | "no-onset"
  | "not-open"
  | "not-away"
  | "capped";

export interface PlanRetraction {
  retracted: boolean;
  roundKey: string | null;
  retractedAtSec: number | null;
  firstDriftSecBefore: number | null;
  firstDriftSecAfter: number | null;
  /** The first gate that refused, or null when it went through. */
  refusal: PlanRetractionRefusal | null;
}

/* ────────────────────────────────────────────────────────────────────────
 * The refit
 * ──────────────────────────────────────────────────────────────────────── */

/** The 51 numbers a refit produces. Layer 0 is not, and cannot be, in here. */
export interface OutputLayer {
  w: number[][];
  b: number[];
}

/** One eval anchor: 16 activations out of the frozen bottleneck, and a truth. */
export interface AttentionAnchorRow {
  path: string;
  /** Which held-out population. Never pooled in a printed number without
   *  saying so — they are different distributions with different truths. */
  slice: "adaption" | "proxy";
  truth: AttentionLabel;
  hidden: number[];
}

export interface AttentionAnchors {
  v: 1;
  baseHeadHash: string;
  hiddenDim: number;
  labels: readonly AttentionLabel[];
  rows: AttentionAnchorRow[];
}

export interface SliceScore {
  images: number;
  /** Independent groups behind those images. A number without this is not
   *  constructible, which is how "frames are not samples" is enforced. */
  groups: number;
  accuracy: number;
  /** Macro-recall over the classes PRESENT in this slice. */
  balanced: number;
  presentLabels: readonly AttentionLabel[];
  phone: { precision: number; recall: number; f1: number; support: number };
}

export interface RefitScores {
  /** All 286 anchors. The gate's pooled bar. */
  pooled: SliceScore;
  /** The 200 Adaption-annotated stock photos. */
  adaption: SliceScore;
  /** The 86 stock attention proxies (no `unfocused` images at all). */
  proxy: SliceScore;
  /** The student's own held-out corrections, one vote per correction.
   *  Null when there are none. */
  personalHoldout: SliceScore | null;
  /** Held-out corrections this head agrees with the student on. */
  personalHoldoutGroupsCorrect: number;
}

export type RefitGateId =
  | "not-custom-model"
  | "session-active"
  | "too-few-corrections"
  | "too-few-train-groups"
  | "too-few-eval-groups"
  | "stale-base"
  | "stale-anchors"
  | "drifted-too-far"
  | "regressed-pooled"
  | "regressed-slice"
  | "no-personal-gain";

export interface RefitGateResult {
  id: RefitGateId;
  passed: boolean;
  /** Rendered verbatim under "Why this?". Never empty. */
  detail: string;
}

export interface RefitInterval {
  point: number;
  lo: number;
  hi: number;
  draws: number;
}

export interface RefitReport {
  v: 1;
  at: number;
  baseHeadHash: string;
  anchorsHash: string;
  lambda: number;
  epochs: number;
  learningRate: number;
  driftRatio: number;
  corrections: {
    total: number;
    trainGroups: number;
    evalGroups: number;
    frames: number;
    byLabel: Record<string, number>;
    trainIds: string[];
    evalIds: string[];
  };
  shipped: RefitScores;
  personal: RefitScores;
  /** Every gate, in order. */
  gates: RefitGateResult[];
  /** The FIRST gate that failed, or null when all of them passed. */
  blockedBy: RefitGateId | null;
  /** Paired bootstrap of (personal - shipped) balanced accuracy on the pooled
   *  anchors, in points. REPORTED BESIDE THE GATE, never used as the gate. */
  pooledMarginCi95: RefitInterval | null;
  installed: boolean;
  /** False only on the dev-only `{ gate: "off" }` path, and then it is
   *  rendered in the UI until the next real refit. */
  gateEnforced: boolean;
}

/** <userData>/desk-corrections/personal-attention-head.json.
 *  Written ONLY when the gate passed; deleted when it does not. */
export interface PersonalAttentionHead {
  v: 1;
  baseHeadHash: string;
  labels: readonly AttentionLabel[];
  /** The refit output layer. The 1280->16 representation stays the shipped
   *  one, because this file cannot express it. */
  output: OutputLayer;
  fittedAt: number;
  report: RefitReport;
}

/* ────────────────────────────────────────────────────────────────────────
 * Wire shapes
 * ──────────────────────────────────────────────────────────────────────── */

export type ActiveAttentionHead = "shipped" | "personal";

/** One row of the review list. Carries a thumbnail, never a full frame. */
export interface CorrectionListItem {
  id: string;
  at: number;
  day: string;
  kind: PauseKind;
  verdict: CorrectionVerdict;
  modelLabel: string;
  modelConfidence: number;
  label: CorrectionLabel;
  head: CorrectionHead;
  frames: number;
  bytes: number;
  capped: boolean;
  /** 160px JPEG data URL, or null when this correction kept no photos. */
  thumbnail: string | null;
  /** Null exactly when this correction trains the personal head. */
  excludedBecause: string | null;
}

export interface CorrectionCooldown {
  kind: PauseKind;
  until: number;
  /** The correction that armed it, so deleting that row drops this. */
  correctionId: string;
}

/** CORRECTIONS_GET_STATE / CORRECTIONS_STATE payload. */
export interface DeskCorrectionsState {
  v: 1;
  /** False exactly when `deskCorrectionsEnabled` is off. */
  enabled: boolean;
  /** True only on `deskModelId: "custom"` — nothing here is reachable
   *  otherwise, because nothing else can pause. */
  available: boolean;
  /** The pause waiting for an answer, or null. */
  pending: PendingCorrection | null;
  items: CorrectionListItem[];
  lifetimeCorrections: number;
  bytes: number;
  capped: boolean;
  cooldowns: CorrectionCooldown[];
  /** Corrections in the attention pool, and how many more the refit needs. */
  refitReady: boolean;
  refitTrainGroups: number;
  refitEvalGroups: number;
  refitNeeded: number;
  activeHead: ActiveAttentionHead;
  lastRefit: RefitReport | null;
}

export interface RecordCorrectionRequest {
  correctionId: string;
  verdict: CorrectionVerdict;
}

export interface RecordCorrectionResult {
  recorded: boolean;
  correctionId: string;
  /** Non-null when a cooldown was armed. */
  cooldown: CorrectionCooldown | null;
  retraction: PlanRetraction | null;
  state: DeskCorrectionsState;
}
```

## 2. Constants — `src/shared/correction/constants.ts` (complete source)

```ts
import type { PauseKind } from "../nudge";

export const CORRECTION_MODEL_VERSION = "cl-1";

/* ── capture ────────────────────────────────────────────────────────── */
/** Ring slots in the desk monitor. 6 x 5 s covers PAUSE_SUSTAIN_PHONE_MS. */
export const CORRECTION_RING_FRAMES = 6;
/** Minimum gap between retained frames. 250 ms apart is one photograph. */
export const CORRECTION_RING_SPACING_MS = 5_000;
/** Kept per correction: first, middle, last of the confirmed run. */
export const CORRECTION_FRAMES_PER_CORRECTION = 3;
/** Native grab size, never resized: a resized frame is not the frame that
 *  caused the pause. 85 rather than capture-attention.ts's 88 because these
 *  accumulate unattended. */
export const CORRECTION_JPEG_QUALITY = 85;
export const CORRECTION_THUMB_MAX_SIDE = 160;
export const CORRECTION_THUMB_QUALITY = 70;
/** After this the held frames are freed: a verdict given ten minutes later is
 *  about a moment they no longer remember. */
export const CORRECTION_ANSWER_WINDOW_MS = 10 * 60_000;
/** At the cap the loop stops storing PHOTOS and says so. It never deletes a
 *  student's images to make room for more of their images. */
export const CORRECTION_CAP_GROUPS = 120;

/* ── the cooldown ───────────────────────────────────────────────────── */
/** One Classic focus block (PLAN_DEFAULT_FOCUS_MIN): the false-phone pose is
 *  one a student holds for the whole round, so a short silence re-fires. */
export const CORRECTION_COOLDOWN_PHONE_MS = 25 * 60_000;
/** Shorter, because the presence head is right on 92.5% of its `away` calls
 *  and its false positives are transient rather than a pose. */
export const CORRECTION_COOLDOWN_AWAY_MS = 10 * 60_000;

export const CORRECTION_COOLDOWN_MS: Readonly<Record<PauseKind, number>> = {
  away: CORRECTION_COOLDOWN_AWAY_MS,
  phone: CORRECTION_COOLDOWN_PHONE_MS,
};

/* ── refit floors (mirroring this repo's own bars, not new ones) ────── */
/** = CONFIDENCE_DRIFTS in src/shared/adapt/model.ts. */
export const CORRECTION_REFIT_MIN_GROUPS = 12;
export const CORRECTION_REFIT_MIN_TRAIN_GROUPS = 6;
/** = FIRST_PERSON_MIN_EVAL_GROUPS in scripts/desk-model/first-person.ts. */
export const CORRECTION_REFIT_MIN_EVAL_GROUPS = 3;

/* ── the fit ────────────────────────────────────────────────────────── */
/** L2 pull toward the SHIPPED output layer. TUNED against the two controls in
 *  `gauntlet.ts` and nothing else: at 1.5 the gate installs 95.5% of heads
 *  fitted on real signal and 1.0% of heads fitted on shuffled labels, and a
 *  personal head moves the layer ~8% of its own size. Printed into
 *  refit-report.json, so a bad value is visible in the artifact. */
export const CORRECTION_ANCHOR_L2 = 1.5;
/** Labelled train rows the shipped head was fitted on: attention-head.
 *  metrics.json dataset.train 584 + dataset.val 109. A test asserts it. */
export const CORRECTION_ANCHOR_EVIDENCE = 693;
/** Full-batch over 51 parameters: no minibatch, no shuffle, no PRNG, no seed,
 *  and no early stopping — with six training groups there is nothing to
 *  early-stop on that is not noise. */
export const CORRECTION_REFIT_EPOCHS = 300;
export const CORRECTION_REFIT_LR = 0.05;
/** Same rule and same cap as train-attention.ts. */
export const CORRECTION_CLASS_WEIGHT_CAP = 4;
/** Trust region: ||theta - theta0|| <= this x ||theta0||. */
export const CORRECTION_MAX_DRIFT_RATIO = 0.5;

/* ── the gate ───────────────────────────────────────────────────────── */
/** Pooled 286-image anchors: "must not be beaten", exactly the forecast's bar. */
export const CORRECTION_POOLED_MARGIN_PTS = 0;
/** Per-slice tolerance. One image is 1.16 points on the 86-image proxy slice,
 *  so a zero-tolerance slice gate would be a coin-flip veto. */
export const CORRECTION_MAX_SLICE_DROP_PTS = 3;
/** Held-out CORRECTIONS it must newly agree with the student on. Stated in
 *  corrections, not frames and not points. */
export const CORRECTION_MIN_GAIN_GROUPS = 1;
/** Paired bootstrap draws for the interval printed BESIDE the gate. */
export const CORRECTION_BOOTSTRAP_DRAWS = 2000;

/* ── gauntlet ───────────────────────────────────────────────────────── */
export const CORRECTION_GAUNTLET_SEED = 20260913;
/** CI gate: on label-shuffled corrections carrying no signal, the refit must
 *  install in fewer than this fraction of runs, or the build fails. */
export const CORRECTION_GAUNTLET_MAX_FALSE_INSTALL = 0.05;
/** Positive control: on clean synthetic signal it must install in at least
 *  this fraction, so the gate cannot pass by always refusing. */
export const CORRECTION_GAUNTLET_MIN_TRUE_INSTALL = 0.8;
```

## 3. The `kind × verdict` table — `src/shared/correction/meaning.ts`

```ts
export const CORRECTION_MEANING: Readonly<Record<CorrectionCase, CorrectionMeaning>> = {
  "phone:wrong": {
    label: "focused", head: "attention",
    attention: "focused", packLabel: "focused",
    person: "face_or_body", workspace: "True", phoneCell: "none", gaze: "work",
    trainsPersonalHead: true, armsCooldown: true, retractsDrift: false,
  },
  "phone:right": {
    label: "phone", head: "attention",
    attention: "phone", packLabel: "phone",
    person: "face_or_body", workspace: "True", phoneCell: "in_use", gaze: "phone",
    trainsPersonalHead: true, armsCooldown: false, retractsDrift: false,
  },
  "away:wrong": {
    label: "at_desk", head: "presence",
    attention: "", packLabel: "at_desk",
    person: "face_or_body", workspace: "True", phoneCell: "none", gaze: "work",
    trainsPersonalHead: false, armsCooldown: true, retractsDrift: true,
  },
  "away:right": {
    label: "away", head: "presence",
    attention: "", packLabel: "away",
    person: "none", workspace: "True", phoneCell: "none", gaze: "elsewhere",
    trainsPersonalHead: false, armsCooldown: false, retractsDrift: false,
  },
};
```

## 4. IPC additions — `src/shared/ipc.ts` (exact strings)

Invoke:

```ts
CORRECTIONS_GET_STATE: "focusplug:corrections:getState",
CORRECTIONS_RECORD:    "focusplug:corrections:record",
CORRECTIONS_DELETE:    "focusplug:corrections:delete",
CORRECTIONS_CLEAR:     "focusplug:corrections:clear",
CORRECTIONS_REVEAL:    "focusplug:corrections:reveal",
CORRECTIONS_REFIT:     "focusplug:corrections:refit",
```

Push:

```ts
CORRECTIONS_STATE:     "focusplug:corrections:state",
```

`IpcInvokeChannelMap` / `IpcPushChannelMap`:

```ts
"focusplug:corrections:getState": { args: []; result: DeskCorrectionsState };
"focusplug:corrections:record":   { args: [request: RecordCorrectionRequest]; result: RecordCorrectionResult };
"focusplug:corrections:delete":   { args: [id: string]; result: DeskCorrectionsState };
"focusplug:corrections:clear":    { args: []; result: DeskCorrectionsState };
"focusplug:corrections:reveal":   { args: []; result: void };
"focusplug:corrections:refit":    { args: [options?: { gate?: "off" }]; result: RefitReport };
"focusplug:corrections:state":    DeskCorrectionsState;   // push
```

`FocusPlugApi` gains `correctionsGetState()`, `correctionsRecord(request)`,
`correctionsDelete(id)`, `correctionsClear()`, `correctionsReveal()`,
`correctionsRefit(options?)` and `onCorrectionsState(cb)`.

One optional field on the existing nudge wire, in `src/shared/nudge.ts`:

```ts
export interface NudgeEvent {
  ts: number;
  kind: NudgeKind;
  app?: string;
  pause?: boolean;
  /**
   * Frames from this pause are being held for a verdict. Present ONLY on a
   * pause-carrying nudge, only on `deskModelId: "custom"`, only with
   * `deskCorrectionsEnabled`, and only when the ring actually had frames.
   * Absent means the paused screen offers no verdict row.
   */
  correctionId?: string;
}
```

There is no `correctionsGetFrame` channel: full frames reach the renderer as
`file://` URLs into the user data directory only when the student clicks a
thumbnail, and thumbnails ride the state payload.

## 5. Settings keys — `AppSettings` in `src/shared/ipc.ts` (flat, house style)

| key | type | default | `normalizeSettings` clamp |
| --- | --- | --- | --- |
| `deskCorrectionsEnabled` | boolean | `true` | boolean else default |
| `personalAttentionHeadEnabled` | boolean | `true` | boolean else default |

`deskCorrectionsEnabled: false` reproduces today's behaviour exactly: the ring
retains nothing, no `correctionId` is ever issued, the paused screen shows no
verdict row, and nothing is written. It does **not** delete anything already
stored — an off switch is not an erase button, and the erase button is in the
review card.

`personalAttentionHeadEnabled: false` forces the shipped head even when a
personal one passed the gate. It is a **preference, not a capability**: it can
only ever turn a head off, never let one in. Both defaults are `true` because
neither can do anything at all without a deliberate tap.

No cooldown, λ, epoch or threshold sliders. Those are not student decisions,
and a slider on how much the app is allowed to disbelieve you would be the
worst setting in this product.

## 6. On-disk schema

```
<userData>/desk-corrections/
  corrections.json                 DeskCorrectionsFile           (writeJsonAtomic)
  frames/<dc-NNNN>/frame-0001.jpg  native size, quality 85
  frames/<dc-NNNN>/thumb.jpg       160 px, quality 70
  personal-attention-head.json     PersonalAttentionHead — ONLY when the gate passed
  refit-report.json                RefitReport — every refit, passed or failed
```

Shipped, committed, read-only at runtime:

```
src/main/desk/model/weights/attention-anchors.json    AttentionAnchors, ~60 KB
```

`src/main/store/appStore.ts` exports, beside the four it already names:

```ts
export const DESK_CORRECTIONS_DIR = "desk-corrections";
export function correctionsPath(directory: string): string;
```

Revive is defensive in the house style: wrong `v`, non-array `corrections`, a
record with a missing id, NaN offsets, a frame file that is not on disk ⇒ that
record (or that frame) is dropped, or the file starts empty. **No throw ever
reaches a session start, a pause, or a verdict tap.** A failed write costs the
correction and never the session, and appends one
`correction · off · <message>` line, exactly as the plan recorder's latch does.

`src/shared/plan/types.ts` gains one optional field on `PlanRound` (and the
`docs/FOCUS-PLAN.md § 1` fence is updated in the same commit, or
`check-contracts.mjs` fails the build):

```ts
  /** Drift onsets removed by a student's correction, in served seconds.
   *  Absent on every round nothing was retracted from. The round's history is
   *  edited, never silently: the evidence row says so and so does the log. */
  retractedDriftsSec?: number[];
```

## 7. npm scripts — `package.json` (as built)

```json
"test:corrections":     "vitest run src/shared/correction src/main/desk/corrections src/renderer/src/features/corrections",
"test:refit":           "vitest run scripts/desk-model/personal-refit.test.ts scripts/desk-model/refit-io.test.ts scripts/desk-model/export-corrections.test.ts",
"gauntlet:corrections": "tsx --tsconfig tsconfig.node.json src/shared/correction/gauntlet.ts",
"anchors:attention":    "tsx --tsconfig tsconfig.node.json scripts/desk-model/build-attention-anchors.ts",
"refit:attention":      "tsx --tsconfig tsconfig.node.json scripts/desk-model/refit-attention.ts",
"corrections:export":   "tsx --tsconfig tsconfig.node.json scripts/desk-model/export-corrections.ts"
```

`refit:attention` is the developer-side shell around the same fit and the same
gates the button runs — a failing gate is a diagnosis, and somebody has to be
able to read it without a UI.

The stills for the review card live at
`src/renderer/src/features/corrections/stills.mjs`, beside the components they
photograph, rather than at `scripts/corrections-stills.mjs`.

`vitest.config.ts` needs **no change**: `src/shared/**/*.test.ts`,
`src/main/desk/**/*.test.ts`, `src/renderer/src/**/*.test.ts` and
`scripts/desk-model/**/*.test.ts` already match every new test file.

`scripts/check-contracts.mjs` gains two `FROZEN` entries, and they are wired
(`npm run check:contracts` names both files):

```js
{ doc: "docs/CORRECTION-LOOP.md",
  heading: "## 1. New shared types — `src/shared/correction/types.ts` (complete source)",
  source: "src/shared/correction/types.ts" },
{ doc: "docs/CORRECTION-LOOP.md",
  heading: "## 2. Constants — `src/shared/correction/constants.ts` (complete source)",
  source: "src/shared/correction/constants.ts" },
```

## 8. New-file list, as built

Where the shipped tree differs from the plan the difference is noted; nothing
here is aspirational.

### NEW — shared (pure core, browser-importable via the `@shared` alias)

```
src/shared/correction/types.ts       frozen above, byte-checked by CI
src/shared/correction/constants.ts   frozen above, byte-checked by CI
src/shared/correction/meaning.ts     the kind x verdict table          + meaning.test.ts
src/shared/correction/cooldown.ts    silencedUntil(), derived from
                                     the records                       + cooldown.test.ts
src/shared/correction/refit.ts       ONE module: the pure fit, the
                                     scoring, the paired bootstrap and
                                     the ordered gates. The planned
                                     score.ts / gate.ts split was not
                                     built — they share the pool, the
                                     weights and the label order, and
                                     three files would have been three
                                     copies of those.
src/shared/correction/gauntlet.ts    npm run gauntlet:corrections — the
                                     two controls of §12
```

`src/shared/correction/refit.ts` is tested from
`scripts/desk-model/personal-refit.test.ts`, which is also where the purity
fence and the frozen-constant mirroring live;
`scripts/desk-model/personal-refit.ts` is a one-line re-export of it, so the
app's button and the developer's CLI cannot diverge. The planned `copy.ts` and
`fixtures.ts` did not survive contact: the user-visible strings live in
`src/renderer/src/features/corrections/model.ts` with the view-model that
composes them (and are tested there), and the fixtures live in each test file
that needs them.

### NEW — main

```
src/main/desk/frameRing.ts               the bounded, conditional ring   + frameRing.test.ts
src/main/desk/corrections/store.ts       records, frames, thumbnails,
                                         revive, delete, clear           + store.test.ts
src/main/desk/corrections/capture.ts     pending capture, encode, the
                                         answer window                   + capture.test.ts
src/main/desk/corrections/jpeg.ts        RGB -> JPEG, and the thumbnail
src/main/desk/corrections/paths.ts       every filename this feature owns
src/main/desk/corrections/service.ts     DeskCorrections: the one owner  + corrections.test.ts
src/main/desk/corrections/refit.ts       IO shell around the pure fit +
                                         gate; loads the anchors, fills
                                         activations from the photos,
                                         writes the head/report          + refit.test.ts
src/main/desk/corrections/index.ts       createDeskCorrections()
src/main/desk/corrections/harness.ts     its own doubles, deliberately NOT added
                                         to src/main/session/harness.ts
src/main/desk/corrections/no-retrain.test.ts   THE UNCOUPLING TEST
src/main/desk/corrections/cooldown.test.ts     survives the resume
src/main/focusplan/retract.ts            retractLastAwayDrift()          + retract.test.ts
```

The planned `anchors.ts` is `loadAnchors()` inside `refit.ts` — its only
caller — and the planned `features.ts` idle queue was not built: the refit
fills any missing activations itself, from the photographs, which is why gate 2
refuses to run one while a session is going. The JPEG stays the source of truth
and the activation is only ever a cache, so nothing is lost by computing it
late.

### NEW — renderer

```
src/renderer/src/features/corrections/VerdictRow.tsx        the two chips on LockPage
src/renderer/src/features/corrections/CorrectionsCard.tsx   review + delete + refit
src/renderer/src/features/corrections/HeadStatus.tsx        which head is active
src/renderer/src/features/corrections/model.ts   pure view-model         + model.test.ts
src/renderer/src/features/corrections/scenes.ts  mockApi / stills scenes + scenes.test.ts
src/renderer/src/features/corrections/useCorrections.ts     fetch + subscribe
src/renderer/src/features/corrections/corrections.css
src/renderer/src/features/corrections/index.ts
src/renderer/src/features/corrections/evidence/             the stills
```

### NEW — scripts and docs

```
scripts/desk-model/build-attention-anchors.ts     npm run anchors:attention
scripts/desk-model/refit-attention.ts             npm run refit:attention
scripts/desk-model/refit-io.ts                    the CLI's IO shell      + refit-io.test.ts
scripts/desk-model/personal-refit.ts              re-export of the shared fit
scripts/desk-model/personal-refit.test.ts         the fit, the gates, the purity fence
scripts/desk-model/export-corrections.ts          npm run corrections:export
src/renderer/src/features/corrections/stills.mjs  the review card's stills
src/main/desk/model/weights/attention-anchors.json      committed, ~56 KB
src/main/desk/model/weights/attention-anchors.metrics.json
docs/CORRECTION-LOOP.md                           this file
```

### MODIFIED (exhaustive)

`src/shared/nudge.ts` (`NudgeEvent.correctionId?`) ·
`src/shared/ipc.ts` (6 invokes, 1 push, 7 map entries, 7 api methods, 2 settings keys, re-exports) ·
`src/shared/defaults.ts` (2 defaults) ·
`src/shared/plan/types.ts` (`PlanRound.retractedDriftsSec?`) ·
`src/shared/plan/index.ts` (re-export `retract` helpers) ·
`src/main/store/appStore.ts` (2 `normalizeSettings` clamps, `DESK_CORRECTIONS_DIR`, `correctionsPath`) ·
`src/main/session/nudge.ts` (`DriftPolicy.silenced`, one early return in `readDrift`) ·
`src/main/session/controller.ts` (`driftPolicy()` ANDs the cooldown; the ring snapshot on a pause; `correctionId` through `nudge()`; `requirePatch` +2 booleans; and one line in `syncCorrectionCapture()` that asks the service to re-resolve which attention head should run, so `personalAttentionHeadEnabled` and `deskModelId` land without a second observer on the controller — **and nothing else**) ·
`src/main/desk/monitor.ts` (optional ring, `peekFrames`, `setCorrectionCapture`) ·
`src/main/desk/model/factory.ts` + `your-model.ts` (`applyPersonalAttentionHead`, `wearPersonalAttentionHead`, `attentionHeadHash`, `ATTENTION_ANCHORS_RELATIVE_PATH`, `clearSharedDeskModel`) ·
`src/main/desk/types.ts` (`DeskDebug.attentionHead?`, so a reading says which head produced it) ·
`src/main/focusplan/recorder.ts` (`retractLastAwayDrift`, `CarriedRound.lastDecision`) ·
`src/main/focusplan/index.ts` (expose the command) ·
`src/main/index.ts` (6 handlers, 1 broadcast, `shell.openPath` for reveal, and the three callbacks that keep the layers uncoupled: the Focus Plan retraction, the refit, and `applyPersonalAttentionHead`) ·
`src/preload/index.ts` (7 methods) ·
`src/renderer/src/lib/mockApi.ts` (corrections state + scenes) ·
`src/renderer/src/pages/LockPage.tsx` (the verdict row) ·
`src/renderer/src/pages/SettingsPage.tsx` (the corrections card, under Desk model) ·
`src/renderer/src/features/logs/filters.ts` + `eventModel.ts` (the `correction` kind) ·
`scripts/check-contracts.mjs` (2 fences) ·
`package.json` (6 scripts) ·
`docs/CONTRACTS.md` (append-only `## Correction loop (Phase 6)` **below** the frozen Types fence) ·
`docs/CUSTOM-MODEL.md` (a `### Corrections from the student` subsection under the attention head, and the anchors' provenance) ·
`docs/FOCUS-PLAN.md` (§1 fence + one paragraph in §3.3 on retracted drifts) ·
`README.md`

### UNTOUCHED (asserted by tests / CI)

`src/shared/types.ts` (byte-locked) ·
`src/shared/policy/**` ·
`src/shared/forecast/**` ·
`src/shared/adapt/**` ·
`src/main/session/push.ts` ·
`src/main/session/adaptiveFuse.ts` ·
`src/main/session/fuseAuthority.ts` ·
`src/main/kill/**` ·
`src/main/plugs/**` ·
`src/main/forecast/**` ·
`src/main/desk/model/weights/attention-head.json` and `desk-head.json` (never written by the app) ·
`scripts/desk-model/train-attention.ts`, `eval-attention.ts`, `extract-features.ts`, `first-person.ts`, `attention-report.ts`, `lib.ts` ·
`src/shared/policy/**`, and every number in `docs/FORECAST.md` ·
`datasets/desk-attention-labels.csv`'s ten columns.
