import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_BLOCKLIST_TARGET, REASONS, SESSION_OFF_DETAIL } from "./constants";
import { INITIAL_POLICY_STATE, PolicyEngine, stepPolicy } from "./engine";
import type { PolicyState } from "./engine";
import type { Decision, DeskSnapshot, FocusSnapshot, PolicyEvent, PolicyInput } from "../types";

const T0 = 1_000_000;
const SEC = 1000;

const STUDY_PROCESS_NAMES = [
  "chrome.exe",
  "msedge.exe",
  "firefox.exe",
  "Code",
  "code.exe",
  "notion.exe",
  "WINWORD",
  "WINWORD.EXE",
];

function chrome(ts: number, processName = "chrome.exe"): FocusSnapshot {
  return {
    ts,
    processName,
    windowTitle: "Google Docs",
    matchedAllow: true,
    matchedBlock: false,
  };
}

function discord(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "discord.exe",
    windowTitle: "Discord",
    matchedAllow: false,
    matchedBlock: true,
    blockEntryId: "discord",
  };
}

function explorer(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "explorer.exe",
    windowTitle: "File Explorer",
    matchedAllow: false,
    matchedBlock: false,
  };
}

function dualListed(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "discord.exe",
    windowTitle: "Docs — Discord overlay",
    matchedAllow: true,
    matchedBlock: true,
    blockEntryId: "discord",
  };
}

function present(ts: number, confidence = 0.95): DeskSnapshot {
  return { ts, label: "at_desk", confidence, webcamEnabled: true };
}

function away(ts: number, confidence = 0.95): DeskSnapshot {
  return { ts, label: "away", confidence, webcamEnabled: true };
}

function uncertainDesk(ts: number, confidence = 0.99): DeskSnapshot {
  return { ts, label: "uncertain", confidence, webcamEnabled: true };
}

interface StepSpec {
  sessionActive?: boolean;
  ts: number;
  focus: FocusSnapshot | null;
  desk: DeskSnapshot | null;
  enabledPlugIds?: string[];
  plugsArmed?: boolean;
  expect: {
    decision: Decision;
    events?: PolicyEvent["type"][];
    includes?: PolicyEvent["type"][];
    excludes?: PolicyEvent["type"][];
    killTargets?: string[];
    startReason?: string;
    startSeconds?: number;
    killReason?: string;
    plugOffIds?: string[];
    plugOnIds?: string[];
    plugOffReason?: string;
    plugOnReason?: string;
    detailIncludes?: string;
  };
}

interface SeqCase {
  name: string;
  strictMode?: boolean;
  countdownSec?: number;
  deskThreshold?: number;
  enabledPlugIds?: string[];
  plugsArmed?: boolean;
  steps: StepSpec[];
}

function makeInput(
  step: StepSpec,
  defaults: {
    strictMode: boolean;
    countdownSec: number;
    deskThreshold: number;
    enabledPlugIds: string[];
    plugsArmed: boolean;
  },
): PolicyInput {
  return {
    sessionActive: step.sessionActive ?? true,
    focus: step.focus,
    desk: step.desk,
    countdownSec: defaults.countdownSec,
    deskThreshold: defaults.deskThreshold,
    strictMode: defaults.strictMode,
    enabledPlugIds: step.enabledPlugIds ?? defaults.enabledPlugIds,
    plugsArmed: step.plugsArmed ?? defaults.plugsArmed,
  };
}

function typesOf(events: PolicyEvent[]): PolicyEvent["type"][] {
  return events.map((event) => event.type);
}

function ofType<T extends PolicyEvent["type"]>(
  events: PolicyEvent[],
  type: T,
): Extract<PolicyEvent, { type: T }>[] {
  return events.filter((event): event is Extract<PolicyEvent, { type: T }> => event.type === type);
}

