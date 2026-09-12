import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_BLOCKLIST, DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import type { KillResult, ProcessKiller } from "../../shared/ipc.ts";
import { ALL_BLOCKLIST_TARGET } from "../../shared/policy/index.ts";
import type { AppEntry, PlugDevice, PolicyEvent } from "../../shared/types.ts";
import { SAMPLE_PLUGS } from "./fixtures.ts";
import { SessionController } from "./controller.ts";
import {
  MutableClock,
  RecordingKiller,
  RecordingPlugController,
  ScriptedDeskMonitor,
  ScriptedWindowMonitor,
  awayDesk,
  createMemoryStore,
  createRecordingPush,
  discordFocus,
  docsFocus,
  presentDesk,
} from "./harness.ts";
import { demoKillMatchers, enabledPlugIds, expandKillTargets } from "./targets.ts";

const EVIDENCE_DIR = join(dirname(fileURLToPath(import.meta.url)), "evidence");

interface Harness {
  controller: SessionController;
  window: ScriptedWindowMonitor;
  desk: ScriptedDeskMonitor;
  killer: RecordingKiller;
  plugs: RecordingPlugController;
  clock: MutableClock;
  store: ReturnType<typeof createMemoryStore>;
  trace: ReturnType<typeof createRecordingPush>["trace"];
}

function makeHarness(
  init?: Parameters<typeof createMemoryStore>[0] & { plugDevices?: PlugDevice[] },
): Harness {
  const clock = new MutableClock();
  const window = new ScriptedWindowMonitor();
  const desk = new ScriptedDeskMonitor();
  const killer = new RecordingKiller();
  const plugDevices = init?.plugDevices ?? init?.plugs ?? init?.settings?.plugs ?? [];
  const plugs = new RecordingPlugController(plugDevices);
  const store = createMemoryStore({
    ...init,
    plugs: plugDevices,
    settings: {
      ...(init?.settings ?? DEFAULT_SETTINGS),
      plugs: plugDevices,
    },
  });
  const { push, trace } = createRecordingPush();
  const controller = new SessionController({
    windowMonitor: window,
    deskMonitor: desk,
    killer,
    plugs,
    store,
    push,
    now: clock.now,
    tickIntervalMs: 0,
  });
  return { controller, window, desk, killer, plugs, clock, store, trace };
}

