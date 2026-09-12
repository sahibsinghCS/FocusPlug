import { describe, expect, it } from "vitest";
import type { DeskSnapshot, FocusSnapshot } from "../types";
import { FNV1A_OFFSET_BASIS, fnv1a32, processHash, titleHash } from "./hash";
import { FRAME_CAPACITY, TRANSITION_CAPACITY, TelemetryRing } from "./ring";

const T0 = 1_700_000_000_000;
const SEC = 1000;

function focus(
  ts: number,
  processName: string,
  windowTitle = "untitled",
  matchedAllow = true,
  matchedBlock = false,
): FocusSnapshot {
  return { ts, processName, windowTitle, matchedAllow, matchedBlock };
}

function desk(ts: number, confidence = 0.9, label: DeskSnapshot["label"] = "at_desk"): DeskSnapshot {
  return { ts, label, confidence, webcamEnabled: true };
}

function freshRing(): TelemetryRing {
  const ring = new TelemetryRing();
  ring.reset(T0);
  return ring;
}

describe("fnv1a32", () => {
  it("matches the published FNV-1a 32-bit test vectors", () => {
    // Offset basis: hash of the empty string.
    expect(fnv1a32("")).toBe(FNV1A_OFFSET_BASIS);
    expect(fnv1a32("")).toBe(2166136261);
    expect(fnv1a32("a")).toBe(0xe40c292c);
    expect(fnv1a32("foobar")).toBe(0xbf9cf968);
  });

  it("is stable, unsigned, and case-normalized through the title/process helpers", () => {
    expect(fnv1a32("discord — #general")).toBe(fnv1a32("discord — #general"));
    expect(fnv1a32("discord — #general")).toBeGreaterThanOrEqual(0);
    expect(titleHash("FooBar")).toBe(fnv1a32("foobar"));
    expect(processHash("Discord.EXE")).toBe(fnv1a32("discord.exe"));
    // Different strings must map to different hashes for these fixtures —
    // the switch/churn features count hash changes.
    expect(titleHash("tab one")).not.toBe(titleHash("tab two"));
  });
});

describe("TelemetryRing frames", () => {
  it("commits one coalesced frame per second, last writer wins", () => {
    const ring = freshRing();
    ring.noteFocus(focus(T0 + 200, "code.exe", "a.ts"));
    ring.noteFocus(focus(T0 + 500, "spotify.exe", "playlist", false, false));
    ring.noteFocus(focus(T0 + 900, "chrome.exe", "docs"));
    ring.noteDesk(desk(T0 + 400, 0.7), 0.6);
    ring.noteDesk(desk(T0 + 800, 0.9), 0.6);
    const frame = ring.commit(T0 + SEC);
    expect(frame).not.toBeNull();
    expect(frame?.processKey).toBe("chrome.exe");
    expect(frame?.titleHash).toBe(titleHash("docs"));
    expect(frame?.focusKind).toBe("allow");
    expect(frame?.deskConfidence).toBe(0.9);
    expect(frame?.deskPresence).toBe("present");
    expect(ring.frameCount).toBe(1);
    // Both fast switches were still recorded exactly.
    expect(ring.transitionsInRange(T0, T0 + SEC, "proc")).toHaveLength(2);
  });

  it("rejects non-increasing and non-finite commit timestamps", () => {
    const ring = freshRing();
    expect(ring.commit(T0 + SEC)).not.toBeNull();
    expect(ring.commit(T0 + SEC)).toBeNull();
    expect(ring.commit(T0 + 500)).toBeNull();
    expect(ring.commit(Number.NaN)).toBeNull();
    expect(ring.frameCount).toBe(1);
  });

  it("evicts oldest frames beyond capacity", () => {
    const ring = freshRing();
    const total = FRAME_CAPACITY + 100;
    for (let i = 1; i <= total; i += 1) {
      ring.commit(T0 + i * SEC);
    }
    expect(ring.frameCount).toBe(FRAME_CAPACITY);
    const all = ring.framesInRange(0, Number.POSITIVE_INFINITY);
    expect(all).toHaveLength(FRAME_CAPACITY);
    // The first 100 commits fell off; the survivors are exactly 101..700.
    expect(all[0]?.ts).toBe(T0 + 101 * SEC);
    expect(all[all.length - 1]?.ts).toBe(T0 + total * SEC);
  });

  it("framesInRange is exclusive below, inclusive above", () => {
    const ring = freshRing();
    for (let i = 1; i <= 5; i += 1) {
      ring.commit(T0 + i * SEC);
    }
    const frames = ring.framesInRange(T0 + 2 * SEC, T0 + 4 * SEC);
    expect(frames.map((frame) => frame.ts)).toEqual([T0 + 3 * SEC, T0 + 4 * SEC]);
  });

  it("frames without any focus/desk data commit as defined neutrals", () => {
    const ring = freshRing();
    const frame = ring.commit(T0 + SEC);
    expect(frame).toEqual({
      ts: T0 + SEC,
      focusKind: "none",
      processKey: "",
      titleHash: 0,
      deskPresence: "uncertain",
      deskConfidence: 0,
      webcamEnabled: false,
    });
  });
});

