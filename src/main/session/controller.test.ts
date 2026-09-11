import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOCKLIST, DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import { ALL_BLOCKLIST_TARGET } from "../../shared/policy/index.ts";
import type { AppEntry, PolicyEvent } from "../../shared/types.ts";
import { SessionController } from "./controller.ts";
import {
  MutableClock,
  RecordingKiller,
  ScriptedDeskMonitor,
  ScriptedWindowMonitor,
  awayDesk,
  createMemoryStore,
  createRecordingPush,
  discordFocus,
  docsFocus,
  presentDesk,
} from "./harness.ts";
import { demoKillMatchers, expandKillTargets } from "./targets.ts";

const EVIDENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "evidence");

interface Harness {
  controller: SessionController;
  window: ScriptedWindowMonitor;
  desk: ScriptedDeskMonitor;
  killer: RecordingKiller;
  clock: MutableClock;
  store: ReturnType<typeof createMemoryStore>;
  trace: ReturnType<typeof createRecordingPush>["trace"];
}

function makeHarness(init?: Parameters<typeof createMemoryStore>[0]): Harness {
  const clock = new MutableClock();
  const window = new ScriptedWindowMonitor();
  const desk = new ScriptedDeskMonitor();
  const killer = new RecordingKiller();
  const store = createMemoryStore(init);
  const { push, trace } = createRecordingPush();
  const controller = new SessionController({
    windowMonitor: window,
    deskMonitor: desk,
    killer,
    store,
    push,
    now: clock.now,
    tickIntervalMs: 0,
  });
  return { controller, window, desk, killer, clock, store, trace };
}

function policyTypes(trace: Harness["trace"]): PolicyEvent["type"][] {
  return trace.policies.map((event) => event.type);
}

function logKinds(controller: SessionController): string[] {
  return controller.getLog().map((event) => event.kind);
}

describe("expandKillTargets", () => {
  it("replaces the all-blocklist sentinel with enabled matchers", () => {
    const blocklist: AppEntry[] = [
      { id: "discord", name: "Discord", match: ["discord", "discord.exe"], enabled: true },
      { id: "steam", name: "Steam", match: ["steam.exe"], enabled: true },
      { id: "idle", name: "Idle", match: ["idle.exe"], enabled: false },
    ];
    expect(expandKillTargets([ALL_BLOCKLIST_TARGET], blocklist)).toEqual([
      "discord",
      "discord.exe",
      "steam.exe",
    ]);
    expect(expandKillTargets(["discord.exe", ALL_BLOCKLIST_TARGET], blocklist)).toEqual([
      "discord.exe",
      "discord",
      "steam.exe",
    ]);
  });

  it("demo kill uses live blocklist or default fallback", () => {
    expect(demoKillMatchers(DEFAULT_BLOCKLIST, null).length).toBeGreaterThan(0);
    expect(demoKillMatchers([], discordFocus(1)).includes("discord.exe")).toBe(true);
  });
});