function expectNoStudyPc(ids: string[] | undefined): void {
  expect(ids?.includes("study-pc") ?? false).toBe(false);
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

  it("enabled plug ids skip study-PC and disabled devices", () => {
    expect(enabledPlugIds(SAMPLE_PLUGS)).toEqual(["console-lamp", "tv-outlet"]);
    expect(enabledPlugIds([])).toEqual([]);
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
    const h = makeHarness({
      plugs: SAMPLE_PLUGS,
      settings: { ...DEFAULT_SETTINGS, countdownSec: 10, strictMode: true, plugs: SAMPLE_PLUGS },
    });
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
    expect(policyTypes(h.trace)).toContain("plug_off");
    expect(h.killer.calls.length).toBe(1);
    const killMatchers = h.killer.calls[0];
    expect(killMatchers).toBeDefined();
    expect(killMatchers?.some((matcher) => matcher.toLowerCase().includes("discord"))).toBe(true);
    expect(killMatchers?.includes(ALL_BLOCKLIST_TARGET)).toBe(false);
    expect(afterKill.countdownSec).toBe(0);
    expect(logKinds(h.controller)).toContain("kill");
    expect(logKinds(h.controller)).toContain("plug_off");
    expect(h.plugs.offCalls.length).toBe(1);
    expect(h.plugs.offCalls[0]).toEqual(enabledPlugIds(SAMPLE_PLUGS));
    expectNoStudyPc(h.plugs.offCalls[0]);
    steps.push({
      action: "fuse_elapsed_kill",
      matchers: killMatchers,
      killed: h.killer.result.killed,
      plugOff: h.plugs.offCalls[0],
      countdownSec: afterKill.countdownSec,
    });

    h.clock.advance(250);
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    const unlocked = h.controller.getState();
    expect(unlocked.decision).toBe("ON_TASK");
    expect(policyTypes(h.trace)).toContain("unlock");
    expect(policyTypes(h.trace)).toContain("plug_on");
    expect(logKinds(h.controller)).toContain("unlock");
    expect(logKinds(h.controller)).toContain("plug_on");
    expect(h.plugs.onCalls.length).toBe(1);
    expect(h.plugs.onCalls[0]).toEqual(enabledPlugIds(SAMPLE_PLUGS));
    expectNoStudyPc(h.plugs.onCalls[0]);
    steps.push({
      action: "return_docs_unlock",
      decision: unlocked.decision,
      policyIncludes: "unlock",
      plugOn: h.plugs.onCalls[0],
    });

    h.killer.calls.length = 0;
    h.killer.result = { killed: ["discord.exe (pid 99)"], errors: [] };
    const demo = await h.controller.demoKill();
    expect(demo.killed).toEqual(["discord.exe (pid 99)"]);
    expect(demo.errors).toEqual([]);
    expect(h.killer.calls.length).toBe(1);
    expect(h.killer.calls[0]?.length).toBeGreaterThan(0);
    expect(h.plugs.offCalls.length).toBe(2);
    expect(h.plugs.offCalls[1]).toEqual(enabledPlugIds(SAMPLE_PLUGS));
    expectNoStudyPc(h.plugs.offCalls[1]);
    expect(policyTypes(h.trace).filter((type) => type === "kill").length).toBeGreaterThanOrEqual(2);
    expect(policyTypes(h.trace).filter((type) => type === "plug_off").length).toBeGreaterThanOrEqual(2);
    expect(logKinds(h.controller)).toContain("demo");
    steps.push({
      action: "DEMO_KILL",
      result: demo,
      matchers: h.killer.calls[0],
      plugOff: h.plugs.offCalls[1],
    });

    const evidence = {
      name: "golden-path",
      bar: "Docs→Discord→countdown→kill+plug_off→unlock+plug_on plus Demo Kill cuts plugs",
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

  it("DEMO_KILL immediately kills blocklist matchers and cuts enabled plugs", async () => {
    const h = makeHarness({ plugs: SAMPLE_PLUGS });
    const result = await h.controller.demoKill();
    expect(result.killed.length).toBeGreaterThan(0);
    expect(h.killer.calls.length).toBe(1);
    expect(h.killer.calls[0]?.length).toBeGreaterThan(0);
    expect(h.plugs.offCalls.length).toBe(1);
    expect(h.plugs.offCalls[0]).toEqual(enabledPlugIds(SAMPLE_PLUGS));
    expectNoStudyPc(h.plugs.offCalls[0]);
    expect(h.controller.getState().countdownSec).toBe(0);
    expect(logKinds(h.controller)).toContain("demo");
    expect(logKinds(h.controller)).toContain("plug_off");
    expect(h.trace.policies.some((event) => event.type === "kill" && event.reason === "demo")).toBe(
      true,
    );
    expect(h.trace.policies.some((event) => event.type === "plug_off")).toBe(true);
  });

  it("zero plugs still kills and never throws", async () => {
    const h = makeHarness({ plugDevices: [] });
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    h.clock.advance(10_000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(1);
    expect(policyTypes(h.trace)).toContain("kill");
    expect(policyTypes(h.trace)).not.toContain("plug_off");
    expect(h.plugs.offCalls).toEqual([]);
    await expect(h.controller.demoKill()).resolves.toMatchObject({
      killed: ["discord.exe (pid 44552)"],
    });
    expect(h.plugs.offCalls).toEqual([[]]);
  });

  it("never sends plug commands for isStudyPc, even when policy asks", async () => {
    const h = makeHarness({ plugs: SAMPLE_PLUGS });
    const scripted: PolicyEvent[] = [
      { type: "plug_off", deviceIds: ["study-pc", "console-lamp"], reason: "forced" },
      { type: "status", decision: "DISTRACTED", detail: "forced plug_off" },
    ];
    const scriptedController = new SessionController({
      windowMonitor: h.window,
      deskMonitor: h.desk,
      killer: h.killer,
      plugs: h.plugs,
      store: h.store,
      push: {
        sessionState: () => undefined,
        policyEvent: (event) => h.trace.policies.push(event),
        focusSnapshot: () => undefined,
        deskSnapshot: () => undefined,
        sessionEvent: (event) => h.trace.events.push(event),
      },
      policyFactory: () => ({
        step: () => {
          const events = scripted.splice(0, scripted.length);
          return events;
        },
      }),
      now: h.clock.now,
      tickIntervalMs: 0,
    });
    await scriptedController.start();
    await scriptedController.tick();
    expect(h.plugs.offCalls.length).toBeGreaterThanOrEqual(1);
    for (const call of h.plugs.offCalls) {
      expectNoStudyPc(call);
      expect(call).toContain("console-lamp");
    }
  });

  it("consumes plug_on after unlock and swallows plug host errors", async () => {
    const h = makeHarness({
      plugs: SAMPLE_PLUGS,
      settings: { ...DEFAULT_SETTINGS, countdownSec: 1, plugs: SAMPLE_PLUGS },
    });
    h.plugs.failWith = "tapo unreachable";
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    h.clock.advance(1000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(1);
    expect(h.plugs.offCalls.length).toBe(1);
    expect(logKinds(h.controller)).toContain("plug_off");

    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    expect(policyTypes(h.trace)).toContain("unlock");
    expect(h.plugs.onCalls.length).toBe(1);
    expectNoStudyPc(h.plugs.onCalls[0]);
    expect(logKinds(h.controller)).toContain("plug_on");
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
    const h = makeHarness({
      plugs: SAMPLE_PLUGS,
      settings: { ...DEFAULT_SETTINGS, countdownSec: 1, plugs: SAMPLE_PLUGS },
    });
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    h.clock.advance(1000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(1);
    expect(h.plugs.offCalls.length).toBe(1);
    expect(h.plugs.offCalls[0]).toEqual(enabledPlugIds(SAMPLE_PLUGS));
    h.clock.advance(1000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(1);
    expect(h.plugs.offCalls.length).toBe(1);
  });

  it("start() ignores stale snapshots from a previous session", async () => {
    const h = makeHarness({ plugs: SAMPLE_PLUGS });
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    expect(h.controller.getState().countdownSec).toBe(10);
    await h.controller.stop();

    // Hours later, restart with a 0s fuse — the stale Discord snapshot must
    // not drive an instant kill before either monitor emits.
    h.clock.advance(3 * 60 * 60 * 1000);
    h.controller.setSettings({ countdownSec: 0 });
    const restarted = await h.controller.start();
    expect(restarted.focus).toBe(null);
    expect(restarted.desk).toBe(null);
    expect(restarted.decision).toBe("IDLE");
    expect(restarted.countdownSec).toBe(0);
    expect(h.killer.calls.length).toBe(0);
    expect(h.plugs.offCalls.length).toBe(0);

    h.clock.advance(10_000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(0);
    expect(policyTypes(h.trace).filter((type) => type === "start_countdown").length).toBe(1);
  });

  it("Demo Kill mid-countdown resets the policy fuse — no invisible second kill", async () => {
    const h = makeHarness({ plugs: SAMPLE_PLUGS });
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    expect(h.controller.getState().countdownSec).toBe(10);

    h.clock.advance(3000);
    await h.controller.tick();
    expect(h.controller.getState().countdownSec).toBe(7);

    await h.controller.demoKill();
    expect(h.killer.calls.length).toBe(1);
    expect(h.plugs.offCalls.length).toBe(1);
    expect(h.controller.getState().countdownSec).toBe(0);

    // The original 10s fuse would have expired here — nothing may fire
    // without a fresh, visible countdown.
    h.clock.advance(7000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(1);
    expect(h.plugs.offCalls.length).toBe(1);
    expect(h.controller.getState().countdownSec).toBe(10);
  });

  it("Demo Kill after a fuse kill does not strand plugs — on-task return still unlocks + plug_on", async () => {
    const h = makeHarness({ plugs: SAMPLE_PLUGS });
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    h.clock.advance(10_000);
    await h.controller.tick();
    // Fuse kill: plugs cut, engine locked.
    expect(h.killer.calls.length).toBe(1);
    expect(h.plugs.offCalls.length).toBe(1);

    // Demo Kill replaces the engine (dropping `locked`) and cuts plugs again.
    await h.controller.demoKill();
    expect(h.plugs.offCalls.length).toBe(2);

    h.clock.advance(250);
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    expect(h.controller.getState().decision).toBe("ON_TASK");
    expect(policyTypes(h.trace)).toContain("unlock");
    expect(logKinds(h.controller)).toContain("unlock");
    expect(logKinds(h.controller)).toContain("plug_on");
    expect(h.plugs.onCalls.length).toBe(1);
    expect(h.plugs.onCalls[0]).toEqual(enabledPlugIds(SAMPLE_PLUGS));
    expectNoStudyPc(h.plugs.onCalls[0]);
  });

  it("plugs cut by Demo Kill while on task are restored on the next evaluation, once", async () => {
    const h = makeHarness({ plugs: SAMPLE_PLUGS });
    await h.controller.start();
    h.window.emit(docsFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();

    await h.controller.demoKill();
    expect(h.plugs.offCalls.length).toBe(1);

    h.clock.advance(250);
    await h.controller.tick();
    expect(policyTypes(h.trace)).toContain("unlock");
    expect(h.plugs.onCalls.length).toBe(1);
    expect(h.plugs.onCalls[0]).toEqual(enabledPlugIds(SAMPLE_PLUGS));

    // The restore is one-shot — staying on task must not re-send plug_on.
    h.clock.advance(250);
    await h.controller.tick();
    expect(h.plugs.onCalls.length).toBe(1);
  });

  it("lengthening countdownSec mid-fuse retimes the display to the engine kill time", async () => {
    const h = makeHarness({ plugs: SAMPLE_PLUGS });
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    h.clock.advance(5000);
    await h.controller.tick();
    expect(h.controller.getState().countdownSec).toBe(5);

    h.controller.setSettings({ countdownSec: 600 });
    await h.controller.flush();
    expect(h.controller.getState().countdownSec).toBe(595);
    expect(h.killer.calls.length).toBe(0);

    h.clock.advance(594_000);
    await h.controller.tick();
    expect(h.controller.getState().countdownSec).toBe(1);
    expect(h.killer.calls.length).toBe(0);

    h.clock.advance(1000);
    await h.controller.tick();
    expect(h.killer.calls.length).toBe(1);
    expect(h.controller.getState().countdownSec).toBe(0);
  });

  it("shortening countdownSec mid-fuse kills in sync with a zeroed display", async () => {
    const h = makeHarness({ plugs: SAMPLE_PLUGS });
    await h.controller.start();
    h.window.emit(discordFocus(h.clock.ms));
    h.desk.emit(presentDesk(h.clock.ms));
    await h.controller.flush();
    h.clock.advance(5000);
    await h.controller.tick();
    expect(h.controller.getState().countdownSec).toBe(5);

    // 5s already elapsed >= the new 3s fuse: the engine kills on the settings
    // evaluation and the display agrees at 0.
    h.controller.setSettings({ countdownSec: 3 });
    await h.controller.flush();
    expect(h.killer.calls.length).toBe(1);
    expect(h.plugs.offCalls.length).toBe(1);
    expect(h.controller.getState().countdownSec).toBe(0);
  });

  it("stop() during an in-flight fuse kill finishes kill + plug_off before logging stop", async () => {
    const clock = new MutableClock();
    const window = new ScriptedWindowMonitor();
    const desk = new ScriptedDeskMonitor();
    const plugs = new RecordingPlugController(SAMPLE_PLUGS);
    const store = createMemoryStore({
      plugs: SAMPLE_PLUGS,
      settings: { ...DEFAULT_SETTINGS, plugs: SAMPLE_PLUGS },
    });
    const { push } = createRecordingPush();
    let releaseKill: (result: KillResult) => void = () => undefined;
    let markStarted: () => void = () => undefined;
    const killStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const gate = new Promise<KillResult>((resolve) => {
      releaseKill = resolve;
    });
    const calls: string[][] = [];
    const killer: ProcessKiller = {
      kill: (matchers) => {
        calls.push([...matchers]);
        markStarted();
        return gate;
      },
    };
    const controller = new SessionController({
      windowMonitor: window,
      deskMonitor: desk,
      killer,
      plugs,
      store,
      push,
      now: clock.now,
      tickIntervalMs: 0,
    });

    await controller.start();
    window.emit(discordFocus(clock.ms));
    desk.emit(presentDesk(clock.ms));
    await controller.flush();
    clock.advance(10_000);
    const tickDone = controller.tick();
    await killStarted;

    const stopDone = controller.stop();
    releaseKill({ killed: ["discord.exe (pid 7)"], errors: [] });
    await stopDone;
    await tickDone;

    // The paired plug_off applied, and the kill logged before "Session stopped".
    expect(calls.length).toBe(1);
    expect(plugs.offCalls.length).toBe(1);
    const log = controller.getLog();
    const stopIndex = log.findIndex((event) => event.detail.includes("Session stopped"));
    const killIndex = log.findIndex((event) => event.kind === "kill");
    expect(killIndex).toBeGreaterThanOrEqual(0);
    expect(stopIndex).toBeGreaterThanOrEqual(0);
    // Log is newest-first: the stop entry must be newer than the kill entry.
    expect(stopIndex).toBeLessThan(killIndex);
  });

  it("SETTINGS_SET plugs route enforces the PLUGS_ADD hard-deny", () => {
    const h = makeHarness();
    const denied = {
      id: "x",
      name: "Study PC lamp",
      protocol: "http" as const,
      address: "192.168.1.20",
      enabled: true,
      isStudyPc: false as const,
    };
    expect(() => h.controller.setSettings({ plugs: [denied] })).toThrow(/study/i);
    expect(() =>
      h.controller.setSettings({ plugs: [{ ...denied, name: "Lamp", address: "127.0.0.1" }] }),
    ).toThrow(/localhost/i);
    expect(h.store.loadSettings().plugs).toEqual([]);

    const lamp = {
      id: "lamp",
      name: "Desk lamp",
      protocol: "mock" as const,
      address: "127.0.0.1",
      enabled: true,
      isStudyPc: false as const,
    };
    expect(h.controller.setSettings({ plugs: [lamp] }).plugs).toEqual([lamp]);
    expect(h.store.loadSettings().plugs).toEqual([lamp]);
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
      deskModelId: "blazeface",
      faceId: "hourglass",
    });
    store.appendSessionLog({ ts: 10, kind: "session", detail: "started" });
    store.appendSessionLog({ ts: 11, kind: "kill", detail: "discord" });

    const reloaded = new FocusPlugStore(dir);
    expect(reloaded.loadSettings().countdownSec).toBe(7);
    expect(reloaded.loadSettings().webcamEnabled).toBe(false);
    expect(reloaded.loadSettings().deskModelId).toBe("blazeface");
    expect(reloaded.loadSettings().faceId).toBe("hourglass");
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
    expect(settings.faceId).toBe("flight");
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

describe("session face settings", () => {
  it("persists faceId on the same settings blob and rejects retired ids", () => {
    const h = makeHarness();
    expect(h.controller.getSettings().faceId).toBe("flight");
    expect(h.controller.setSettings({ faceId: "hourglass" }).faceId).toBe("hourglass");
    expect(h.store.loadSettings().faceId).toBe("hourglass");
    expect(h.controller.setSettings({ faceId: "flask" }).faceId).toBe("flask");
    expect(h.store.loadSettings().faceId).toBe("flask");
    expect(h.controller.setSettings({ faceId: "candle" }).faceId).toBe("candle");
    expect(h.store.loadSettings().faceId).toBe("candle");
    expect(() => h.controller.setSettings({ faceId: "eclipse" })).toThrow(/faceId/);
    expect(() => h.controller.setSettings({ faceId: "column" })).toThrow(/faceId/);
    expect(() => h.controller.setSettings({ faceId: "field" })).toThrow(/faceId/);
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
