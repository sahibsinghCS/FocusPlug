import {
  DEFAULT_ALLOWLIST,
  DEFAULT_BLOCKLIST,
  DEFAULT_SETTINGS,
} from "../../shared/defaults.ts";
import type {
  AppSettings,
  DeskMonitor,
  KillResult,
  ProcessKiller,
  SessionState,
  WindowMonitor,
} from "../../shared/ipc.ts";
import type {
  AppEntry,
  DeskSnapshot,
  FocusSnapshot,
  PolicyEvent,
  SessionEvent,
} from "../../shared/types.ts";
import type { SessionStore } from "./controller.ts";
import type { SessionPush } from "./push.ts";

function cloneEntries(entries: AppEntry[]): AppEntry[] {
  return entries.map((entry) => ({
    ...entry,
    match: [...entry.match],
  }));
}

export class ScriptedWindowMonitor implements WindowMonitor {
  started = false;
  private cb: ((snap: FocusSnapshot) => void) | null = null;

  start(cb: (snap: FocusSnapshot) => void): void {
    this.cb = cb;
    this.started = true;
  }

  stop(): void {
    this.cb = null;
    this.started = false;
  }

  emit(snap: FocusSnapshot): void {
    this.cb?.(snap);
  }
}

export class ScriptedDeskMonitor implements DeskMonitor {
  started = false;
  enabled = true;
  private cb: ((snap: DeskSnapshot) => void) | null = null;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  start(cb: (snap: DeskSnapshot) => void): void {
    this.cb = cb;
    this.started = true;
  }

  stop(): void {
    this.cb = null;
    this.started = false;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  emit(snap: DeskSnapshot): void {
    this.cb?.(snap);
  }
}

export class RecordingKiller implements ProcessKiller {
  readonly calls: string[][] = [];
  result: KillResult = { killed: ["discord.exe (pid 44552)"], errors: [] };

  async kill(matchers: string[]): Promise<KillResult> {
    this.calls.push([...matchers]);
    return {
      killed: [...this.result.killed],
      errors: [...this.result.errors],
    };
  }
}

export class MutableClock {
  ms: number;

  constructor(start = 1_000_000) {
    this.ms = start;
  }

  now = (): number => this.ms;

  advance(ms: number): void {
    this.ms += ms;
  }
}

export function createMemoryStore(init?: {
  allowlist?: AppEntry[];
  blocklist?: AppEntry[];
  settings?: AppSettings;
}): SessionStore {
  let allowlist = cloneEntries(init?.allowlist ?? DEFAULT_ALLOWLIST);
  let blocklist = cloneEntries(init?.blocklist ?? DEFAULT_BLOCKLIST);
  let settings: AppSettings = { ...(init?.settings ?? DEFAULT_SETTINGS) };
  const log: SessionEvent[] = [];
  return {
    loadAllowlist: () => cloneEntries(allowlist),
    saveAllowlist: (entries) => {
      allowlist = cloneEntries(entries);
    },
    loadBlocklist: () => cloneEntries(blocklist),
    saveBlocklist: (entries) => {
      blocklist = cloneEntries(entries);
    },
    loadSettings: () => ({ ...settings }),
    saveSettings: (next) => {
      settings = { ...next };
    },
    appendSessionLog: (event) => {
      log.unshift({ ...event });
    },
    loadSessionLog: () => log.map((event) => ({ ...event })),
  };
}

export interface PushTrace {
  states: SessionState[];
  policies: PolicyEvent[];
  focus: FocusSnapshot[];
  desk: DeskSnapshot[];
  events: SessionEvent[];
}

export function createRecordingPush(): { push: SessionPush; trace: PushTrace } {
  const trace: PushTrace = {
    states: [],
    policies: [],
    focus: [],
    desk: [],
    events: [],
  };
  return {
    trace,
    push: {
      sessionState: (state) => {
        trace.states.push({
          ...state,
          focus: state.focus === null ? null : { ...state.focus },
          desk: state.desk === null ? null : { ...state.desk },
        });
      },
      policyEvent: (event) => {
        trace.policies.push(event);
      },
      focusSnapshot: (snap) => {
        trace.focus.push({ ...snap });
      },
      deskSnapshot: (snap) => {
        trace.desk.push({ ...snap });
      },
      sessionEvent: (event) => {
        trace.events.push({ ...event });
      },
    },
  };
}

export function docsFocus(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "chrome.exe",
    windowTitle: "Essay — Google Docs",
    matchedAllow: true,
    matchedBlock: false,
  };
}

export function discordFocus(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "discord.exe",
    windowTitle: "#general — Discord",
    matchedAllow: false,
    matchedBlock: true,
    blockEntryId: "discord",
  };
}

export function presentDesk(ts: number, webcamEnabled = true): DeskSnapshot {
  return {
    ts,
    label: "at_desk",
    confidence: 0.94,
    webcamEnabled,
  };
}

export function awayDesk(ts: number): DeskSnapshot {
  return {
    ts,
    label: "away",
    confidence: 0.92,
    webcamEnabled: true,
  };
}
