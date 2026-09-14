/**
 * The correction loop's renderer half, as pure functions.
 *
 * Every user-visible string in this feature is produced here, and every
 * decision about whether a control may be shown at all is a function of a
 * plain object rather than of React state. That is not tidiness: the two
 * things this UI must never do — offer a button that would fail, and print a
 * ratio about photographs when the unit is corrections — are both testable
 * without a DOM, and `model.test.ts` tests them.
 *
 * The four rules the surfaces below protect (`docs/CORRECTION-LOOP.md § 0`):
 *
 *  1. the student is the authority in the moment — *I was working* resumes in
 *     the same tap, and never waits for a model;
 *  2. one click never retrains — recording and the refit are different
 *     controls, in different places, with different words;
 *  3. a personal head that is worse does not run, and the UI names the head
 *     that IS running;
 *  4. the photographs never leave the machine, and the card says so with a
 *     byte count, a folder button and a one-action delete.
 */

import { CORRECTION_CAP_GROUPS, CORRECTION_REFIT_MIN_GROUPS } from "@shared/correction/constants";
import { correctionMeaning } from "@shared/correction/meaning";
import type {
  CorrectionCooldown,
  CorrectionListItem,
  CorrectionVerdict,
  DeskCorrectionsState,
  PendingCorrection,
  RecordCorrectionRequest,
  RefitReport,
} from "@shared/correction/types";
import type { PauseKind } from "@shared/nudge";
import type { PlanRetraction } from "@shared/correction/types";
import { retractionNotice } from "@shared/plan";
import { formatHmClock } from "../../lib/format";

/* ── shared vocabulary ───────────────────────────────────────────────────── */

export function countLabel(value: number, singular: string, plural: string): string {
  return value === 1 ? `1 ${singular}` : `${value} ${plural}`;
}

/**
 * Corrections, never frames. Nothing in this feature is allowed to say
 * "36 samples" about 12 corrections — three photographs five seconds apart are
 * one independent sample, which is the same discipline the CSV's `group`
 * column and the refit's per-frame weights already enforce.
 */
export function correctionCount(value: number): string {
  return countLabel(value, "correction", "corrections");
}

export function photoCount(value: number): string {
  return countLabel(value, "photo", "photos");
}

/** Bytes as a student reads them. Always one unit, never a range. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 KB";
  }
  if (bytes < 1024) {
    return `${Math.round(bytes)} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Whole minutes, rounded up: "another 0 minutes" is not a thing to say. */
export function minutesLeft(until: number, now: number): number {
  return Math.max(1, Math.ceil((until - now) / 60_000));
}

export function pauseKindWord(kind: PauseKind): string {
  return kind === "phone" ? "Phone" : "Away";
}

/* ── the verdict row on the paused screen ────────────────────────────────── */

export interface VerdictRowInput {
  /** The pause waiting for an answer, pushed by main. */
  pending: PendingCorrection | null;
  /** The run clock's status. Only a stopped clock can carry a verdict row. */
  status: string;
  /** Why it stopped. Null for a pause the student asked for themselves. */
  pausedBy: PauseKind | null;
  now: number;
  /** The correction id already answered in this session of the screen. */
  answeredId: string | null;
}

export interface VerdictRowView {
  id: string;
  kind: PauseKind;
  /** "Was that right?" — one question, and there are only two answers. */
  question: string;
  wrongLabel: string;
  rightLabel: string;
  /** What each chip costs, said before it is pressed. */
  note: string;
  /** True at the cap: the verdict still acts, only the photos are not kept. */
  capped: boolean;
}

/**
 * Whether the paused screen offers a verdict at all, and what it says.
 *
 * Every refusal here is a case where a chip would be a lie:
 *  - no `pending` ⇒ main is holding no frames, so there is nothing to label;
 *  - the clock is not stopped by a drift ⇒ nothing was claimed about them;
 *  - the pending pause is not the pause on screen ⇒ a verdict about the wrong
 *    moment, which is worse than no verdict;
 *  - the answer window has lapsed ⇒ the bytes are already freed, so the tap
 *    would fail;
 *  - it has been answered ⇒ silence, not a second vote.
 */