function assertStep(caseName: string, index: number, events: PolicyEvent[], spec: StepSpec["expect"]): void {
  const label = `${caseName} [${index}]`;
  const statuses = ofType(events, "status");
  expect(statuses, `${label} must emit exactly one status`).toHaveLength(1);
  const status = statuses[0];
  if (!status) {
    throw new Error(`${label} missing status`);
  }
  expect(status.decision, `${label} decision`).toBe(spec.decision);

  if (spec.events) {
    expect(typesOf(events), `${label} event order`).toEqual(spec.events);
  }
  for (const type of spec.includes ?? []) {
    expect(typesOf(events), `${label} includes ${type}`).toContain(type);
  }
  for (const type of spec.excludes ?? []) {
    expect(typesOf(events), `${label} excludes ${type}`).not.toContain(type);
  }

  const kills = ofType(events, "kill");
  if (spec.killTargets) {
    expect(kills, `${label} kill count`).toHaveLength(1);
    const kill = kills[0];
    if (!kill) {
      throw new Error(`${label} missing kill`);
    }
    expect(kill.targets, `${label} kill targets`).toEqual(spec.killTargets);
  }
  if (spec.killReason !== undefined) {
    expect(kills[0]?.reason, `${label} kill reason`).toBe(spec.killReason);
  }
  if (spec.startReason !== undefined || spec.startSeconds !== undefined) {
    const starts = ofType(events, "start_countdown");
    expect(starts, `${label} start_countdown count`).toHaveLength(1);
    const start = starts[0];
    if (!start) {
      throw new Error(`${label} missing start_countdown`);
    }
    if (spec.startReason !== undefined) {
      expect(start.reason).toBe(spec.startReason);
    }
    if (spec.startSeconds !== undefined) {
      expect(start.seconds).toBe(spec.startSeconds);
    }
  }
  if (spec.detailIncludes) {
    expect(status.detail).toContain(spec.detailIncludes);
  }

  const plugOffs = ofType(events, "plug_off");
  const plugOns = ofType(events, "plug_on");
  if (plugOffs.length > 0) {
    expect(kills.length, `${label} plug_off must accompany kill`).toBeGreaterThan(0);
  }
  if (plugOns.length > 0) {
    expect(ofType(events, "unlock").length, `${label} plug_on must accompany unlock`).toBeGreaterThan(0);
  }
  if (spec.plugOffIds) {
    expect(plugOffs, `${label} plug_off count`).toHaveLength(1);
    expect(plugOffs[0]?.deviceIds, `${label} plug_off ids`).toEqual(spec.plugOffIds);
  }
  if (spec.plugOnIds) {
    expect(plugOns, `${label} plug_on count`).toHaveLength(1);
    expect(plugOns[0]?.deviceIds, `${label} plug_on ids`).toEqual(spec.plugOnIds);
  }
  if (spec.plugOffReason !== undefined) {
    expect(plugOffs[0]?.reason, `${label} plug_off reason`).toBe(spec.plugOffReason);
  }
  if (spec.plugOnReason !== undefined) {
    expect(plugOns[0]?.reason, `${label} plug_on reason`).toBe(spec.plugOnReason);
  }

  for (const kill of kills) {
    for (const study of STUDY_PROCESS_NAMES) {
      expect(kill.targets, `${label} must never kill study process ${study}`).not.toContain(study);
    }
  }
}

function runCase(seq: SeqCase): PolicyEvent[][] {
  const engine = new PolicyEngine();
  const defaults = {
    strictMode: seq.strictMode ?? true,
    countdownSec: seq.countdownSec ?? 10,
    deskThreshold: seq.deskThreshold ?? 0.6,
    enabledPlugIds: seq.enabledPlugIds ?? [],
    plugsArmed: seq.plugsArmed ?? true,
  };
  const all: PolicyEvent[][] = [];
  seq.steps.forEach((step, index) => {
    const events = engine.step(makeInput(step, defaults));
    assertStep(seq.name, index, events, step.expect);
    all.push(events);
  });
  return all;
}

describe("gauntlet: OFF no kill", () => {
  const cases: SeqCase[] = [
    {
      name: "session OFF + blocked focus never starts countdown or kills",
      steps: [
        {
          sessionActive: false,
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: {
            decision: "IDLE",
            events: ["status"],
            excludes: ["kill", "start_countdown", "unlock", "cancel_countdown"],
            detailIncludes: SESSION_OFF_DETAIL,
          },
        },
      ],
    },
    {
      name: "session OFF + high-conf desk away never kills",
      steps: [
        {
          sessionActive: false,
          ts: T0,
          focus: chrome(T0),
          desk: away(T0),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "session OFF + blocked + away + elapsed timestamps still does not kill",
      steps: [
        {
          sessionActive: false,
          ts: T0 + 60 * SEC,
          focus: discord(T0 + 60 * SEC),
          desk: away(T0 + 60 * SEC),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "session ON countdown then OFF at the exact kill instant cancels and does not kill",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: {
            decision: "DISTRACTED",
            events: ["start_countdown", "status"],
            startReason: REASONS.blockedFocus,
            startSeconds: 10,
          },
        },
        {
          sessionActive: false,
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            events: ["cancel_countdown", "status"],
            excludes: ["kill", "unlock"],
          },
        },
      ],
    },
    {
      name: "session OFF then ON after the original deadline starts a fresh countdown (no leftover kill)",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          sessionActive: false,
          ts: T0 + 5 * SEC,
          focus: discord(T0 + 5 * SEC),
          desk: present(T0 + 5 * SEC),
          expect: {
            decision: "IDLE",
            includes: ["cancel_countdown"],
            excludes: ["kill"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            includes: ["start_countdown"],
            excludes: ["kill"],
            startSeconds: 10,
          },
        },
        {
          ts: T0 + 20 * SEC,
          focus: discord(T0 + 20 * SEC),
          desk: present(T0 + 20 * SEC),
          expect: {
            decision: "DISTRACTED",
            includes: ["kill"],
            killTargets: ["discord.exe"],
          },
        },
      ],
    },
    {
      name: "session OFF after lock does not emit kill or unlock",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["kill", "status"],
            killTargets: ["discord.exe"],
          },
        },
        {
          sessionActive: false,
          ts: T0 + 11 * SEC,
          focus: discord(T0 + 11 * SEC),
          desk: present(T0 + 11 * SEC),
          expect: {
            decision: "IDLE",
            events: ["status"],
            excludes: ["kill", "unlock", "cancel_countdown"],
          },
        },
      ],
    },
  ];

  it.each(cases)("$name", (seq) => {
    runCase(seq);
  });
});

