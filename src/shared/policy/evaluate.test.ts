import { describe, expect, it } from "vitest";
import {
  classify,
  deskPresence,
  enabledFunPlugIds,
  focusKind,
  isOnTask,
  killTargetsFor,
  plugDeviceIds,
  plugEventFor,
  type PolicyEngineInput,
} from "./evaluate";
import { ALL_BLOCKLIST_TARGET, REASONS } from "./constants";
import type { DeskSnapshot, FocusSnapshot, PlugDevice } from "../types";

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

function lamp(id = "lamp"): PlugDevice {
  return {
    id,
    name: id,
    protocol: "mock",
    address: `${id}.local`,
    enabled: true,
    isStudyPc: false,
  };
}

function baseInput(patch: Partial<PolicyEngineInput> = {}): PolicyEngineInput {
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

  it("plug fields do not change classify (no desk-only violation from plugs)", () => {
    const c = classify(
      baseInput({
        focus: chrome(),
        desk: { ts: TS, label: "uncertain", confidence: 0.99, webcamEnabled: true },
        enabledPlugIds: ["lamp"],
        plugsArmed: true,
      }),
    );
    expect(c.decision).toBe("IDLE");
    expect(c.violation).toBeNull();
    expect(c.desk).toBe("uncertain");
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

describe("plugDeviceIds", () => {
  it("armed ids are copied, unique, and skip blanks", () => {
    const input = baseInput({
      enabledPlugIds: ["lamp", " lamp ", "fan", "lamp", "", "   "],
      plugsArmed: true,
    });
    const ids = plugDeviceIds(input);
    expect(ids).toEqual(["lamp", "fan"]);
    ids.push("mutated");
    expect(input.enabledPlugIds).toEqual(["lamp", " lamp ", "fan", "lamp", "", "   "]);
  });

  it("empty enabledPlugIds yields no plug ids even when armed", () => {
    expect(plugDeviceIds(baseInput({ enabledPlugIds: [], plugsArmed: true }))).toEqual([]);
  });

  it("plugsArmed false yields no plug ids even when devices exist", () => {
    expect(
      plugDeviceIds(baseInput({ enabledPlugIds: ["lamp", "fan"], plugsArmed: false })),
    ).toEqual([]);
  });

  it("omitted plugsArmed defaults to true when ids exist", () => {
    const input = baseInput({ enabledPlugIds: ["lamp"] });
    delete (input as { plugsArmed?: boolean }).plugsArmed;
    expect(plugDeviceIds(input)).toEqual(["lamp"]);
  });

  it("derives enabled ids from plugs when enabledPlugIds is omitted", () => {
    expect(
      plugDeviceIds(
        baseInput({
          plugs: [lamp("lamp"), { ...lamp("fan"), enabled: false }, lamp("tv")],
        }),
      ),
    ).toEqual(["lamp", "tv"]);
  });

  it("explicit empty enabledPlugIds wins over plugs[] (no events)", () => {
    expect(
      plugDeviceIds(baseInput({ enabledPlugIds: [], plugs: [lamp()], plugsArmed: true })),
    ).toEqual([]);
  });

  it("never includes a study-PC device, even if listed in enabledPlugIds", () => {
    const study = {
      id: "study-pc",
      name: "Tower",
      protocol: "mock" as const,
      address: "192.168.1.2",
      enabled: true,
      isStudyPc: true,
    };
    expect(
      plugDeviceIds(
        baseInput({
          enabledPlugIds: ["study-pc", "lamp"],
          plugs: [study as unknown as PlugDevice, lamp()],
          plugsArmed: true,
        }),
      ),
    ).toEqual(["lamp"]);
    expect(enabledFunPlugIds([study as unknown as PlugDevice, lamp()])).toEqual(["lamp"]);
  });

  it("frozen PolicyInput with no plug fields yields no ids", () => {
    expect(
      plugDeviceIds({
        sessionActive: true,
        focus: chrome(),
        desk: present(),
        countdownSec: 10,
        deskThreshold: 0.6,
        strictMode: true,
      }),
    ).toEqual([]);
  });
});

describe("plugEventFor", () => {
  it("returns plug_off / plug_on with the same ids when armed", () => {
    const input = baseInput({ enabledPlugIds: ["lamp", "fan"], plugsArmed: true });
    expect(plugEventFor("plug_off", input, REASONS.blockedFocus)).toEqual({
      type: "plug_off",
      deviceIds: ["lamp", "fan"],
      reason: REASONS.blockedFocus,
    });
    expect(plugEventFor("plug_on", input, REASONS.unlock)).toEqual({
      type: "plug_on",
      deviceIds: ["lamp", "fan"],
      reason: REASONS.unlock,
    });
  });

  it("returns null when ids are empty or plugs are disarmed", () => {
    expect(plugEventFor("plug_off", baseInput({ enabledPlugIds: [], plugsArmed: true }), REASONS.deskAway)).toBeNull();
    expect(
      plugEventFor("plug_on", baseInput({ enabledPlugIds: ["lamp"], plugsArmed: false }), REASONS.unlock),
    ).toBeNull();
  });

  it("returns null when the session is inactive", () => {
    expect(
      plugEventFor(
        "plug_off",
        baseInput({ sessionActive: false, enabledPlugIds: ["lamp"], plugsArmed: true }),
        REASONS.blockedFocus,
      ),
    ).toBeNull();
  });
});
