# FocusPlug — voiceover, read top to bottom

Read this straight through in **one take**. Don't perform it. Talk at the speed
you'd explain it to someone at the next desk — roughly 160 words a minute. The
takes that sounded robotic in the intro were slow and evenly spaced; the ones
that sounded real were quick and uneven.

`[Square brackets]` are directions, not words. Everything else is spoken.

Total spoken: ~640 words ≈ 4:00 of speech inside a 5:00 cut. The gaps are
deliberate — silence while the fuse counts down is the most persuasive part of
the whole thing.

Record it **last**, after the picture is shot, so you know what you're talking
over. Slate it: say "voiceover, take one" before you start.

---

### [0:00 – 0:15] Intro plays. Say nothing.

---

### [0:15] Over the session panel

A pomodoro counts minutes and then dings. It doesn't close the distraction, and
it has no idea whether you left the chair.

FocusPlug watches the window you're in *and* whether you're actually at your
desk. When you drift, it takes the distraction away.

Pick how you want to watch it run out. Mine's a flight — fifty minutes is Dubai
to Doha, landing when I'm free.

### [0:40] Over the blocklist and settings

Allowlist the assignment. Blocklist Discord and the games.

The desk model runs on this machine. Camera frames never leave the PC. Strict
mode means both sensors have to agree before anything dies.

### [1:00] You hold the switch, lock mode takes the screen

Hold it. That's the commitment.

Wheels up. Off the clock this only watches — but a live round can kill.

### [1:12] You tab to Discord, the overlay arms

I've tabbed to Discord. That's a distraction, and the fuse is armed. Ten
seconds.

If I go back to the assignment right now, this cancels and nothing happens.

I'm not going back.

> **[Stop talking. Let the countdown run out and Discord die in silence. ~8s.]**

### [1:45] You return to the assignment

Back on the assignment, still at the desk — and it unlocks itself.

Strict mode needs both: the right window, and a person in the chair.

### [1:58] You leave the desk or cover the lens

Here's the part a timer can't do.

I'm leaving the desk. No tab switch, no keystroke — the window is still the
assignment. But the camera says nobody's there, so the blocked apps die anyway.

And when it isn't sure, it never kills on the camera alone.

### [2:22] You open the Log

The log is the receipt. Sensor, decision, fuse, kill — in order, with the same
labels you just saw on the overlay.

### [2:35] Demo Kill, then the lamp going dark

And it doesn't stop at software. Demo Kill force-quits the blocked apps *and*
cuts the plug.

That's a TP-Link P110M on the local network. No vendor cloud, no account.

The one thing it will never touch is the machine you're working on. That isn't
a setting you can get wrong — it's frozen in the contract.

### [3:05] The model — the minute that matters

The camera call is a model we trained, not an API.

It stacks three things. A face detector, run on the full frame plus three crops,
so off-centre faces still fire. A MobileNet scene vector. And about twenty
hand-built descriptors — brightness grids, gradient histograms, blur, skin tone.
Two thousand dimensions into a small network that says at-desk, away, or
uncertain.

Held out, it's ninety-five percent three-way. The face detector we started with
was forty-seven. It can see a face — it can't tell you whether you're working.

All of it runs here. Local models, plain arithmetic, no network calls at all.

And the fuse is learned too. It watches whether you actually come back after a
drift, and how fast, and it spends longer fuses on the drifts you recover from.
On our simulation that's seventy-seven percent recovery at eight and a half
seconds — against sixty-nine at nine and a half for a fixed countdown.

### [4:05] The terminal, as each command finishes

That's the desk gauntlet. That's the fuse against the best possible fixed
countdown. And that's the full suite.

Now, honest about those numbers.

One slice of that eval shares a camera with its own training data, so the figure
to trust is the diverse one — eighty-nine. And the fuse was fitted on simulated
drifts, not real students. A cold install ships your plain setting until it has
your data.

### [4:35] Close

Two sensors. One decision. And a consequence you can hear.

Every other focus timer asks you to keep it.

This one keeps it for you.

---

## If you have to cut to 3:00

Drop, in this order:

1. The model minute (3:05) down to two sentences: *"The camera call is a model
   we trained, not an API — ninety-five percent held out, all on-device."*
2. The plug beat (2:35) to one line over the lamp shot.
3. The proof beat (4:05) to the caveat sentence only.

Keep the kill, the desk-away beat, and the close. Those three are the demo.

## What not to say

Streak. Gentle reminder. Nudge. Productivity coach. Tutor. AI-powered.

Never pitch the countdown without landing the kill in the same breath — a timer
that counts is every other timer.