describe("gauntlet: blocked→countdown→kill", () => {
  const cases: SeqCase[] = [
    {
      name: "Discord at desk: start at t0, hold at t0+9.999s, kill at t0+10s",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: {
            decision: "DISTRACTED",
            events: ["start_countdown", "status"],
            startReason: REASONS.blockedFocus,
            startSeconds: 10,
            excludes: ["kill"],
            detailIncludes: "discord.exe",
          },
        },
        {
          ts: T0 + 9999,
          focus: discord(T0 + 9999),
          desk: present(T0 + 9999),
          expect: {
            decision: "DISTRACTED",
            events: ["status"],
            excludes: ["kill", "start_countdown", "cancel_countdown"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["kill", "status"],
            killTargets: ["discord.exe"],
            killReason: REASONS.blockedFocus,
            excludes: ["start_countdown"],
          },
        },
      ],
    },
    {
      name: "countdownSec 0 kills on the first blocked step (start + kill)",
      countdownSec: 0,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: {
            decision: "DISTRACTED",
            events: ["start_countdown", "kill", "status"],
            startSeconds: 0,
            killTargets: ["discord.exe"],
          },
        },
      ],
    },
    {
      name: "dual-listed window (allow+block) is blocked and kill uses process name",
      steps: [
        {
          ts: T0,
          focus: dualListed(T0),
          desk: present(T0),
          expect: {
            decision: "DISTRACTED",
            includes: ["start_countdown"],
            excludes: ["kill"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: dualListed(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            killTargets: ["discord.exe"],
            includes: ["kill"],
          },
        },
      ],
    },
    {
      name: "after kill, staying on Discord does not start a new countdown or re-kill",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: { decision: "DISTRACTED", includes: ["kill"] },
        },
        {
          ts: T0 + 20 * SEC,
          focus: discord(T0 + 20 * SEC),
          desk: present(T0 + 20 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["status"],
            excludes: ["kill", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "leaving Discord for Explorer during countdown does not cancel; kill uses latched targets",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 5 * SEC,
          focus: explorer(T0 + 5 * SEC),
          desk: present(T0 + 5 * SEC),
          expect: {
            decision: "IDLE",
            events: ["status"],
            excludes: ["cancel_countdown", "kill", "start_countdown"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            events: ["kill", "status"],
            killTargets: ["discord.exe"],
          },
        },
      ],
    },
  ];

  it.each(cases)("$name", (seq) => {
    runCase(seq);
  });
});

describe("gauntlet: return cancels", () => {
  const cases: SeqCase[] = [
    {
      name: "return to Docs + at desk before elapsed cancels countdown and does not kill",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 5 * SEC,
          focus: chrome(T0 + 5 * SEC),
          desk: present(T0 + 5 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["cancel_countdown", "unlock", "status"],
            excludes: ["kill"],
          },
        },
      ],
    },
    {
      name: "return 1ms before kill boundary still cancels",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 9999,
          focus: chrome(T0 + 9999),
          desk: present(T0 + 9999),
          expect: {
            decision: "ON_TASK",
            includes: ["cancel_countdown"],
            excludes: ["kill"],
          },
        },
      ],
    },
    {
      name: "return to Docs + desk at the exact kill instant cancels (on-task wins over elapsed)",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["cancel_countdown", "unlock", "status"],
            excludes: ["kill"],
          },
        },
      ],
    },
    {
      name: "after kill, return to Docs + desk unlocks (no cancel — countdown already consumed)",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: { decision: "DISTRACTED", includes: ["kill"] },
        },
        {
          ts: T0 + 12 * SEC,
          focus: chrome(T0 + 12 * SEC),
          desk: present(T0 + 12 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["unlock", "status"],
            excludes: ["kill", "cancel_countdown", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "cancel then a new distraction starts a fresh 10s countdown (old timer discarded)",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 9 * SEC,
          focus: chrome(T0 + 9 * SEC),
          desk: present(T0 + 9 * SEC),
          expect: { decision: "ON_TASK", includes: ["cancel_countdown"], excludes: ["kill"] },
        },
        {
          ts: T0 + 9 * SEC + 100,
          focus: discord(T0 + 9 * SEC + 100),
          desk: present(T0 + 9 * SEC + 100),
          expect: {
            decision: "DISTRACTED",
            includes: ["start_countdown"],
            excludes: ["kill"],
            startSeconds: 10,
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            excludes: ["kill"],
            events: ["status"],
          },
        },
        {
          ts: T0 + 9 * SEC + 100 + 10 * SEC,
          focus: discord(T0 + 9 * SEC + 100 + 10 * SEC),
          desk: present(T0 + 9 * SEC + 100 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            includes: ["kill"],
            killTargets: ["discord.exe"],
          },
        },
      ],
    },
    {
      name: "strict mode: returning to Chrome while still away does NOT cancel",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 5 * SEC,
          focus: chrome(T0 + 5 * SEC),
          desk: away(T0 + 5 * SEC),
          expect: {
            decision: "AWAY",
            events: ["status"],
            excludes: ["cancel_countdown", "unlock", "kill"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC),
          expect: {
            decision: "AWAY",
            includes: ["kill"],
            killTargets: ["discord.exe", ALL_BLOCKLIST_TARGET],
          },
        },
      ],
    },
    {
      name: "non-strict: returning to Chrome while away DOES cancel (allowlist is enough)",
      strictMode: false,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 5 * SEC,
          focus: chrome(T0 + 5 * SEC),
          desk: away(T0 + 5 * SEC),
          expect: {
            decision: "ON_TASK",
            includes: ["cancel_countdown", "unlock"],
            excludes: ["kill"],
          },
        },
      ],
    },
    {
      name: "already on task emits only status (no spurious unlock/cancel)",
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: present(T0),
          expect: {
            decision: "ON_TASK",
            events: ["status"],
            excludes: ["unlock", "cancel_countdown", "kill", "start_countdown"],
          },
        },
        {
          ts: T0 + SEC,
          focus: chrome(T0 + SEC),
          desk: present(T0 + SEC),
          expect: {
            decision: "ON_TASK",
            events: ["status"],
            excludes: ["unlock", "cancel_countdown"],
          },
        },
      ],
    },
  ];

  it.each(cases)("$name", (seq) => {
    runCase(seq);
  });
});

