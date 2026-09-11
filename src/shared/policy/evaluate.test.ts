import { describe, expect, it } from "vitest";
import {
  classify,
  deskPresence,
  focusKind,
  isOnTask,
  killTargetsFor,
} from "./evaluate";
import { ALL_BLOCKLIST_TARGET } from "./constants";
import type { DeskSnapshot, FocusSnapshot, PolicyInput } from "../types";

const TS = 1_000_000;

function chrome(ts = TS): FocusSnapshot {
  return {
    ts,
    processName: "chrome.exe",
    windowTitle: "Google Docs",
    matchedAllow: true,
    matchedBlock: false,
  };
}

function discord(ts = TS): FocusSnapshot {
  return {
    ts,
    processName: "discord.exe",
    windowTitle: "Discord",
    matchedAllow: false,
    matchedBlock: true,
    blockEntryId: "discord",
  };
}

function dualListed(ts = TS): FocusSnapshot {
  return {
    ts,
    processName: "discord.exe",
    windowTitle: "Docs — Discord",
    matchedAllow: true,
    matchedBlock: true,
    blockEntryId: "discord",
  };
}

function present(ts = TS, confidence = 0.95): DeskSnapshot {
  return { ts, label: "at_desk", confidence, webcamEnabled: true };
}

function away(ts = TS, confidence = 0.95): DeskSnapshot {
  return { ts, label: "away", confidence, webcamEnabled: true };
}

function baseInput(patch: Partial<PolicyInput> = {}): PolicyInput {
  return {
    sessionActive: true,
    focus: chrome(),
    desk: present(),
    countdownSec: 10,
    deskThreshold: 0.6,
    strictMode: true,
    ...patch,
  };
}

describe("deskPresence", () => {
  const rows: Array<{
    name: string;
    desk: DeskSnapshot | null;
    threshold: number;
    expected: ReturnType<typeof deskPresence>;
  }> = [
    { name: "null desk is uncertain", desk: null, threshold: 0.6, expected: "uncertain" },
    {
      name: "webcam off is uncertain even if away + high conf",
      desk: { ts: TS, label: "away", confidence: 0.99, webcamEnabled: false },
      threshold: 0.6,
      expected: "uncertain",
    },
    {
      name: "label uncertain is uncertain even at high conf",
      desk: { ts: TS, label: "uncertain", confidence: 0.99, webcamEnabled: true },
      threshold: 0.6,
      expected: "uncertain",
    },
    {
      name: "away below threshold is uncertain",
      desk: away(TS, 0.59),
      threshold: 0.6,
      expected: "uncertain",
    },
    {
      name: "away at threshold is away",
      desk: away(TS, 0.6),
      threshold: 0.6,
      expected: "away",
    },
    {
      name: "at_desk at threshold is present",
      desk: present(TS, 0.6),
      threshold: 0.6,
      expected: "present",
    },
    {
      name: "at_desk below threshold is uncertain",
      desk: present(TS, 0.599),
      threshold: 0.6,
      expected: "uncertain",
    },
    {
      name: "NaN confidence is uncertain",
      desk: { ts: TS, label: "away", confidence: Number.NaN, webcamEnabled: true },
      threshold: 0.6,
      expected: "uncertain",
    },
    {
      name: "NaN threshold is uncertain",
      desk: away(),
      threshold: Number.NaN,
      expected: "uncertain",
    },
    {
      name: "high-conf away is away",
      desk: away(),
      threshold: 0.6,
      expected: "away",
    },
    {
      name: "high-conf at_desk is present",
      desk: present(),
      threshold: 0.6,
      expected: "present",
    },
  ];

  it.each(rows)("$name", (row) => {
    expect(deskPresence(row.desk, row.threshold)).toBe(row.expected);
  });
});

describe("focusKind", () => {
  it.each([
    { name: "null", focus: null, expected: "none" as const },
    { name: "allow", focus: chrome(), expected: "allow" as const },
    { name: "block", focus: discord(), expected: "block" as const },
    {
      name: "neither",
      focus: {
        ts: TS,
        processName: "explorer.exe",
        windowTitle: "Files",
        matchedAllow: false,
        matchedBlock: false,
      },
      expected: "other" as const,
    },
    { name: "dual-listed: block wins", focus: dualListed(), expected: "block" as const },
  ])("$name", (row) => {
    expect(focusKind(row.focus)).toBe(row.expected);
  });
});

