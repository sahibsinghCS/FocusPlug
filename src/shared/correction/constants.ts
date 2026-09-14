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