describe("gauntlet: uncertain no desk-only kill", () => {
  const cases: SeqCase[] = [
    {
      name: "allowlist + uncertain desk: no countdown, no kill (strict, not on-task)",
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: uncertainDesk(T0),
          expect: {
            decision: "IDLE",
            events: ["status"],
            excludes: ["kill", "start_countdown"],
          },
        },
        {
          ts: T0 + 30 * SEC,
          focus: chrome(T0 + 30 * SEC),
          desk: uncertainDesk(T0 + 30 * SEC),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "allowlist + away below confidence threshold: treated as uncertain, no desk-only kill",
      deskThreshold: 0.6,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: away(T0, 0.59),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "start_countdown"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC, 0.59),
          expect: { decision: "IDLE", excludes: ["kill", "start_countdown"] },
        },
      ],
    },
    {
      name: "allowlist + webcam disabled + away high-conf: no desk-only kill",
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: { ts: T0, label: "away", confidence: 0.99, webcamEnabled: false },
          expect: { decision: "IDLE", excludes: ["kill", "start_countdown"] },
        },
      ],
    },
    {
      name: "allowlist + webcam disabled + at_desk high-conf: uncertain, not on-task, no kill",
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: { ts: T0, label: "at_desk", confidence: 0.99, webcamEnabled: false },
          expect: { decision: "IDLE", excludes: ["kill", "start_countdown"] },
        },
      ],
    },
    {
      name: "desk-away countdown then uncertain BEFORE fire: cancel, never desk-only kill",
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: away(T0),
          expect: {
            decision: "AWAY",
            includes: ["start_countdown"],
            startReason: REASONS.deskAway,
          },
        },
        {
          ts: T0 + 5 * SEC,
          focus: chrome(T0 + 5 * SEC),
          desk: uncertainDesk(T0 + 5 * SEC),
          expect: {
            decision: "IDLE",
            events: ["cancel_countdown", "status"],
            excludes: ["kill", "unlock"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: uncertainDesk(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "desk-away countdown then uncertain at the exact kill instant: cancel, no kill",
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: uncertainDesk(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            events: ["cancel_countdown", "status"],
            excludes: ["kill"],
          },
        },
      ],
    },
    {
      name: "desk-away then low-conf away (below threshold) at fire time: cancel, no kill",
      deskThreshold: 0.6,
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0, 0.95),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC, 0.59),
          expect: {
            decision: "IDLE",
            includes: ["cancel_countdown"],
            excludes: ["kill"],
          },
        },
      ],
    },
    {
      name: "desk-away then webcam off at fire time: cancel, no desk-only kill",
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: {
            ts: T0 + 10 * SEC,
            label: "away",
            confidence: 0.99,
            webcamEnabled: false,
          },
          expect: {
            decision: "IDLE",
            includes: ["cancel_countdown"],
            excludes: ["kill"],
          },
        },
      ],
    },
    {
      name: "allowlist + null desk: no desk-only kill",
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: null,
          expect: { decision: "IDLE", excludes: ["kill", "start_countdown"] },
        },
      ],
    },
    {
      name: "null focus + uncertain desk: idle, no kill",
      steps: [
        {
          ts: T0,
          focus: null,
          desk: uncertainDesk(T0),
          expect: { decision: "IDLE", excludes: ["kill", "start_countdown"] },
        },
      ],
    },
    {
      name: "blocked + uncertain desk STILL countdowns (block path, not desk-only)",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: uncertainDesk(T0),
          expect: {
            decision: "DISTRACTED",
            includes: ["start_countdown"],
            startReason: REASONS.blockedFocus,
            excludes: ["kill"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: uncertainDesk(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            includes: ["kill"],
            killTargets: ["discord.exe"],
          },
        },
      ],
    },
    {
      name: "unlisted window + uncertain desk: no kill",
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: uncertainDesk(T0),
          expect: { decision: "IDLE", excludes: ["kill", "start_countdown"] },
        },
      ],
    },
  ];

  it.each(cases)("$name", (seq) => {
    runCase(seq);
  });
});