describe("isOnTask / strict mode requires both", () => {
  it.each([
    {
      name: "strict + allow + present",
      focus: "allow" as const,
      desk: "present" as const,
      strict: true,
      expected: true,
    },
    {
      name: "strict + allow + away",
      focus: "allow" as const,
      desk: "away" as const,
      strict: true,
      expected: false,
    },
    {
      name: "strict + allow + uncertain",
      focus: "allow" as const,
      desk: "uncertain" as const,
      strict: true,
      expected: false,
    },
    {
      name: "strict + block + present",
      focus: "block" as const,
      desk: "present" as const,
      strict: true,
      expected: false,
    },
    {
      name: "strict + other + present",
      focus: "other" as const,
      desk: "present" as const,
      strict: true,
      expected: false,
    },
    {
      name: "non-strict + allow + away (desk not required)",
      focus: "allow" as const,
      desk: "away" as const,
      strict: false,
      expected: true,
    },
    {
      name: "non-strict + allow + uncertain",
      focus: "allow" as const,
      desk: "uncertain" as const,
      strict: false,
      expected: true,
    },
    {
      name: "non-strict + block + present",
      focus: "block" as const,
      desk: "present" as const,
      strict: false,
      expected: false,
    },
    {
      name: "non-strict + none + present",
      focus: "none" as const,
      desk: "present" as const,
      strict: false,
      expected: false,
    },
  ])("$name", (row) => {
    expect(isOnTask(row.focus, row.desk, row.strict)).toBe(row.expected);
  });
});

describe("classify", () => {
  it("ON_TASK when strict, allowlisted, and at desk", () => {
    const c = classify(baseInput());
    expect(c.decision).toBe("ON_TASK");
    expect(c.violation).toBeNull();
    expect(c.onTask).toBe(true);
  });

  it("DISTRACTED with blocked violation when Discord is focused", () => {
    const c = classify(baseInput({ focus: discord() }));
    expect(c.decision).toBe("DISTRACTED");
    expect(c.violation).toBe("blocked");
    expect(c.onTask).toBe(false);
  });

  it("AWAY with desk-away violation when high-conf away and not on task", () => {
    const c = classify(baseInput({ focus: chrome(), desk: away() }));
    expect(c.decision).toBe("AWAY");
    expect(c.violation).toBe("away");
  });

  it("does not treat uncertain desk as a desk-away violation", () => {
    const c = classify(
      baseInput({
        focus: chrome(),
        desk: { ts: TS, label: "uncertain", confidence: 0.99, webcamEnabled: true },
      }),
    );
    expect(c.decision).toBe("IDLE");
    expect(c.violation).toBeNull();
    expect(c.desk).toBe("uncertain");
  });

  it("non-strict allow + away is ON_TASK (no desk-only violation)", () => {
    const c = classify(baseInput({ strictMode: false, focus: chrome(), desk: away() }));
    expect(c.decision).toBe("ON_TASK");
    expect(c.violation).toBeNull();
  });
});

describe("killTargetsFor", () => {
  it("names the blocked process and never the study window", () => {
    expect(killTargetsFor(baseInput({ focus: discord(), desk: present() }), "present")).toEqual([
      "discord.exe",
    ]);
  });

  it("desk-away with Chrome focused yields only the all-blocklist sentinel", () => {
    expect(killTargetsFor(baseInput({ focus: chrome(), desk: away() }), "away")).toEqual([
      ALL_BLOCKLIST_TARGET,
    ]);
    expect(killTargetsFor(baseInput({ focus: chrome(), desk: away() }), "away")).not.toContain(
      "chrome.exe",
    );
  });

  it("blocked + away includes process and all-blocklist sentinel", () => {
    expect(killTargetsFor(baseInput({ focus: discord(), desk: away() }), "away")).toEqual([
      "discord.exe",
      ALL_BLOCKLIST_TARGET,
    ]);
  });

  it("skips empty blocked process names", () => {
    expect(
      killTargetsFor(
        baseInput({
          focus: {
            ts: TS,
            processName: "   ",
            windowTitle: "Discord",
            matchedAllow: false,
            matchedBlock: true,
          },
          desk: present(),
        }),
        "present",
      ),
    ).toEqual([]);
  });
});
