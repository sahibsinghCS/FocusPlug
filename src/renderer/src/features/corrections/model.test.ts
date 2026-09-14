import { describe, expect, it } from "vitest";
import {
  CORRECTION_CAP_GROUPS,
  CORRECTION_COOLDOWN_MS,
  CORRECTION_REFIT_MIN_GROUPS,
} from "@shared/correction/constants";
import { CORRECTION_MEANING } from "@shared/correction/meaning";
import type { CorrectionCase, DeskCorrectionsState } from "@shared/correction/types";
import {
  cooldownLine,
  correctionCount,
  correctionRow,
  correctionsCardView,
  formatBytes,
  gateRows,
  headStatusView,
  minutesLeft,
  photoCount,
  refitSummary,
  trainsPersonalHead,
  verdictAction,
  verdictOutcomeView,
  verdictRowView,
  verdictSentence,
} from "./model";
import {
  correctionSceneState,
  pendingCorrection,
  refitReport,
  CORRECTION_SCENES,
} from "./scenes";

const NOW = 1_800_000_000_000;

function state(scene: (typeof CORRECTION_SCENES)[number]): DeskCorrectionsState {
  const seeded = correctionSceneState(scene, NOW);
  if (seeded === null) {
    throw new Error(`scene ${scene} produced no state`);
  }
  return seeded;
}

/* ── the verdict row ─────────────────────────────────────────────────────── */

describe("verdictRowView — the chips appear only when a verdict is real", () => {
  const pending = pendingCorrection("phone", NOW);
  const live = { pending, status: "paused", pausedBy: "phone" as const, now: NOW, answeredId: null };

  it("offers both chips on a paused clock with a capture in hand", () => {
    const view = verdictRowView(live);
    expect(view?.wrongLabel).toBe("I was working");
    expect(view?.rightLabel).toBe("You were right");
    // Equal weight, equal size, no default: neither chip is marked primary.
    expect(view?.question).toBe("Was that right?");
  });

  it("says what the tap costs before it is pressed", () => {
    expect(verdictRowView(live)?.note).toContain("saves 3 photos to this computer");
  });

  it("shows nothing at all with no capture — the default install", () => {
    expect(verdictRowView({ ...live, pending: null })).toBeNull();
  });

  it("shows nothing while the clock is running", () => {
    expect(verdictRowView({ ...live, status: "running" })).toBeNull();
  });

  it("shows nothing on a pause the student asked for themselves", () => {
    expect(verdictRowView({ ...live, pausedBy: null })).toBeNull();
  });

  it("shows nothing when the capture is about a different kind of pause", () => {
    expect(verdictRowView({ ...live, pausedBy: "away" })).toBeNull();
  });

  it("disappears when the answer window lapses — the bytes are already freed", () => {
    expect(verdictRowView({ ...live, now: pending.expiresAt })).toBeNull();
    expect(verdictRowView({ ...live, now: pending.expiresAt + 1 })).toBeNull();
    expect(verdictRowView({ ...live, now: pending.expiresAt - 1 })).not.toBeNull();
  });

  it("refuses a capture with a broken expiry rather than offering a doomed tap", () => {
    expect(verdictRowView({ ...live, pending: { ...pending, expiresAt: Number.NaN } })).toBeNull();
  });

  it("does not offer a second vote on a correction already answered", () => {
    expect(verdictRowView({ ...live, answeredId: pending.id })).toBeNull();
  });

  it("still offers both chips at the cap, and says only the photos are skipped", () => {
    const capped = pendingCorrection("phone", NOW, { capped: true });
    const view = verdictRowView({ ...live, pending: capped });
    expect(view).not.toBeNull();
    expect(view?.capped).toBe(true);
    expect(view?.note).toContain("your answer still counts");
    expect(view?.note).not.toContain("saves");
  });
});