export function verdictRowView(input: VerdictRowInput): VerdictRowView | null {
  const pending = input.pending;
  if (pending === null || input.status !== "paused" || input.pausedBy === null) {
    return null;
  }
  if (pending.kind !== input.pausedBy) {
    return null;
  }
  if (input.answeredId === pending.id) {
    return null;
  }
  if (!Number.isFinite(pending.expiresAt) || pending.expiresAt <= input.now) {
    return null;
  }
  const photos = pending.capped ? 0 : pending.frames;
  return {
    id: pending.id,
    kind: pending.kind,
    question: "Was that right?",
    wrongLabel: "I was working",
    rightLabel: "You were right",
    note: pending.capped
      ? "at the storage cap — your answer still counts, no new photos are kept"
      : `saves ${photoCount(photos)} to this computer · Settings → Desk model`,
    capped: pending.capped,
  };
}

/* ── what a tap does, as data ────────────────────────────────────────────── */

/**
 * How long the sentence after a verdict stays up.
 *
 * `NudgeOverlay`'s 12 s, deliberately reused rather than re-invented: it is
 * this product's existing answer to "long enough to read once, short enough
 * not to become furniture". The chips themselves are never on a timer — that
 * is the whole reason they are not on the overlay — but a confirmation the
 * student has already earned is exactly the thing that should fade.
 */
export const VERDICT_OUTCOME_MS = 12_000;

export interface VerdictAction {
  /** Restart the clock, now, before anything is written. */
  resume: boolean;
  /** What to send to main, or null when nothing should be written at all. */
  record: RecordCorrectionRequest | null;
}

/**
 * The two chips and the primary button, as three data answers.
 *
 * `"wrong"` resumes AND records, in one tap: the student said the app was
 * wrong, and making them press a second button to undo the app's mistake would
 * be the app arguing. `"right"` records and does not resume — they were on
 * their phone, and the way back is to put it down and press the primary
 * button. `null` is *Start the clock again*, which resumes and writes NOTHING:
 * silence is not a label, and a UI that harvested one from a dismissal would
 * be manufacturing training data out of impatience.
 */
export function verdictAction(
  correctionId: string,
  verdict: CorrectionVerdict | null,
): VerdictAction {
  if (verdict === null) {
    return { resume: true, record: null };
  }
  return {
    resume: verdict === "wrong",
    record: { correctionId, verdict },
  };
}

/* ── what the screen says after the tap ──────────────────────────────────── */

export interface VerdictOutcomeInput {
  kind: PauseKind;
  verdict: CorrectionVerdict;
  /** Non-null when a cooldown was armed. */
  cooldown: CorrectionCooldown | null;
  retraction: PlanRetraction | null;
  /** False when main refused the record — the offer lapsed under them. */
  recorded: boolean;
  capped: boolean;
  now: number;
}

export interface VerdictOutcomeView {
  /** The headline sentence. Always present. */
  line: string;
  /** The Focus Plan disclosure, or null when there was nothing to say. */
  planLine: string | null;
}

/**
 * The second the paused screen owes them after a tap: what the app just
 * promised, and what it did to their history.
 *
 * The behavioural half is stated first and unconditionally, because it is the
 * half that already happened. A refused record does NOT claim a cooldown — a
 * sentence promising twenty-five minutes of silence that main is not honouring
 * would be the worst copy in this feature.
 */
export function verdictOutcomeView(input: VerdictOutcomeInput): VerdictOutcomeView {
  const planLine = retractionNotice(input.retraction);
  if (!input.recorded) {
    return {
      line:
        "Started again. That moment had already passed, so nothing was saved — " +
        "the clock is yours either way.",
      planLine,
    };
  }
  const photos = input.capped
    ? "no new photos were kept — you are at the storage cap"
    : "the photos from that moment are saved on this computer";
  if (input.cooldown === null) {
    return {
      line: `Thanks — that is noted, and ${photos}.`,
      planLine,
    };
  }
  const minutes = minutesLeft(input.cooldown.until, input.now);
  const what = input.kind === "phone" ? "for a phone" : "for leaving your desk";
  return {
    line:
      `Started again. FocusPlug will not pause you ${what} for the next ` +
      `${countLabel(minutes, "minute", "minutes")}, and ${photos}.`,
    planLine,
  };
}