describe("SessionController", () => {
  it("SESSION_START marks active, starts monitors, and logs", async () => {
    const h = makeHarness();
    const state = await h.controller.start();
    expect(state.sessionActive).toBe(true);
    expect(h.window.started).toBe(true);
    expect(h.desk.started).toBe(true);
    expect(logKinds(h.controller)).toContain("session");
    expect(h.trace.events.some((event) => event.kind === "session")).toBe(true);
    expect(h.trace.states.length).toBeGreaterThan(0);
  });

  it("SESSION_STOP stops monitors, clears countdown, and returns idle", async () => {
    const h = makeHarness();
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    expect(h.controller.getState().countdownSec).toBe(10);

    const stopped = await h.controller.stop();
    expect(stopped.sessionActive).toBe(false);
    expect(stopped.decision).toBe("IDLE");
    expect(stopped.countdownSec).toBe(0);
    expect(h.window.started).toBe(false);
    expect(h.desk.started).toBe(false);
    expect(logKinds(h.controller).filter((kind) => kind === "session").length).toBeGreaterThanOrEqual(
      2,
    );
  });

  it("gauntlet: Docs→Discord→countdown→kill→return→unlock + Demo Kill", async () => {
    const h = makeHarness({ settings: { ...DEFAULT_SETTINGS, countdownSec: 10, strictMode: true } });
    const steps: Array<Record<string, unknown>> = [];

    const started = await h.controller.start();
    steps.push({ action: "SESSION_START", state: started, log: h.controller.getLog()[0] });

    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    const onTask = h.controller.getState();
    expect(onTask.decision).toBe("ON_TASK");
    expect(onTask.countdownSec).toBe(0);
    expect(onTask.focus?.matchedAllow).toBe(true);
    expect(onTask.desk?.label).toBe("at_desk");
    steps.push({
      action: "docs_at_desk",
      decision: onTask.decision,
      detail: onTask.detail,
      policy: policyTypes(h.trace),
    });

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    const distracted = h.controller.getState();
    expect(distracted.decision).toBe("DISTRACTED");
    expect(distracted.countdownSec).toBe(10);
    expect(policyTypes(h.trace)).toContain("start_countdown");
    expect(logKinds(h.controller)).toContain("countdown");
    expect(h.trace.focus.some((snap) => snap.matchedBlock)).toBe(true);
    expect(h.trace.desk.some((snap) => snap.label === "at_desk")).toBe(true);
    expect(h.trace.states.some((state) => state.countdownSec === 10)).toBe(true);
    steps.push({
      action: "discord_focus",
      decision: distracted.decision,
      countdownSec: distracted.countdownSec,
      policyIncludes: "start_countdown",
    });

    h.clock.advance(1000);
    await h.controller.tick();
    expect(h.controller.getState().countdownSec).toBe(9);
    expect(h.trace.states.some((state) => state.countdownSec === 9)).toBe(true);

    h.clock.advance(1000);
    await h.controller.tick();
    expect(h.controller.getState().countdownSec).toBe(8);
    expect(h.trace.states.some((state) => state.countdownSec === 8)).toBe(true);
    steps.push({
      action: "countdown_tick",
      remaining: h.controller.getState().countdownSec,
    });

    h.clock.advance(8000);
    await h.controller.tick();
    const afterKill = h.controller.getState();
    expect(policyTypes(h.trace)).toContain("kill");
    expect(h.killer.calls.length).toBe(1);
    const killMatchers = h.killer.calls[0];
    expect(killMatchers).toBeDefined();
    expect(killMatchers?.some((matcher) => matcher.toLowerCase().includes("discord"))).toBe(true);
    expect(killMatchers?.includes(ALL_BLOCKLIST_TARGET)).toBe(false);
    expect(afterKill.countdownSec).toBe(0);
    expect(logKinds(h.controller)).toContain("kill");
    steps.push({
      action: "fuse_elapsed_kill",
      matchers: killMatchers,
      killed: h.killer.result.killed,
      countdownSec: afterKill.countdownSec,
    });

    h.clock.advance(250);
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    const unlocked = h.controller.getState();
    expect(unlocked.decision).toBe("ON_TASK");
    expect(policyTypes(h.trace)).toContain("unlock");
    expect(logKinds(h.controller)).toContain("unlock");
    steps.push({
      action: "return_docs_unlock",
      decision: unlocked.decision,
      policyIncludes: "unlock",
    });

    h.killer.calls.length = 0;
    h.killer.result = { killed: ["discord.exe (pid 99)"], errors: [] };
    const demo = await h.controller.demoKill();
    expect(demo.killed).toEqual(["discord.exe (pid 99)"]);
    expect(demo.errors).toEqual([]);
    expect(h.killer.calls.length).toBe(1);
    expect(h.killer.calls[0]?.length).toBeGreaterThan(0);
    expect(policyTypes(h.trace).filter((type) => type === "kill").length).toBeGreaterThanOrEqual(2);
    expect(logKinds(h.controller)).toContain("demo");
    steps.push({
      action: "DEMO_KILL",
      result: demo,
      matchers: h.killer.calls[0],
    });

    const evidence = {
      name: "golden-path",
      bar: "Docs→Discord→countdown→kill→return→unlock plus Demo Kill instant path",
      platform: process.platform,
      passed: true,
      settings: h.controller.getSettings(),
      policyEventTypes: policyTypes(h.trace),
      log: h.controller.getLog(),
      steps,
    };
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    writeFileSync(join(EVIDENCE_DIR, "golden-path.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  });

  it("cancels countdown when back ON_TASK before fuse 0", async () => {
    const h = makeHarness();
    await h.controller.start();
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    expect(h.controller.getState().countdownSec).toBe(10);

    h.clock.advance(4000);
    await h.controller.tick();
    expect(h.controller.getState().countdownSec).toBe(6);

    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    expect(h.controller.getState().decision).toBe("ON_TASK");
    expect(h.controller.getState().countdownSec).toBe(0);
    expect(policyTypes(h.trace)).toContain("cancel_countdown");
    expect(policyTypes(h.trace)).toContain("unlock");
    expect(h.killer.calls.length).toBe(0);
  });

  it("desk-away expands *blocklist* before ProcessKiller", async () => {
    const h = makeHarness({ settings: { ...DEFAULT_SETTINGS, countdownSec: 3 } });
    await h.controller.start();
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();

    h.clock.advance(250);
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(awayDesk(h.clock.ms));
    await h.controller.flush();
    expect(h.controller.getState().decision).toBe("AWAY");
    expect(h.controller.getState().countdownSec).toBe(3);

    h.clock.advance(3000);
    await h.controller.tick();
    expect(policyTypes(h.trace)).toContain("kill");
    const matchers = h.killer.calls[0] ?? [];
    expect(matchers.includes(ALL_BLOCKLIST_TARGET)).toBe(false);
    expect(matchers.some((matcher) => matcher.toLowerCase().includes("discord"))).toBe(true);
    expect(matchers.some((matcher) => matcher.toLowerCase().includes("steam"))).toBe(true);
  });

  it("DEMO_KILL immediately kills blocklist matchers without a countdown", async () => {
    const h = makeHarness();
    const result = await h.controller.demoKill();
    expect(result.killed.length).toBeGreaterThan(0);
    expect(h.killer.calls.length).toBe(1);
    expect(h.killer.calls[0]?.length).toBeGreaterThan(0);
    expect(h.controller.getState().countdownSec).toBe(0);
    expect(logKinds(h.controller)).toContain("demo");
    expect(h.trace.policies.some((event) => event.type === "kill" && event.reason === "demo")).toBe(
      true,
    );
  });

  it("lists and settings persist through the store and affect the live loop", async () => {
    const h = makeHarness();
    await h.controller.start();
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();

    const shortened = h.controller.setSettings({ countdownSec: 4 });
    expect(shortened.countdownSec).toBe(4);
    expect(h.store.loadSettings().countdownSec).toBe(4);

    h.clock.advance(250);
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    expect(h.controller.getState().countdownSec).toBe(4);

    const nextBlock: AppEntry[] = [
      { id: "only-discord", name: "Discord", match: ["discord.exe"], enabled: true },
    ];
    const lists = h.controller.setBlocklist(nextBlock);
    expect(lists.blocklist).toEqual(nextBlock);
    expect(h.store.loadBlocklist()).toEqual(nextBlock);

    h.controller.setDeskEnabled(false);
    expect(h.desk.enabled).toBe(false);
    expect(h.store.loadSettings().webcamEnabled).toBe(false);
    expect(h.controller.getLog().some((event) => event.kind === "settings")).toBe(true);
    expect(h.controller.getLog().some((event) => event.kind === "lists")).toBe(true);
    expect(h.controller.getLog().some((event) => event.kind === "desk")).toBe(true);
  });

  it("does not kill twice while still on the blocked app after fuse", async () => {
    const h = makeHarness({ settings: { ...DEFAULT_SETTINGS, countdownSec: 1 } });
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    h.clock.advance(1000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(1);
    h.clock.advance(1000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(1);
  });

  it("250ms ticker publishes live remaining countdown without new snapshots", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const window = new ScriptedWindowMonitor();
    const desk = new ScriptedDeskMonitor();
    const killer = new RecordingKiller();
    const store = createMemoryStore({
      settings: { ...DEFAULT_SETTINGS, countdownSec: 10 },
    });
    const { push, trace } = createRecordingPush();
    const controller = new SessionController({
      windowMonitor: window,
      deskMonitor: desk,
      killer,
      store,
      push,
      tickIntervalMs: 250,
    });
    try {
      await controller.start();
      window.emit(discordFocus(Date.now()));
      desk.emit(presentDesk(Date.now()));
      await controller.flush();
      expect(controller.getState().countdownSec).toBe(10);

      await vi.advanceTimersByTimeAsync(1000);
      await controller.flush();
      expect(controller.getState().countdownSec).toBe(9);
      expect(trace.states.some((state) => state.countdownSec === 9)).toBe(true);
    } finally {
      await controller.stop();
      vi.useRealTimers();
    }
  });
});

describe("FocusPlugStore persistence", () => {
  it("round-trips settings and session log on disk", async () => {
    const { FocusPlugStore } = await import("../store/appStore.ts");
    const dir = mkdtempSync(join(tmpdir(), "focusplug-session-store-"));
    const store = new FocusPlugStore(dir);
    store.saveSettings({
      ...DEFAULT_SETTINGS,
      countdownSec: 7,
      deskThreshold: 0.7,
      strictMode: true,
      webcamEnabled: false,
    });
    store.appendSessionLog({ ts: 10, kind: "session", detail: "started" });
    store.appendSessionLog({ ts: 11, kind: "kill", detail: "discord" });

    const reloaded = new FocusPlugStore(dir);
    expect(reloaded.loadSettings().countdownSec).toBe(7);
    expect(reloaded.loadSettings().webcamEnabled).toBe(false);
    expect(reloaded.loadSettings().deskModelId).toBe("blazeface");
    expect(reloaded.loadSettings().plugs).toEqual([]);
    const log = reloaded.loadSessionLog();
    expect(log[0]?.kind).toBe("kill");
    expect(log[1]?.kind).toBe("session");
    expect(JSON.parse(readFileSync(join(dir, "settings.json"), "utf8")).countdownSec).toBe(7);
  });

  it("drops study-PC plugs and unknown desk models when loading settings", async () => {
    const { FocusPlugStore } = await import("../store/appStore.ts");
    const dir = mkdtempSync(join(tmpdir(), "focusplug-settings-guard-"));
    writeFileSync(
      join(dir, "settings.json"),
      JSON.stringify({
        countdownSec: 10,
        deskThreshold: 0.6,
        strictMode: true,
        webcamEnabled: true,
        deskModelId: "blazeface-v2",
        plugs: [
          {
            id: "lamp",
            name: "Lamp",
            protocol: "mock",
            address: "127.0.0.1",
            enabled: true,
            isStudyPc: false,
          },
          {
            id: "study-pc",
            name: "Study PC",
            protocol: "kasa",
            address: "10.0.0.2",
            enabled: true,
            isStudyPc: true,
          },
        ],
      }),
      "utf8",
    );
    const store = new FocusPlugStore(dir);
    const settings = store.loadSettings();
    expect(settings.deskModelId).toBe("blazeface");
    expect(settings.plugs).toEqual([
      {
        id: "lamp",
        name: "Lamp",
        protocol: "mock",
        address: "127.0.0.1",
        enabled: true,
        isStudyPc: false,
      },
    ]);
  });
});

describe("Phase 2 desk model and plug settings", () => {
  it("gets/sets deskModelId on the same settings blob", () => {
    const h = makeHarness();
    expect(h.controller.getDeskModelId()).toBe("blazeface");
    expect(h.controller.setDeskModelId("stub")).toBe("stub");
    expect(h.store.loadSettings().deskModelId).toBe("stub");
    expect(() => h.controller.setDeskModelId("blazeface-v2")).toThrow(/deskModelId/);
  });

  it("lists, adds, tests, and removes plugs without a driver", () => {
    const h = makeHarness();
    expect(h.controller.listPlugs()).toEqual([]);
    const lamp = {
      id: "lamp",
      name: "Desk lamp",
      protocol: "mock" as const,
      address: "127.0.0.1",
      enabled: true,
      isStudyPc: false as const,
    };
    expect(h.controller.addPlug(lamp)).toEqual([lamp]);
    expect(h.controller.testPlug("lamp")).toMatchObject({
      deviceId: "lamp",
      online: false,
      powerOn: null,
      error: "plug driver not implemented",
    });
    expect(() =>
      h.controller.addPlug({ ...lamp, id: "pc", name: "Study PC", isStudyPc: true } as unknown),
    ).toThrow(/isStudyPc/);
    expect(h.controller.removePlug("lamp")).toEqual([]);
    expect(() => h.controller.testPlug("lamp")).toThrow(/not found/);
  });
});