describe("verdictAction — one tap, and exactly what it does", () => {
  it("I was working resumes AND records, in the same tap", () => {
    expect(verdictAction("dc-0007", "wrong")).toEqual({
      resume: true,
      record: { correctionId: "dc-0007", verdict: "wrong" },
    });
  });

  it("You were right records and does not resume", () => {
    expect(verdictAction("dc-0007", "right")).toEqual({
      resume: false,
      record: { correctionId: "dc-0007", verdict: "right" },
    });
  });

  it("Start the clock again resumes and records NOTHING — silence is not a label", () => {
    expect(verdictAction("dc-0007", null)).toEqual({ resume: true, record: null });
  });
});

/* ── what the screen says afterwards ─────────────────────────────────────── */

describe("verdictOutcomeView", () => {
  const cooldown = {
    kind: "phone" as const,
    until: NOW + CORRECTION_COOLDOWN_MS.phone,
    correctionId: "dc-0007",
  };

  it("promises the silence it actually armed, in minutes", () => {
    const view = verdictOutcomeView({
      kind: "phone",
      verdict: "wrong",
      cooldown,
      retraction: null,
      recorded: true,
      capped: false,
      now: NOW,
    });
    expect(view.line).toBe(
      "Started again. FocusPlug will not pause you for a phone for the next 25 minutes, " +
        "and the photos from that moment are saved on this computer.",
    );
  });

  it("names leaving the desk rather than a phone on an away correction", () => {
    const view = verdictOutcomeView({
      kind: "away",
      verdict: "wrong",
      cooldown: { ...cooldown, kind: "away", until: NOW + CORRECTION_COOLDOWN_MS.away },
      retraction: null,
      recorded: true,
      capped: false,
      now: NOW,
    });
    expect(view.line).toContain("for leaving your desk for the next 10 minutes");
  });

  it("never promises a cooldown it did not arm", () => {
    const view = verdictOutcomeView({
      kind: "phone",
      verdict: "right",
      cooldown: null,
      retraction: null,
      recorded: true,
      capped: false,
      now: NOW,
    });
    expect(view.line).not.toContain("minutes");
    expect(view.line).toContain("that is noted");
  });

  it("says nothing was saved when the offer had already lapsed", () => {
    const view = verdictOutcomeView({
      kind: "phone",
      verdict: "wrong",
      cooldown: null,
      retraction: null,
      recorded: false,
      capped: false,
      now: NOW,
    });
    expect(view.line).toContain("nothing was saved");
    expect(view.line).toContain("the clock is yours either way");
  });

  it("says the photos were skipped at the cap rather than claiming them", () => {
    const view = verdictOutcomeView({
      kind: "phone",
      verdict: "wrong",
      cooldown,
      retraction: null,
      recorded: true,
      capped: true,
      now: NOW,
    });
    expect(view.line).toContain("no new photos were kept");
    expect(view.line).not.toContain("are saved on this computer");
  });

  it("reports a Focus Plan retraction, and a refusal, as a quiet second line", () => {
    const done = verdictOutcomeView({
      kind: "away",
      verdict: "wrong",
      cooldown: null,
      retraction: {
        retracted: true,
        roundKey: "r1",
        retractedAtSec: 360,
        firstDriftSecBefore: 360,
        firstDriftSecAfter: null,
        refusal: null,
      },
      recorded: true,
      capped: false,
      now: NOW,
    });
    expect(done.planLine).toBe("That drift is out of your focus history — it was not one.");

    const refused = verdictOutcomeView({
      kind: "away",
      verdict: "wrong",
      cooldown: null,
      retraction: {
        retracted: false,
        roundKey: null,
        retractedAtSec: null,
        firstDriftSecBefore: null,
        firstDriftSecAfter: null,
        refusal: "not-open",
      },
      recorded: true,
      capped: false,
      now: NOW,
    });
    expect(refused.planLine).toBe(
      "your focus history was not changed — that round had already ended",
    );
  });

  it("says nothing about Focus Plan on a phone correction — there is nothing to undo", () => {
    const view = verdictOutcomeView({
      kind: "phone",
      verdict: "wrong",
      cooldown,
      retraction: null,
      recorded: true,
      capped: false,
      now: NOW,
    });
    expect(view.planLine).toBeNull();
  });
});