describe("gauntlet: strict mode requires both", () => {
  const cases: SeqCase[] = [
    {
      name: "strict: Chrome + at_desk → ON_TASK",
      strictMode: true,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: present(T0),
          expect: { decision: "ON_TASK", excludes: ["start_countdown", "kill"] },
        },
      ],
    },
    {
      name: "strict: Chrome + high-conf away → AWAY countdown (allowlist alone is not enough)",
      strictMode: true,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: away(T0),
          expect: {
            decision: "AWAY",
            events: ["start_countdown", "status"],
            startReason: REASONS.deskAway,
            excludes: ["kill"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC),
          expect: {
            decision: "AWAY",
            includes: ["kill"],
            killTargets: [ALL_BLOCKLIST_TARGET],
            killReason: REASONS.deskAway,
          },
        },
      ],
    },
    {
      name: "strict: at_desk but Explorer (not allowlist) is NOT on-task and does not desk-kill",
      strictMode: true,
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: present(T0),
          expect: { decision: "IDLE", excludes: ["start_countdown", "kill"] },
        },
      ],
    },
    {
      name: "strict: Discord + at_desk is DISTRACTED even though present",
      strictMode: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
      ],
    },
    {
      name: "non-strict: Chrome + away is ON_TASK (desk not required) — no desk-only kill",
      strictMode: false,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: away(T0),
          expect: {
            decision: "ON_TASK",
            events: ["status"],
            excludes: ["start_countdown", "kill"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC),
          expect: { decision: "ON_TASK", excludes: ["kill", "start_countdown"] },
        },
      ],
    },
    {
      name: "non-strict: Chrome + uncertain is ON_TASK",
      strictMode: false,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: uncertainDesk(T0),
          expect: { decision: "ON_TASK", excludes: ["start_countdown", "kill"] },
        },
      ],
    },
    {
      name: "non-strict: Explorer + high-conf away still desk-kills (not on allowlist)",
      strictMode: false,
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC),
          expect: {
            decision: "AWAY",
            killTargets: [ALL_BLOCKLIST_TARGET],
            includes: ["kill"],
          },
        },
      ],
    },
  ];

  it.each(cases)("$name", (seq) => {
    runCase(seq);
  });
});

describe("golden path Docs→Discord→countdown→kill→return→unlock", () => {
  it("matches the MVP 90s demo sequence", () => {
    runCase({
      name: "golden path",
      strictMode: true,
      countdownSec: 10,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: present(T0),
          expect: { decision: "ON_TASK", events: ["status"] },
        },
        {
          ts: T0 + 2 * SEC,
          focus: discord(T0 + 2 * SEC),
          desk: present(T0 + 2 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["start_countdown", "status"],
            startSeconds: 10,
            startReason: REASONS.blockedFocus,
          },
        },
        {
          ts: T0 + 12 * SEC,
          focus: discord(T0 + 12 * SEC),
          desk: present(T0 + 12 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["kill", "status"],
            killTargets: ["discord.exe"],
          },
        },
        {
          ts: T0 + 14 * SEC,
          focus: chrome(T0 + 14 * SEC),
          desk: present(T0 + 14 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["unlock", "status"],
            excludes: ["kill"],
          },
        },
      ],
    });
  });
});