describe("TelemetryRing transitions", () => {
  it("first focus of a session is not a switch", () => {
    const ring = freshRing();
    ring.noteFocus(focus(T0 + SEC, "code.exe"));
    expect(ring.transitionCount).toBe(0);
    ring.noteFocus(focus(T0 + 2 * SEC, "chrome.exe"));
    expect(ring.transitionCount).toBe(1);
  });

  it("records proc switches with normalized keys and title churn as hashes", () => {
    const ring = freshRing();
    ring.noteFocus(focus(T0 + SEC, "Code.EXE", "a.ts"));
    ring.noteFocus(focus(T0 + 2 * SEC, "chrome.exe", "Tab One"));
    ring.noteFocus(focus(T0 + 3 * SEC, "chrome.exe", "Tab Two"));
    const proc = ring.transitionsInRange(T0, T0 + 10 * SEC, "proc");
    expect(proc).toEqual([
      {
        ts: T0 + 2 * SEC,
        kind: "proc",
        fromKey: "code.exe",
        toKey: "chrome.exe",
        toFocusKind: "allow",
      },
    ]);
    const title = ring.transitionsInRange(T0, T0 + 10 * SEC, "title");
    expect(title).toEqual([
      {
        ts: T0 + 3 * SEC,
        kind: "title",
        fromKey: String(titleHash("Tab One")),
        toKey: String(titleHash("Tab Two")),
        toFocusKind: "allow",
      },
    ]);
  });

  it("same process, same title is not churn (case-insensitive)", () => {
    const ring = freshRing();
    ring.noteFocus(focus(T0 + SEC, "chrome.exe", "Docs"));
    ring.noteFocus(focus(T0 + 2 * SEC, "chrome.exe", "docs"));
    ring.noteFocus(focus(T0 + 3 * SEC, "CHROME.exe", "docs"));
    expect(ring.transitionCount).toBe(0);
  });

  it("evicts oldest transitions beyond capacity", () => {
    const ring = freshRing();
    const total = TRANSITION_CAPACITY + 40 + 1;
    for (let i = 1; i <= total; i += 1) {
      ring.noteFocus(focus(T0 + i * 100, i % 2 === 0 ? "a.exe" : "b.exe"));
    }
    // total noteFocus calls yield total-1 transitions (first sets current).
    expect(ring.transitionCount).toBe(TRANSITION_CAPACITY);
    const all = ring.transitionsInRange(0, Number.POSITIVE_INFINITY);
    expect(all[0]?.ts).toBe(T0 + (total - TRANSITION_CAPACITY + 1) * 100);
    expect(all[all.length - 1]?.ts).toBe(T0 + total * 100);
  });
});

describe("TelemetryRing session scalars", () => {
  it("tracks block sightings, allow streaks, and dwell anchors", () => {
    const ring = freshRing();
    ring.noteFocus(focus(T0 + SEC, "code.exe"));
    expect(ring.streakStartTs).toBe(T0 + SEC);
    expect(ring.currentProcSince).toBe(T0 + SEC);
    expect(ring.lastBlockFocusTs).toBeNull();
    // Grey app breaks the streak, moves the dwell anchor.
    ring.noteFocus(focus(T0 + 5 * SEC, "spotify.exe", "playlist", false, false));
    expect(ring.streakStartTs).toBeNull();
    expect(ring.currentProcSince).toBe(T0 + 5 * SEC);
    // Block focus stamps lastBlockFocusTs.
    ring.noteFocus(focus(T0 + 8 * SEC, "discord.exe", "general", false, true));
    expect(ring.lastBlockFocusTs).toBe(T0 + 8 * SEC);
    // Back to allow restarts the streak from here.
    ring.noteFocus(focus(T0 + 9 * SEC, "code.exe"));
    expect(ring.streakStartTs).toBe(T0 + 9 * SEC);
    // Staying on the same allow window keeps the original streak start.
    ring.noteFocus(focus(T0 + 20 * SEC, "code.exe"));
    expect(ring.streakStartTs).toBe(T0 + 9 * SEC);
    expect(ring.currentProcSince).toBe(T0 + 9 * SEC);
  });

  it("counts drift onsets, not drift seconds", () => {
    const ring = freshRing();
    ring.noteStatus("ON_TASK");
    ring.noteStatus("DISTRACTED");
    ring.noteStatus("DISTRACTED");
    ring.noteStatus("AWAY"); // still the same drift — no new onset
    ring.noteStatus("ON_TASK");
    ring.noteStatus("AWAY");
    ring.noteStatus("IDLE");
    expect(ring.driftCount).toBe(2);
  });

  it("reset clears frames, transitions, pending state, and scalars", () => {
    const ring = freshRing();
    ring.noteFocus(focus(T0 + SEC, "discord.exe", "general", false, true));
    ring.noteFocus(focus(T0 + 2 * SEC, "code.exe"));
    ring.noteStatus("DISTRACTED");
    ring.noteDesk(desk(T0 + 2 * SEC), 0.6);
    ring.commit(T0 + 2 * SEC);
    ring.reset(T0 + 100 * SEC);
    expect(ring.frameCount).toBe(0);
    expect(ring.transitionCount).toBe(0);
    expect(ring.driftCount).toBe(0);
    expect(ring.lastBlockFocusTs).toBeNull();
    expect(ring.streakStartTs).toBeNull();
    expect(ring.currentProcSince).toBeNull();
    expect(ring.currentProcessKey).toBe("");
    expect(ring.sessionStartTs).toBe(T0 + 100 * SEC);
    // A fresh commit after reset carries no stale pending focus/desk state.
    expect(ring.commit(T0 + 101 * SEC)?.focusKind).toBe("none");
    // And the ring accepts timestamps that pre-date the old session's frames.
    const ring2 = freshRing();
    ring2.commit(T0 + 50 * SEC);
    ring2.reset(T0);
    expect(ring2.commit(T0 + SEC)).not.toBeNull();
  });
});