describe("cooldownLine", () => {
  it("names the minutes left and the correction that armed it", () => {
    const line = cooldownLine(
      { kind: "phone", until: NOW + 18 * 60_000, correctionId: "dc-0001" },
      NOW - 3 * 60_000,
      NOW,
    );
    expect(line).toContain("Phone pauses are off for another 18 minutes");
    expect(line).toContain("you corrected one at");
  });

  it("never says zero minutes", () => {
    expect(minutesLeft(NOW + 500, NOW)).toBe(1);
    expect(minutesLeft(NOW - 5_000, NOW)).toBe(1);
  });
});

/* ── the review card ─────────────────────────────────────────────────────── */

describe("correctionsCardView — the privacy affordance", () => {
  it("states plainly that the photos never leave the machine", () => {
    const view = correctionsCardView(state("corrections-list"), NOW);
    expect(view.privacy).toContain("on this computer");
    expect(view.privacy).toContain("never uploaded");
    expect(view.privacy).toContain("desk-corrections/");
  });

  it("says the one thing deleting does not undo, before they press it", () => {
    const view = correctionsCardView(state("corrections-list"), NOW);
    expect(view.deleteCaveat).toContain("keeps the drifts you retracted");
  });

  it("puts the count and the byte total in the delete label", () => {
    const view = correctionsCardView(state("corrections-list"), NOW);
    expect(view.deleteAllLabel).toContain("14 corrections");
    expect(view.deleteAllLabel).toMatch(/\d+(\.\d)? (KB|MB)/);
  });

  it("lists newest first", () => {
    const view = correctionsCardView(state("corrections-list"), NOW);
    const times = state("corrections-list").items.map((item) => item.at);
    expect(view.rows).toHaveLength(times.length);
    expect(view.rows[0]?.when).toBeTruthy();
    const seeded = [...state("corrections-list").items].sort((a, b) => b.at - a.at);
    expect(view.rows.map((row) => row.id)).toEqual(seeded.map((item) => item.id));
  });

  it("labels an away row as presence evidence, so the two counts reconcile", () => {
    const view = correctionsCardView(state("corrections-list"), NOW);
    const away = view.rows.filter((row) => row.excludedBecause !== null);
    expect(away.length).toBeGreaterThan(0);
    for (const row of away) {
      expect(row.excludedBecause).toBe("presence evidence — not used to retrain");
    }
  });

  it("renders the live cooldown", () => {
    const view = correctionsCardView(state("corrections-list"), NOW);
    expect(view.cooldownLines).toHaveLength(1);
    expect(view.cooldownLines[0]).toContain("Phone pauses are off");
  });

  it("says at the cap that answers still count and photos do not", () => {
    const view = correctionsCardView(state("correction-capped"), NOW);
    expect(view.capNotice).toContain(`${CORRECTION_CAP_GROUPS} corrections stored`);
    expect(view.capNotice).toContain("Your answers still count");
  });

  it("explains the empty state rather than showing a blank box", () => {
    const view = correctionsCardView(state("corrections-empty"), NOW);
    expect(view.rows).toEqual([]);
    expect(view.empty).toContain("restarting it without answering writes nothing");
  });

  it("hides itself entirely on a model that cannot pause", () => {
    const off = { ...state("corrections-empty"), available: false };
    expect(correctionsCardView(off, NOW).hidden).toBe(true);
  });
});