describe("desk-away countdown and kill safety", () => {
  const cases: SeqCase[] = [
    {
      name: "high-conf away with no focus: countdown then kill all-blocklist, never a study name",
      steps: [
        {
          ts: T0,
          focus: null,
          desk: away(T0),
          expect: {
            decision: "AWAY",
            includes: ["start_countdown"],
            startReason: REASONS.deskAway,
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: null,
          desk: away(T0 + 10 * SEC),
          expect: {
            decision: "AWAY",
            killTargets: [ALL_BLOCKLIST_TARGET],
            includes: ["kill"],
          },
        },
      ],
    },
    {
      name: "desk-away kill then Chrome + at_desk unlocks",
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC),
          expect: {
            decision: "AWAY",
            includes: ["kill"],
            killTargets: [ALL_BLOCKLIST_TARGET],
          },
        },
        {
          ts: T0 + 12 * SEC,
          focus: chrome(T0 + 12 * SEC),
          desk: present(T0 + 12 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["unlock", "status"],
            excludes: ["kill", "cancel_countdown"],
          },
        },
      ],
    },
    {
      name: "desk-away then sit down on Explorer (at desk, not allowlist): cancel desk-only, no kill",
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            events: ["cancel_countdown", "status"],
            excludes: ["kill"],
          },
        },
      ],
    },
    {
      name: "desk-away then Discord escalates; Explorer after that still kills (blocked latch)",
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 3 * SEC,
          focus: discord(T0 + 3 * SEC),
          desk: away(T0 + 3 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["status"],
            excludes: ["start_countdown", "kill"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            includes: ["kill"],
            killTargets: [ALL_BLOCKLIST_TARGET, "discord.exe"],
          },
        },
      ],
    },
    {
      name: "desk-away kill never lists chrome.exe even when Chrome is focused",
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC),
          expect: {
            decision: "AWAY",
            killTargets: [ALL_BLOCKLIST_TARGET],
            includes: ["kill"],
          },
        },
      ],
    },
    {
      name: "away confidence exactly at threshold counts as away",
      deskThreshold: 0.6,
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0, 0.6),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
      ],
    },
    {
      name: "blocked then physically away merges all-blocklist into latched kill targets",
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 4 * SEC,
          focus: discord(T0 + 4 * SEC),
          desk: away(T0 + 4 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["status"],
            excludes: ["start_countdown", "kill"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            killTargets: ["discord.exe", ALL_BLOCKLIST_TARGET],
            includes: ["kill"],
          },
        },
      ],
    },
  ];

  it.each(cases)("$name", (seq) => {
    runCase(seq);
  });
});

