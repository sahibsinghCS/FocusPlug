# HyperFrames edit prompts (for Grok / Cursor)

Paste-ready prompts for assembling the 5-minute demo. They are long on purpose:
a cheaper model will not read the HyperFrames skill files, so every rule it
needs is inlined here. That is the whole trick — the quality comes from the
prompt carrying the constraints, not from the model knowing them.

**How to use:** paste **BLOCK A** first, then one numbered prompt, in the same
conversation. One prompt per turn. Do not merge them — a weak model that is
asked to scaffold, time, title and mix at once will do all four badly.

If a prompt's output fails `npx hyperframes check`, use **PROMPT 5** rather than
describing the error in your own words.

---

## BLOCK A — paste this first, every session

````
You are editing video in HyperFrames. HyperFrames renders video FROM HTML: a
composition is an HTML file whose DOM declares timing with data-* attributes and
whose animation runs on a single seekable GSAP timeline. There is no "playback" —
the renderer seeks to a time and screenshots. Every rule below follows from that.

WORKING DIRECTORY: C:\Users\SS\FocusPlug\demo-full
COMMANDS:
  npx hyperframes lint      fast static check while iterating
  npx hyperframes check     the real gate (lint + runtime + layout + motion + contrast)
  npx hyperframes snapshot --at 3,20,75   still frames to eyeball
  npm run render            writes renders/*.mp4
Run `npx hyperframes check` after every change and fix everything before moving on.

=== THE COMPOSITION CONTRACT — violating any of these silently breaks the render ===

1. ROOT must be a sized box with an explicit duration:
   <div id="root" data-composition-id="main" data-width="1920" data-height="1080"
        data-duration="300" data-fps="30">
   Root data-duration is read ONCE at compile time and governs render length.
   The root must have real pixel width/height in CSS too, or children collapse.

2. EXACTLY ONE paused GSAP timeline, registered AFTER it is fully built:
   const tl = gsap.timeline({ paused: true });
   ... add all tweens ...
   window.__timelines["main"] = tl;        // LAST LINE, key = data-composition-id
   Registering an empty timeline early renders a blank video. Never call tl.play().
   Building inside an async function (await document.fonts.ready) is fine — just
   assign window.__timelines at the very end of it.

3. TIMED ELEMENTS need class="clip" plus data-start and data-duration (seconds):
   <section class="clip" data-start="15" data-duration="120"> ... </section>

4. DETERMINISM — the renderer samples frames out of order and in parallel:
   - NO Math.random(), NO Date.now(), NO performance.now()
   - NO network fetches, NO hover/scroll/input state
   - NO repeat: -1. Finite only: repeat: Math.max(0, Math.floor(dur/cycle) - 1)
     (use Math.floor, never Math.ceil)
   - No setTimeout / requestAnimationFrame driving visuals. Everything is a tween.

5. VIDEO AND AUDIO — the rules that cause silent failures:
   - <video> must be muted and playsinline. Audio comes from a SEPARATE <audio>.
   - EVERY <audio> MUST have an id="". An id-less <audio> is never mixed and the
     render is SILENT with no error.
   - NEVER put crossorigin on <video> or <audio>. It is rejected outright.
   - NEVER nest a <video data-start> inside another element that also has
     data-start. Put the timing on the wrapper OR the video, never both.
   - Trim a source with data-media-start (where playback begins INSIDE the file):
     <video class="clip" src="clips/b.mp4" data-start="30" data-duration="12"
            data-media-start="45" muted playsinline></video>
     = show 12s of b.mp4, starting 45s into that file, at t=30 in the timeline.
   - Do NOT animate the width/height of a timed media element. Animate a wrapper.

6. ANIMATION RULES:
   - Never tween `display` or raw `visibility` on a .clip element. Use GSAP
     autoAlpha, or a zero-duration tl.set() at an exact beat boundary.
   - Never set an initial CSS transform AND tween the same property in GSAP.
     Use gsap.fromTo(el, {x:-40}, {x:0}) instead of CSS transform + tl.to().
   - Use transforms and opacity. Do not tween top/left/width/height for layout.
   - No <br> inside body text. Let text wrap with max-width.

7. AUDIO LEVELS — measured on this machine, do not skip:
   The render mixer applies a fixed ~+3.2 dB to the finished mix. A source
   peaking at 0.84 comes back at 1.18 and clips. Set every audio element's
   data-volume so the sum stays low: use 0.74 as the master for your main
   track and scale effects proportionally. After rendering, verify the output
   peak is below 0.95 and that there are zero samples at/above 0.999.

8. CUT ON WORD ONSETS, NOT ON A GRID. Every picture cut should land on the start
   of a word in the voiceover. This is what makes an edit feel locked instead of
   merely fast. Word timings are provided to you as data — use them literally.
````

---

## PROMPT 1 — scaffold and lay the picture edit

````
Create the project and assemble a first picture cut. Do not add titles or
effects yet; this pass is only about the right frames being on screen at the
right times.

Scaffold:
  npx hyperframes init "demo-full" --non-interactive --example=blank

Copy these source files into demo-full/clips/ :
  A  focusplug-intro-hook.mp4   0:15   finished intro, DO NOT re-cut or re-time it
  B  02-enforcement.mp4         ~2:00  screen capture, one continuous take
  C  03-plug.mp4                ~0:20  screen capture, Demo Kill cutting the plug
  D  03b-plug-irl.mp4           ~0:15  camera close-up, the lamp going dark
  E  04-proof.mp4               ~0:45  screen capture, terminal running tests
and the narration into demo-full/audio/voiceover.wav

Build index.html with root data-duration="300" (5:00), 1920x1080, 30fps.

Lay these clips on the timeline in order. Use data-media-start to pick the right
region out of each source file; do not assume a clip starts at its own 0.

  t=0.0    A  intro, full, 15s. Its audio is already mixed into the file, so
             place it as <video> PLUS a matching <audio> pointing at the SAME
             file with the same data-start/data-duration (remember: video muted,
             audio separate, audio needs an id).
  t=15.0   B  the enforcement run, ~140s. This is one continuous take — keep it
             continuous. Trim only its head and tail with data-media-start.
  t=155.0  C  the plug beat on screen, ~18s
  t=173.0  D  the physical lamp, ~12s
  t=185.0  E  the terminal proof, ~45s
  t=230.0     hold the last frame / a closing card to 300.0

Those numbers are a starting layout, not the final edit — PROMPT 2 retimes them.

The voiceover is ONE <audio id="vo"> at data-start="0" covering the whole piece,
data-volume="0.74".

Rules that will bite you here, from BLOCK A: every <audio> needs an id; video is
muted with audio separate; never nest a timed <video> inside a timed wrapper;
one paused timeline registered last.

Then run `npx hyperframes check` and fix every error. Report the output.
````

---

## PROMPT 2 — lock the cuts to the narration

Run this first and paste its output into the prompt:

```powershell
python C:\Users\SS\FocusPlug\demo-intro\scripts\analyze_supplied.py C:\path\to\voiceover.wav
```

It prints every sentence with its start/end and a word-by-word timing list, and
writes a JSON next to itself.

````
Here are the word onsets from the voiceover, measured:

<PASTE THE SCRIPT OUTPUT HERE>

Retime the picture edit so that EVERY clip boundary lands exactly on a word
onset from that list. Rules:

- Pick the onset of a STRESSED or meaningful word, not a filler word ("a",
  "the", "of"). Cut on the noun or the verb.
- When the narration names something that is visible in a clip, the cut must
  put that clip on screen ON that word, and hold it while the phrase finishes.
  Example from the intro we already made: the card reading "severe negative
  impact on learning" is on screen for exactly the seconds the narrator says
  "a severe impact on learning". Do that everywhere you can.
- Never cut in the middle of a spoken word.
- Do not cut faster than ~0.8s per clip while narration is running. Fast cutting
  belongs only where there is no speech.
- The intro (clip A) is finished and must not be retimed. Everything after it
  moves.

Update data-start / data-duration / data-media-start only. Do not change the
clips, add effects, or alter index.html's structure.

Print a table of the final schedule: clip, start, duration, and the exact word
its cut lands on. Then run `npx hyperframes check`.
````

---

## PROMPT 3 — titles and lower-thirds

````
Add on-screen text. Keep it minimal — this is a working demo, not a trailer.

Add exactly these, each as a timed .clip div over the video:
  1. A lower-third when the enforcement run starts: "Window sensor + Desk AI"
     with a smaller second line "on-device, no network". 4s, then out.
  2. A lower-third on the plug beat: "TP-Link P110M - local LAN, no cloud". 4s.
  3. A full-width caption over the terminal beat naming each command as it runs,
     one at a time, matched to when that command's output appears on screen.
  4. A closing card on the last 5 seconds: "FocusPlug" and one line beneath.

Design constraints:
- Video type, not web type: body text 28px minimum, headings 60px+. Anything
  under 24px is unreadable on a projector.
- Put text in the lower third or a corner, never centered over the action.
- Give text a solid or heavily-tinted backing so it stays legible over changing
  video. Do not rely on a drop shadow alone.
- Animate in and out with GSAP autoAlpha and a small y translate. 0.3-0.5s.
  Never tween display or visibility on a clip element.
- Use gsap.fromTo with explicit from-states so the frame is correct when the
  renderer seeks to any time.

Run `npx hyperframes check` — it audits WCAG contrast and will fail if the text
is not readable over its background. Fix any contrast errors it reports; it
suggests a compliant colour for each.
````

---

## PROMPT 4 — audio mix, verify, render

````
Finish the mix and render.

1. The voiceover is the spine and must stay intelligible everywhere.
2. Clip A (the intro) has its own finished mix — do not process it.
3. Clips B, C, E have system audio worth keeping quietly underneath (the kill
   overlay, the terminal). Set those <audio> elements to data-volume around
   0.25 so they read as texture, not content.
4. Clip D (the lamp) — keep its real room sound at around 0.5; the physical
   click is the point of that shot.
5. Set the voiceover to data-volume="0.74" (see BLOCK A rule 7 — the mixer adds
   ~+3.2 dB and the mix will clip at 1.0 otherwise).
6. Fade any music or room tone out over the last 1.5s.

Then:
  npx hyperframes check
  npm run render

After rendering, verify the audio did not clip. Run this and report the numbers:

  python - <<EOF
  import numpy as np, subprocess, glob
  f = sorted(glob.glob("renders/*.mp4"))[-1]
  r = subprocess.run(["ffmpeg","-v","error","-i",f,"-ac","1","-ar","44100",
                      "-f","f32le","-"], capture_output=True, check=True)
  x = np.frombuffer(r.stdout, dtype=np.float32)
  print(f, "peak", round(float(np.abs(x).max()),4),
        "clipped samples", int((np.abs(x)>=0.999).sum()))
  EOF

Peak must be below 0.95 and clipped samples must be 0. If not, lower every
data-volume proportionally and render again — do not fix it by lowering only
the loudest element, that changes the balance.
````

---

## PROMPT 5 — the fix-it loop

````
`npx hyperframes check` reported this:

<PASTE THE FULL OUTPUT>

Fix every error. Do not suppress a finding with data-layout-allow-* unless the
overlap is genuinely intentional — take a snapshot at the reported timestamp
first and look at it:

  npx hyperframes snapshot --at <the timestamp from the finding>

Re-run check until it passes with 0 errors. Report what you changed and why.
````

---

## Troubleshooting table — give this to the model with PROMPT 5

| Symptom | Cause | Fix |
| --- | --- | --- |
| Rendered video is blank/black | Timeline registered before the async build finished | Assign `window.__timelines["main"]` as the last line of the build |
| Render is completely silent | An `<audio>` has no `id` | Give every audio element a unique `id` |
| A clip shows the wrong source frames, then vanishes | A `<video data-start>` nested inside a timed wrapper | Time the wrapper or the video, not both |
| `gsap_css_transform_conflict` | CSS transform + GSAP tween on the same property | Use `gsap.fromTo()` and delete the CSS transform |
| `media_crossorigin_breaks_preview` | `crossorigin` on media | Remove it. No exceptions |
| `gsap_repeat_ceil_overshoot` | `Math.ceil` in a repeat count | `Math.max(0, Math.floor(dur/cycle) - 1)` |
| Check says `0 samples` / `0/0 text checks` | A lint **error** disabled the layout and contrast audits | Clear lint errors first — those zeros mean nothing ran |
| Content piled in the top-left corner | Root has no resolved pixel height | Give root explicit width/height in CSS |
| Motion looks fine in preview, jitters in render | Something is reading a clock or measuring the DOM per frame | Bake values once at setup; make every frame a pure function of time |
| Audio distorts on the loudest moment | The mixer's +3.2 dB | Lower all `data-volume` proportionally, re-verify peak < 0.95 |

---

## What to tell the model it must not do

- Do not re-cut, re-time or re-render `focusplug-intro-hook.mp4`. It is final.
- Do not edit a generated file. In `demo-intro/`, `index.html` is generated from
  `scripts/template.html` + `scripts/build_composition.py`. `demo-full/` is a
  separate, hand-written project — that one you edit directly.
- Do not add music without being asked. The narration and the diegetic sound
  carry this piece.
- Do not "improve" the demo content. The clips show what the product does; the
  edit's job is timing and legibility, nothing else.