describe("correctionRow", () => {
  const item = state("corrections-list").items[0];

  it("shows what the model said, how sure, and what the student answered", () => {
    const row = correctionRow(item!);
    expect(row.said).toMatch(/^the model said (phone|away) \(0\.\d\d\)$/);
    expect(row.answered).toMatch(/^you said: /);
    expect(row.size).toMatch(/^3 photos · \d+ KB$/);
  });

  it("gives the student's own words back, per kind", () => {
    expect(verdictSentence("phone", "wrong")).toBe("I was working");
    expect(verdictSentence("phone", "right")).toBe("you were right");
    expect(verdictSentence("away", "wrong")).toBe("I was here");
    expect(verdictSentence("away", "right")).toBe("you were right");
  });

  it("says a capped row kept no photos rather than showing 0 photos · 0 KB", () => {
    const row = correctionRow({ ...item!, capped: true, frames: 0, bytes: 0, thumbnail: null });
    expect(row.size).toBe("no photos kept — recorded at the storage cap");
  });
});

/* ── which head is running ───────────────────────────────────────────────── */

describe("headStatusView — both scores, every time", () => {
  it("names the shipped head, its weakness, and how many corrections are stored", () => {
    const view = headStatusView(state("corrections-list"));
    expect(view.variant).toBe("shipped");
    expect(view.title).toBe("Attention head — shipped");
    expect(view.body).toContain("693 labelled stock photographs");
    expect(view.body).toContain("one non-phone photo in six");
    expect(view.body).toContain("14 corrections stored");
  });

  it("prints the shipped head's score beside the personal head's", () => {
    const view = headStatusView(state("corrections-personal"));
    expect(view.variant).toBe("personal");
    expect(view.title).toBe("Attention head — personal");
    expect(view.body).toContain("61.9%");
    expect(view.body).toContain("62.6%");
    expect(view.body).toContain("286-image held-out eval");
    expect(view.body).toContain("95% interval");
    // Corrections, never frames.
    expect(view.body).toContain("14 corrections");
    expect(view.body).not.toMatch(/\d+ (samples|images) of yours/);
  });

  it("reports the student's own held-out corrections in corrections", () => {
    const view = headStatusView(state("corrections-personal"));
    expect(view.body).toContain("your own 6 held-out corrections");
    expect(view.body).toContain("agrees with you 5 times");
    expect(view.body).toContain("shipped head agreed 2");
  });

  it("names the gate that discarded a failed refit, and says nothing was deleted", () => {
    const view = headStatusView(state("corrections-failed"));
    expect(view.variant).toBe("failed");
    expect(view.title).toBe("Attention head — shipped");
    expect(view.blockedBy).toBe("regressed-pooled");
    expect(view.body).toContain("regressed-pooled");
    expect(view.body).toContain("60.1%");
    expect(view.body).toContain("61.9%");
    expect(view.body).toContain("nothing was deleted");
  });

  it("says how many more corrections a refit needs, and that away ones do not count", () => {
    const thin = { ...state("corrections-empty"), refitNeeded: 5 };
    const view = headStatusView(thin);
    expect(view.needLine).toContain("5 corrections more");
    expect(view.needLine).toContain(`${CORRECTION_REFIT_MIN_GROUPS} corrections are needed`);
    expect(view.needLine).toContain("presence evidence");
    expect(view.refitReady).toBe(false);
  });

  it("has no need line once the floors are met", () => {
    expect(headStatusView(state("corrections-personal")).needLine).toBeNull();
  });

  it("never claims a personal head is active without an installed report", () => {
    const lying = { ...state("corrections-failed"), activeHead: "personal" as const };
    // The report says `installed: false`, so the card refuses to call it personal.
    expect(headStatusView(lying).variant).toBe("failed");
    expect(headStatusView(lying).hasPersonalHead).toBe(false);
  });

  it("keeps saying a personal head that is not running exists, so the revert is two-way", () => {
    // The trap this closes: `personalAttentionHeadEnabled: false` makes main
    // report `activeHead: "shipped"`. If the card read the switch off THAT, it
    // would render the plain shipped copy and hide the only control that turns
    // the head back on.
    const off = { ...state("corrections-personal"), activeHead: "shipped" as const };
    const view = headStatusView(off);
    expect(view.variant).toBe("off");
    expect(view.hasPersonalHead).toBe(true);
    expect(view.title).toBe("Attention head — shipped");
    expect(view.body).toContain("passed the gate and is not running");
    // …and it does not guess WHICH of the two reasons applies. An app update
    // that changes the shipped head retires the fit too, and telling that
    // student they switched it off would be the card inventing a cause.
    expect(view.body).not.toContain("you switched");
    expect(view.body).toContain("an app update that changes the shipped head");
    // And it still prints both scores, so the choice is an informed one.
    expect(view.body).toContain("61.9%");
    expect(view.body).toContain("62.6%");
    expect(view.refitLabel).toBe("Retrain");
  });

  it("offers no revert switch when there is no head to revert to", () => {
    expect(headStatusView(state("corrections-list")).hasPersonalHead).toBe(false);
    expect(headStatusView(state("corrections-empty")).hasPersonalHead).toBe(false);
  });
});