describe("gauntlet: plug_off / plug_on", () => {
  const PLUGS = ["lamp", "fan"];

  const cases: SeqCase[] = [
    {
      name: "blocked kill emits plug_off with enabled ids when armed",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: {
            decision: "DISTRACTED",
            events: ["start_countdown", "status"],
            excludes: ["kill", "plug_off", "plug_on"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["kill", "plug_off", "status"],
            killTargets: ["discord.exe"],
            killReason: REASONS.blockedFocus,
            plugOffIds: PLUGS,
            plugOffReason: REASONS.blockedFocus,
            excludes: ["plug_on"],
          },
        },
      ],
    },
    {
      name: "unlock after kill emits plug_on with the same ids",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            includes: ["kill", "plug_off"],
            plugOffIds: PLUGS,
          },
        },
        {
          ts: T0 + 12 * SEC,
          focus: chrome(T0 + 12 * SEC),
          desk: present(T0 + 12 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["unlock", "plug_on", "status"],
            plugOnIds: PLUGS,
            plugOnReason: REASONS.unlock,
            excludes: ["kill", "plug_off", "cancel_countdown"],
          },
        },
      ],
    },
    {
      name: "empty enabledPlugIds: kill and unlock without plug events",
      enabledPlugIds: [],
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["kill", "status"],
            excludes: ["plug_off", "plug_on"],
          },
        },
        {
          ts: T0 + 12 * SEC,
          focus: chrome(T0 + 12 * SEC),
          desk: present(T0 + 12 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["unlock", "status"],
            excludes: ["plug_off", "plug_on"],
          },
        },
      ],
    },
    {
      name: "plugsArmed false: kill and unlock without plug events even with ids",
      enabledPlugIds: PLUGS,
      plugsArmed: false,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["kill", "status"],
            killTargets: ["discord.exe"],
            excludes: ["plug_off", "plug_on"],
          },
        },
        {
          ts: T0 + 12 * SEC,
          focus: chrome(T0 + 12 * SEC),
          desk: present(T0 + 12 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["unlock", "status"],
            excludes: ["plug_off", "plug_on"],
          },
        },
      ],
    },
    {
      name: "uncertain desk with armed plugs: no desk-only kill and no desk-only plug_off",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: uncertainDesk(T0),
          expect: {
            decision: "IDLE",
            events: ["status"],
            excludes: ["kill", "start_countdown", "plug_off", "plug_on"],
          },
        },
        {
          ts: T0 + 30 * SEC,
          focus: chrome(T0 + 30 * SEC),
          desk: uncertainDesk(T0 + 30 * SEC),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "start_countdown", "plug_off", "plug_on"],
          },
        },
      ],
    },
    {
      name: "desk-away countdown then uncertain: cancel, no kill, no plug_off",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: away(T0),
          expect: {
            decision: "AWAY",
            includes: ["start_countdown"],
            excludes: ["plug_off", "plug_on"],
          },
        },
        {
          ts: T0 + 5 * SEC,
          focus: chrome(T0 + 5 * SEC),
          desk: uncertainDesk(T0 + 5 * SEC),
          expect: {
            decision: "IDLE",
            events: ["cancel_countdown", "status"],
            excludes: ["kill", "unlock", "plug_off", "plug_on"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: uncertainDesk(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "plug_off", "plug_on", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "desk-away kill emits plug_off; return unlocks with plug_on",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"], excludes: ["plug_off"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC),
          expect: {
            decision: "AWAY",
            events: ["kill", "plug_off", "status"],
            killTargets: [ALL_BLOCKLIST_TARGET],
            killReason: REASONS.deskAway,
            plugOffIds: PLUGS,
            plugOffReason: REASONS.deskAway,
          },
        },
        {
          ts: T0 + 12 * SEC,
          focus: chrome(T0 + 12 * SEC),
          desk: present(T0 + 12 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["unlock", "plug_on", "status"],
            plugOnIds: PLUGS,
            excludes: ["plug_off"],
          },
        },
      ],
    },
    {
      name: "cancel_countdown on return-before-kill does not plug_off; unlock still plug_on",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 5 * SEC,
          focus: chrome(T0 + 5 * SEC),
          desk: present(T0 + 5 * SEC),
          expect: {
            decision: "ON_TASK",
            events: ["cancel_countdown", "unlock", "plug_on", "status"],
            plugOnIds: PLUGS,
            excludes: ["kill", "plug_off"],
          },
        },
      ],
    },
    {
      name: "session inactive never emits plug events even when armed with ids",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          sessionActive: false,
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: {
            decision: "IDLE",
            events: ["status"],
            excludes: ["kill", "plug_off", "plug_on", "start_countdown", "unlock"],
          },
        },
        {
          sessionActive: false,
          ts: T0,
          focus: chrome(T0),
          desk: away(T0),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "plug_off", "plug_on", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "session OFF at the kill instant cancels and does not plug_off",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          sessionActive: false,
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            events: ["cancel_countdown", "status"],
            excludes: ["kill", "unlock", "plug_off", "plug_on"],
          },
        },
      ],
    },
    {
      name: "session OFF after lock does not emit plug_on (no unlock)",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            includes: ["kill", "plug_off"],
            plugOffIds: PLUGS,
          },
        },
        {
          sessionActive: false,
          ts: T0 + 11 * SEC,
          focus: discord(T0 + 11 * SEC),
          desk: present(T0 + 11 * SEC),
          expect: {
            decision: "IDLE",
            events: ["status"],
            excludes: ["kill", "unlock", "plug_off", "plug_on", "cancel_countdown"],
          },
        },
      ],
    },
    {
      name: "countdownSec 0: start + kill + plug_off together",
      countdownSec: 0,
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: {
            decision: "DISTRACTED",
            events: ["start_countdown", "kill", "plug_off", "status"],
            plugOffIds: PLUGS,
            plugOffReason: REASONS.blockedFocus,
          },
        },
      ],
    },
    {
      name: "after kill+plug_off, staying distracted does not re-emit plug_off",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: present(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: { decision: "DISTRACTED", includes: ["kill", "plug_off"] },
        },
        {
          ts: T0 + 20 * SEC,
          focus: discord(T0 + 20 * SEC),
          desk: present(T0 + 20 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["status"],
            excludes: ["kill", "plug_off", "plug_on", "start_countdown"],
          },
        },
      ],
    },
    {
      name: "already on task with armed plugs emits only status",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: present(T0),
          expect: {
            decision: "ON_TASK",
            events: ["status"],
            excludes: ["unlock", "plug_on", "plug_off", "kill"],
          },
        },
      ],
    },
    {
      name: "low-conf away with armed plugs: no desk-only kill or plug_off",
      deskThreshold: 0.6,
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: away(T0, 0.59),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "start_countdown", "plug_off", "plug_on"],
          },
        },
        {
          ts: T0 + 10 * SEC,
          focus: chrome(T0 + 10 * SEC),
          desk: away(T0 + 10 * SEC, 0.59),
          expect: {
            decision: "IDLE",
            excludes: ["kill", "plug_off", "plug_on"],
          },
        },
      ],
    },
    {
      name: "webcam-off away with armed plugs: no desk-only kill or plug_off",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: chrome(T0),
          desk: { ts: T0, label: "away", confidence: 0.99, webcamEnabled: false },
          expect: {
            decision: "IDLE",
            excludes: ["kill", "start_countdown", "plug_off", "plug_on"],
          },
        },
      ],
    },
    {
      name: "blocked + uncertain desk still kills and plug_off (block path, not desk-only)",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: discord(T0),
          desk: uncertainDesk(T0),
          expect: { decision: "DISTRACTED", includes: ["start_countdown"], excludes: ["plug_off"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: discord(T0 + 10 * SEC),
          desk: uncertainDesk(T0 + 10 * SEC),
          expect: {
            decision: "DISTRACTED",
            events: ["kill", "plug_off", "status"],
            killTargets: ["discord.exe"],
            plugOffIds: PLUGS,
          },
        },
      ],
    },
    {
      name: "desk-away then sit on Explorer: cancel, no kill, no plug_off",
      enabledPlugIds: PLUGS,
      plugsArmed: true,
      steps: [
        {
          ts: T0,
          focus: explorer(T0),
          desk: away(T0),
          expect: { decision: "AWAY", includes: ["start_countdown"] },
        },
        {
          ts: T0 + 10 * SEC,
          focus: explorer(T0 + 10 * SEC),
          desk: present(T0 + 10 * SEC),
          expect: {
            decision: "IDLE",
            events: ["cancel_countdown", "status"],
            excludes: ["kill", "plug_off", "plug_on", "unlock"],
          },
        },
      ],
    },
  ];

  it.each(cases)("$name", (seq) => {
    runCase(seq);
  });
});