/** "Phone pauses are off for another 18 minutes — you corrected one at 21:04." */
export function cooldownLine(
  cooldown: CorrectionCooldown,
  correctedAt: number | null,
  now: number,
): string {
  const minutes = minutesLeft(cooldown.until, now);
  const when = correctedAt === null ? "" : ` — you corrected one at ${formatHmClock(correctedAt)}`;
  return `${pauseKindWord(cooldown.kind)} pauses are off for another ${countLabel(
    minutes,
    "minute",
    "minutes",
  )}${when}.`;
}

/* ── the review list ─────────────────────────────────────────────────────── */

export interface CorrectionRowView {
  id: string;
  /** "12 Mar 21:04". */
  when: string;
  /** "the model said phone (0.94)". */
  said: string;
  /** "you said: I was working". */
  answered: string;
  /** "3 photos · 104 KB", or the capped line. */
  size: string;
  thumbnail: string | null;
  /** "presence evidence — not used to retrain", or null. */
  excludedBecause: string | null;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "12 Mar 21:04", local, because the record's `day` is stamped local in main. */
export function correctionWhen(at: number): string {
  if (!Number.isFinite(at)) {
    return "unknown time";
  }
  const date = new Date(at);
  const month = MONTHS[date.getMonth()] ?? "";
  return `${date.getDate()} ${month} ${formatHmClock(at)}`.trim();
}

/** The student's own words, back to them. Never the label the model uses. */
export function verdictSentence(kind: PauseKind, verdict: CorrectionVerdict): string {
  if (kind === "phone") {
    return verdict === "wrong" ? "I was working" : "you were right";
  }
  return verdict === "wrong" ? "I was here" : "you were right";
}

export function correctionRow(item: CorrectionListItem): CorrectionRowView {
  return {
    id: item.id,
    when: correctionWhen(item.at),
    said: `the model said ${item.modelLabel} (${item.modelConfidence.toFixed(2)})`,
    answered: `you said: ${verdictSentence(item.kind, item.verdict)}`,
    size: item.capped
      ? "no photos kept — recorded at the storage cap"
      : `${photoCount(item.frames)} · ${formatBytes(item.bytes)}`,
    thumbnail: item.thumbnail,
    excludedBecause: item.excludedBecause,
  };
}

export interface CorrectionsCardView {
  /** True when there is nothing to show at all — a non-custom desk model. */
  hidden: boolean;
  /** "41 · 3.1 MB" */
  summary: string;
  /** Newest first. Main ships them oldest first, like every ledger here. */
  rows: CorrectionRowView[];
  /** The stated privacy claim, rendered verbatim. Never empty. */
  privacy: string;
  /** The one thing deleting does not undo, said before they press it. */
  deleteCaveat: string;
  /** The label on the delete-all control, with what it will remove. */
  deleteAllLabel: string;
  /** Present at the cap. */
  capNotice: string | null;
  /** One line per live cooldown. */
  cooldownLines: string[];
  /** Empty-state copy, or null when there are rows. */
  empty: string | null;
}

export function correctionsCardView(
  state: DeskCorrectionsState,
  now: number,
): CorrectionsCardView {
  const rows = [...state.items].sort((a, b) => b.at - a.at).map(correctionRow);
  const byId = new Map(state.items.map((item) => [item.id, item.at] as const));
  return {
    hidden: !state.available,
    summary: `${correctionCount(state.items.length)} · ${formatBytes(state.bytes)}`,
    rows,
    privacy:
      "Photos from the moments FocusPlug got it wrong, and the ones it got right. " +
      "They are on this computer, in desk-corrections/, and they are never uploaded.",
    deleteCaveat:
      "Your focus history keeps the drifts you retracted — you told us those were wrong, " +
      "and that is still true.",
    deleteAllLabel: `Delete all my correction photos (${correctionCount(
      state.items.length,
    )} · ${formatBytes(state.bytes)})`,
    capNotice: state.capped
      ? `${correctionCount(CORRECTION_CAP_GROUPS)} stored — the most this keeps. ` +
        "Delete some, or retrain, to record more. Your answers still count; only the " +
        "photos are skipped."
      : null,
    cooldownLines: state.cooldowns.map((cooldown) =>
      cooldownLine(cooldown, byId.get(cooldown.correctionId) ?? null, now),
    ),
    empty:
      rows.length > 0
        ? null
        : state.enabled
          ? "Nothing stored. A correction only exists when FocusPlug stops your clock and " +
            "you answer — restarting it without answering writes nothing at all."
          : "Corrections are switched off, so nothing is captured and nothing is written.",
  };
}

/* ── which head is active ────────────────────────────────────────────────── */

/**
 * `off` is the fourth state and it is not decoration: a personal head that
 * passed the gate and was then switched off has to keep saying so, or the
 * preference that turned it off would hide the only control that turns it back
 * on — and the student would be left reading the plain shipped-head copy with
 * no way to tell that a fitted head is sitting there unused.
 */
export type HeadStatusVariant = "shipped" | "personal" | "off" | "failed";

export interface HeadStatusView {
  variant: HeadStatusVariant;
  /** "Attention head — shipped" / "— personal". */
  title: string;
  /** The paragraph under it. Always present, never empty. */
  body: string;
  /** How many more corrections a refit needs, or null when it is ready. */
  needLine: string | null;
  /** True when the refit button may be pressed at all. */
  refitReady: boolean;
  refitLabel: string;
  /** The gate that stopped the last refit, or null. */
  blockedBy: string | null;
  /** A head that passed the gate exists on disk, running or not. The revert
   *  switch renders off THIS, never off which head happens to be active. */
  hasPersonalHead: boolean;
}

function points(value: number): string {
  return `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}`;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

/**
 * The three states of §8, in the student's words, with both scores every time.
 *
 * The rule the copy test pins: whenever this says a personal head is running,
 * it prints the shipped head's score beside it. A number with nothing to
 * compare it against is the one way this feature could mislead.
 */
export function headStatusView(state: DeskCorrectionsState): HeadStatusView {
  const stored = state.items.length;
  const need = Math.max(0, state.refitNeeded);
  const last = state.lastRefit;
  const hasPersonalHead = last !== null && last.installed;
  const refitLabel = hasPersonalHead ? "Retrain" : "Fit a personal head";
  const needLine =
    need > 0
      ? `${correctionCount(need)} more before a head can be fitted from them. ` +
        `${correctionCount(CORRECTION_REFIT_MIN_GROUPS)} are needed in all, and only ` +
        "phone corrections count — an away correction is presence evidence."
      : null;

  if (hasPersonalHead && state.activeHead === "personal") {
    return {
      variant: "personal",
      title: "Attention head — personal",
      body: personalBody(last),
      needLine: null,
      refitReady: state.refitReady,
      refitLabel,
      blockedBy: null,
      hasPersonalHead,
    };
  }

  if (hasPersonalHead) {
    // Passed the gate, and not running. It says so rather than quietly
    // rendering the plain shipped copy over a head that exists.
    //
    // TWO ways to get here and the copy is true of both, which is why it does
    // not name one: the student switched it off with
    // `personalAttentionHeadEnabled`, or an app update shipped a new attention
    // head and their 51 numbers were fitted against the old bottleneck, so
    // `personalHeadFits` refuses them — in main and on this card, through the
    // same predicate. Claiming "you switched it off" to somebody who did not
    // would be the card lying about the one thing it is here to report.
    return {
      variant: "off",
      title: "Attention head — shipped",
      body:
        "A personal head fitted from your corrections passed the gate and is not running, " +
        `so the shipped head is. ${personalBody(last)} Switch it back on under Desk model, ` +
        "or fit a new one — an app update that changes the shipped head retires the old fit.",
      needLine: null,
      refitReady: state.refitReady,
      refitLabel,
      blockedBy: null,
      hasPersonalHead,
    };
  }

  if (last !== null) {
    const gate = last.blockedBy ?? "no-personal-gain";
    return {
      variant: "failed",
      title: "Attention head — shipped",
      body:
        `The last refit, from ${correctionCount(last.corrections.total)}, scored ` +
        `${percent(last.personal.pooled.balanced)} against the shipped head's ` +
        `${percent(last.shipped.pooled.balanced)} on the ` +
        `${last.shipped.pooled.images}-image held-out eval and was discarded — ${gate}. ` +
        "Your corrections are kept; nothing was deleted. Correct a few more and try again.",
      needLine,
      refitReady: state.refitReady,
      refitLabel,
      blockedBy: gate,
      hasPersonalHead,
    };
  }

  return {
    variant: "shipped",
    title: "Attention head — shipped",
    body:
      "Trained on 693 labelled stock photographs, none of them from your camera. It is " +
      "right about phones roughly half to two thirds of the time and calls about one " +
      "non-phone photo in six a phone; that is why pause on phone ships off. " +
      `You have ${correctionCount(stored)} stored.`,
    needLine,
    refitReady: state.refitReady,
    refitLabel,
    blockedBy: null,
    hasPersonalHead,
  };
}

function personalBody(report: RefitReport): string {
  const pooled = report.shipped.pooled;
  const shipped = percent(report.shipped.pooled.balanced);
  const personal = percent(report.personal.pooled.balanced);
  const delta = (report.personal.pooled.balanced - report.shipped.pooled.balanced) * 100;
  const ci = report.pooledMarginCi95;
  const interval =
    ci === null
      ? ""
      : `, 95% interval ${points(ci.lo)} to ${points(ci.hi)}`;
  const holdout = report.personal.personalHoldout;
  const own =
    holdout === null
      ? ""
      : ` On your own ${countLabel(holdout.groups, "held-out correction", "held-out corrections")}` +
        ` it agrees with you ${report.personal.personalHoldoutGroupsCorrect} times; the shipped ` +
        `head agreed ${report.shipped.personalHoldoutGroupsCorrect}.`;
  return (
    `Fitted from ${correctionCount(report.corrections.total)} of yours. On the same ` +
    `${pooled.images}-image held-out eval the shipped head scores ${shipped} and this one ` +
    `${personal}; the difference is ${points(delta)} points${interval}.${own}`
  );
}

/**
 * The "Why this?" disclosure: every gate, in order, pass or fail, with its
 * numbers — the same shape Focus Plan's evidence table uses. A student who
 * wants to know why their model did or did not change can read the whole
 * decision.
 */
export interface GateRowView {
  id: string;
  passed: boolean;
  detail: string;
  /** True for the FIRST failure — the one that actually stopped it. */
  blocking: boolean;
}

export function gateRows(report: RefitReport | null): GateRowView[] {
  if (report === null) {
    return [];
  }
  let seenFailure = false;
  return report.gates.map((gate) => {
    const blocking = !gate.passed && !seenFailure;
    if (!gate.passed) {
      seenFailure = true;
    }
    return { id: gate.id, passed: gate.passed, detail: gate.detail, blocking };
  });
}

/** The one line that says what the refit did, for the log and the card. */
export function refitSummary(report: RefitReport): string {
  if (report.installed) {
    return report.gateEnforced
      ? "Installed — it beat the shipped head on the held-out eval."
      : "Installed WITHOUT the gate — a developer switch, and it stays visible until the next real refit.";
  }
  return `Discarded — ${report.blockedBy ?? "no gate recorded"}. Your corrections are kept.`;
}

/* ── the "away corrections do not retrain" reconciliation ────────────────── */

/**
 * The count on the refit button and the count in the list must reconcile on
 * screen, which is why an away row carries its own reason for not being in the
 * pool. Derived from the frozen `kind × verdict` table rather than restated.
 */
export function trainsPersonalHead(kind: PauseKind, verdict: CorrectionVerdict): boolean {
  return correctionMeaning(kind, verdict).trainsPersonalHead;
}