describe("gateRows — every gate, in order, and the first failure is the blocking one", () => {
  it("marks exactly one blocking gate", () => {
    const rows = gateRows(state("corrections-failed").lastRefit);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => row.blocking)).toHaveLength(1);
    expect(rows.find((row) => row.blocking)?.id).toBe("regressed-pooled");
  });

  it("marks none when every gate passed", () => {
    const rows = gateRows(state("corrections-personal").lastRefit);
    expect(rows.every((row) => row.passed)).toBe(true);
    expect(rows.some((row) => row.blocking)).toBe(false);
  });

  it("gives every gate a non-empty detail, so the disclosure is never blank", () => {
    for (const scene of ["corrections-personal", "corrections-failed"] as const) {
      for (const row of gateRows(state(scene).lastRefit)) {
        expect(row.detail.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("returns nothing when there has never been a refit", () => {
    expect(gateRows(null)).toEqual([]);
  });
});

describe("refitSummary", () => {
  it("says installed only when it was, and names the gate when it was not", () => {
    expect(refitSummary(refitReport(true, NOW))).toContain("Installed");
    expect(refitSummary(refitReport(false, NOW))).toContain("Discarded — regressed-pooled");
    expect(refitSummary(refitReport(false, NOW))).toContain("Your corrections are kept");
  });

  it("says out loud when the gate was switched off", () => {
    const ungated = { ...refitReport(true, NOW), gateEnforced: false };
    expect(refitSummary(ungated)).toContain("WITHOUT the gate");
  });
});

/* ── the vocabulary ──────────────────────────────────────────────────────── */

describe("counting", () => {
  it("counts corrections, not frames", () => {
    expect(correctionCount(1)).toBe("1 correction");
    expect(correctionCount(12)).toBe("12 corrections");
    expect(photoCount(1)).toBe("1 photo");
    expect(photoCount(3)).toBe("3 photos");
  });

  it("formats bytes in one unit, and never as a bare zero", () => {
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(-5)).toBe("0 KB");
    expect(formatBytes(Number.NaN)).toBe("0 KB");
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(104_000)).toBe("102 KB");
    expect(formatBytes(3_250_000)).toBe("3.1 MB");
  });

  it("reads the refit pool off the frozen kind x verdict table, never a copy", () => {
    for (const key of Object.keys(CORRECTION_MEANING) as CorrectionCase[]) {
      const [kind, verdict] = key.split(":") as ["away" | "phone", "wrong" | "right"];
      expect(trainsPersonalHead(kind, verdict)).toBe(CORRECTION_MEANING[key].trainsPersonalHead);
    }
    // And the consequence the UI leans on: away corrections never train.
    expect(trainsPersonalHead("away", "wrong")).toBe(false);
    expect(trainsPersonalHead("away", "right")).toBe(false);
  });
});