describe("clock, purity, and isolation", () => {
  it("uses max(focus.ts, desk.ts) and will not let time run backwards", () => {
    const engine = new PolicyEngine();
    engine.step({
      sessionActive: true,
      focus: discord(T0),
      desk: present(T0),
      countdownSec: 10,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: [],
      plugsArmed: true,
    });
    const events = engine.step({
      sessionActive: true,
      focus: discord(T0 - 5000),
      desk: present(T0 + 10 * SEC),
      countdownSec: 10,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: [],
      plugsArmed: true,
    });
    expect(ofType(events, "kill")).toHaveLength(1);
  });

  it("plug_off copies deviceIds so event mutation cannot change PolicyInput", () => {
    const input: PolicyInput = {
      sessionActive: true,
      focus: discord(T0),
      desk: present(T0),
      countdownSec: 0,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: ["lamp", "fan"],
      plugsArmed: true,
    };
    const inputBefore = JSON.stringify(input);
    const events = stepPolicy(INITIAL_POLICY_STATE, input).events;
    const plugOff = ofType(events, "plug_off")[0];
    expect(plugOff).toBeDefined();
    plugOff?.deviceIds.push("mutated");
    expect(JSON.stringify(input)).toBe(inputBefore);
    expect(input.enabledPlugIds).toEqual(["lamp", "fan"]);
  });

  it("does not mutate caller PolicyState or PolicyInput", () => {
    const state: PolicyState = {
      ...INITIAL_POLICY_STATE,
      countdownTargets: [],
    };
    const input: PolicyInput = {
      sessionActive: true,
      focus: discord(T0),
      desk: present(T0),
      countdownSec: 10,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: [],
      plugsArmed: true,
    };
    const stateBefore = JSON.stringify(state);
    const inputBefore = JSON.stringify(input);
    stepPolicy(state, input);
    expect(JSON.stringify(state)).toBe(stateBefore);
    expect(JSON.stringify(input)).toBe(inputBefore);
  });

  it("two engines do not share countdown state", () => {
    const a = new PolicyEngine();
    const b = new PolicyEngine();
    a.step({
      sessionActive: true,
      focus: discord(T0),
      desk: present(T0),
      countdownSec: 10,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: [],
      plugsArmed: true,
    });
    const bEvents = b.step({
      sessionActive: true,
      focus: discord(T0 + 10 * SEC),
      desk: present(T0 + 10 * SEC),
      countdownSec: 10,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: [],
      plugsArmed: true,
    });
    expect(ofType(bEvents, "kill")).toHaveLength(0);
    expect(ofType(bEvents, "start_countdown")).toHaveLength(1);
  });

  it("non-finite countdownSec never kills (fail-safe)", () => {
    const engine = new PolicyEngine();
    engine.step({
      sessionActive: true,
      focus: discord(T0),
      desk: present(T0),
      countdownSec: Number.NaN,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: [],
      plugsArmed: true,
    });
    const later = engine.step({
      sessionActive: true,
      focus: discord(T0 + 60 * SEC),
      desk: present(T0 + 60 * SEC),
      countdownSec: Number.NaN,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: [],
      plugsArmed: true,
    });
    expect(ofType(later, "kill")).toHaveLength(0);
  });

  it("negative countdownSec is treated as immediate kill", () => {
    const events = new PolicyEngine().step({
      sessionActive: true,
      focus: discord(T0),
      desk: present(T0),
      countdownSec: -5,
      deskThreshold: 0.6,
      strictMode: true,
      enabledPlugIds: [],
      plugsArmed: true,
    });
    expect(ofType(events, "kill")).toHaveLength(1);
    expect(ofType(events, "start_countdown")[0]?.seconds).toBe(0);
  });

  it("production policy sources stay pure (no I/O, no wall clock, no electron)", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const files = readdirSync(dir).filter(
      (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"),
    );
    expect(files.length).toBeGreaterThan(0);
    const forbidden = [
      /Date\.now\s*\(/,
      /new Date\s*\(/,
      /performance\.now\s*\(/,
      /from ["']electron["']/,
      /from ["']node:child_process["']/,
      /from ["']child_process["']/,
      /from ["']node:fs["']/,
      /from ["']fs["']/,
      /\bfetch\s*\(/,
      /from ["']electron-store["']/,
      /tplink|node-kasa|hs100|smartplug|plug-controller/i,
    ];
    for (const name of files) {
      const source = readFileSync(join(dir, name), "utf8");
      for (const pattern of forbidden) {
        expect(source, `${name} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
