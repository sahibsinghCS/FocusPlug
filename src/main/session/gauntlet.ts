import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BLOCKLIST_TARGET } from "../../shared/policy/index.ts";
import { IPC_PUSH } from "../../shared/ipc.ts";
import type { KillResult, ProcessKiller } from "../../shared/ipc.ts";
import type { DeskSnapshot, FocusSnapshot, PolicyEvent } from "../../shared/types.ts";
import { createProcessKiller, MemoryProcessHost } from "../kill/index.ts";
import { createFocusPlugStore } from "../store/persist.ts";
import { createSessionRuntime } from "./factory.ts";
import { ControllableClock, ScriptedDeskMonitor, ScriptedWindowMonitor } from "./scripted.ts";
import { flattenEnabledMatchers } from "./targets.ts";
import type { SessionRuntime } from "./runtime.ts";

export interface GauntletAssertion {
  name: string;
  pass: boolean;
  detail: string;
}

export interface GauntletStep {
  id: string;
  title: string;
  state: ReturnType<SessionRuntime["getState"]>;
  policyTypes: PolicyEvent["type"][];
  logTail: Array<{ kind: string; detail: string }>;
  running: string[];
  killedPids: number[];
}

export interface GauntletReport {
  ranAt: string;
  bar: string[];
  verdict: "PASS" | "FAIL";
  host: string;
  node: string;
  killCalls: string[][];
  demoKill: KillResult | null;
  ipcChannels: string[];
  persistedLogKinds: string[];
  steps: GauntletStep[];
  assertions: GauntletAssertion[];
}

const BAR = [
  "1. Start session with Docs/Chrome-style allowlist focus",
  "2. Distracted by Discord (or simulated FocusSnapshot with matchedBlock)",
  "3. UI/state shows Distracted + countdown",
  "4. Kill fires on blocklist target (or simulated host evidence)",
  "5. Return to allowlist + at_desk → Unlocked",
  "6. Demo Kill instant path works",
];

function chromeFocus(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "chrome.exe",
    windowTitle: "Essay - Google Docs - Google Chrome",
    matchedAllow: true,
    matchedBlock: false,
  };
}

function discordFocus(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "Discord.exe",
    windowTitle: "Friends - Discord",
    matchedAllow: false,
    matchedBlock: true,
    blockEntryId: "discord",
  };
}

function atDesk(ts: number, confidence = 0.94): DeskSnapshot {
  return { ts, label: "at_desk", confidence, webcamEnabled: true };
}

function awayDesk(ts: number, confidence = 0.92): DeskSnapshot {
  return { ts, label: "away", confidence, webcamEnabled: true };
}

function uncertainDesk(ts: number, confidence = 0.99): DeskSnapshot {
  return { ts, label: "uncertain", confidence, webcamEnabled: true };
}

function lowConfAway(ts: number): DeskSnapshot {
  return { ts, label: "away", confidence: 0.2, webcamEnabled: true };
}

function namesOf(result: KillResult): string {
  return result.killed.join(" | ") || "(none)";
}

function killedHas(result: KillResult, needle: string): boolean {
  const lower = needle.toLowerCase();
  return result.killed.some((item) => item.toLowerCase().includes(lower));
}

export async function runGoldenPathGauntlet(options?: {
  writeEvidence?: boolean;
}): Promise<GauntletReport> {
  const writeEvidence = options?.writeEvidence ?? true;
  const assertions: GauntletAssertion[] = [];
  const steps: GauntletStep[] = [];
  const killCalls: string[][] = [];

  const check = (name: string, pass: boolean, detail: string): void => {
    assertions.push({ name, pass, detail });
  };

  const dir = mkdtempSync(join(process.cwd(), ".tmp-session-"));
  const clock = new ControllableClock(1_000_000);
  const windowMon = new ScriptedWindowMonitor();
  const deskMon = new ScriptedDeskMonitor();
  const host = new MemoryProcessHost([
    { pid: 100, name: "chrome.exe" },
    { pid: 200, name: "Discord.exe" },
    { pid: 300, name: "steam.exe" },
    { pid: 400, name: "explorer.exe" },
    { pid: 4, name: "System" },
    { pid: 500, name: "Code.exe" },
  ]);

  const store = createFocusPlugStore(dir);
  const inner = createProcessKiller({
    host,
    getAllowlistMatchers: () => flattenEnabledMatchers(store.loadAllowlist()),
  });
  const killer: ProcessKiller = {
    kill: async (matchers: string[]) => {
      killCalls.push([...matchers]);
      return inner.kill(matchers);
    },
  };

  const runtime = await createSessionRuntime({
    userDataDir: dir,
    store,
    windowMonitor: windowMon,
    deskMonitor: deskMon,
    killer,
    now: clock.now,
    tickIntervalMs: 0,
  });
  runtime.start();
  await runtime.flush();

  const snapshotStep = async (id: string, title: string): Promise<void> => {
    await runtime.flush();
    const running = (await host.list()).map((proc) => `${proc.name}#${proc.pid}`);
    steps.push({
      id,
      title,
      state: runtime.getState(),
      policyTypes: runtime.policyEvents.map((event) => event.type),
      logTail: runtime.getLog().slice(0, 8).map((event) => ({
        kind: event.kind,
        detail: event.detail,
      })),
      running,
      killedPids: [...host.killed],
    });
  };

  const world = async (focus: FocusSnapshot, desk: DeskSnapshot): Promise<void> => {
    windowMon.emit(focus);
    deskMon.emit(desk);
    await runtime.flush();
  };

  // --- Observe only (session OFF) ---
  await world(discordFocus(clock.ms), atDesk(clock.ms));
  await snapshotStep("observe-off", "Session OFF + Discord focus");
  {
    const state = runtime.getState();
    check("session off does not arm countdown", state.countdownSec === 0 && !state.sessionActive, JSON.stringify(state));
    check("session off decision is IDLE", state.decision === "IDLE", state.decision + " · " + state.detail);
    check("observe-only does not kill Discord", !host.killed.has(200), `killed=${[...host.killed]}`);
    check("no ProcessKiller calls while observing", killCalls.length === 0, JSON.stringify(killCalls));
  }

  // --- 1. Start session on Docs/Chrome ---
  clock.advance(250);
  await world(chromeFocus(clock.ms), atDesk(clock.ms));
  const started = await runtime.sessionStart();
  await snapshotStep("start-docs", "Start session on Chrome/Docs at desk");
  check("1. sessionActive after start", started.sessionActive, JSON.stringify(started));
  check("1. Chrome/Docs matchedAllow", started.focus?.matchedAllow === true && started.focus.matchedBlock === false, JSON.stringify(started.focus));
  check("1. decision ON_TASK", started.decision === "ON_TASK", `${started.decision} · ${started.detail}`);
  check("1. countdown idle", started.countdownSec === 0, String(started.countdownSec));
  check("1. desk at_desk", started.desk?.label === "at_desk", JSON.stringify(started.desk));
  check("1. Discord still running before violation", !host.killed.has(200), `killed=${[...host.killed]}`);

  // --- 2–3. Discord distraction + countdown ---
  clock.advance(250);
  await world(discordFocus(clock.ms), atDesk(clock.ms));
  await snapshotStep("discord-countdown", "Discord focus starts countdown");
  {
    const state = runtime.getState();
    check("2. matchedBlock Discord", state.focus?.matchedBlock === true && state.focus.blockEntryId === "discord", JSON.stringify(state.focus));
    check("3. decision DISTRACTED", state.decision === "DISTRACTED", `${state.decision} · ${state.detail}`);
    check("3. countdown remaining equals fuse (10s)", state.countdownSec === 10, String(state.countdownSec));
    check("3. start_countdown emitted", runtime.policyEvents.some((event) => event.type === "start_countdown"), runtime.policyEvents.map((event) => event.type).join(","));
    const start = runtime.policyEvents.find((event) => event.type === "start_countdown");
    check(
      "3. start_countdown reason is blocked_focus",
      start?.type === "start_countdown" && start.reason === "blocked_focus",
      JSON.stringify(start),
    );
    check("3. Discord not killed during countdown", !host.killed.has(200), `killed=${[...host.killed]}`);
  }

  clock.advance(4000);
  await runtime.tick();
  {
    const state = runtime.getState();
    check("3b. countdown remaining after 4s is 6", state.countdownSec === 6, String(state.countdownSec));
    check("3b. still DISTRACTED before fuse end", state.decision === "DISTRACTED", state.decision);
    check("3b. Discord still alive at T-6s", !host.killed.has(200), `killed=${[...host.killed]}`);
  }

  // --- 4. Kill fires ---
  clock.advance(6000);
  await runtime.tick();
  await snapshotStep("kill-discord", "Countdown elapsed → kill Discord");
  {
    const state = runtime.getState();
    check("4. countdown cleared after kill", state.countdownSec === 0, String(state.countdownSec));
    check("4. policy emitted kill", runtime.policyEvents.some((event) => event.type === "kill"), runtime.policyEvents.map((event) => event.type).join(","));
    const killEvent = [...runtime.policyEvents].reverse().find((event) => event.type === "kill");
    check(
      "4. kill targets include Discord process",
      killEvent?.type === "kill" && killEvent.targets.some((target) => target.toLowerCase().includes("discord")),
      JSON.stringify(killEvent),
    );
    check("4. Discord.exe pid 200 terminated", host.killed.has(200), `killed=${[...host.killed]} running=${(await host.list()).map((p) => p.name)}`);
    check("4. chrome.exe study process still running", !host.killed.has(100), `killed=${[...host.killed]}`);
    check("4. Code.exe still running", !host.killed.has(500), `killed=${[...host.killed]}`);
    check("4. explorer.exe still running", !host.killed.has(400), `killed=${[...host.killed]}`);
    check("4. System pid 4 not killed", !host.killed.has(4), `killed=${[...host.killed]}`);
    check(
      "4. blocked-focus kill did not require steam (foreground target only)",
      !host.killed.has(300),
      `steam killed early? killed=${[...host.killed]}`,
    );
    const log = runtime.getLog();
    check("4. session log recorded kill", log.some((event) => event.kind === "kill"), JSON.stringify(log.slice(0, 6)));
  }

  // --- 5. Return → unlock ---
  clock.advance(250);
  await world(chromeFocus(clock.ms), atDesk(clock.ms));
  await snapshotStep("return-unlock", "Return to Chrome/Docs + at_desk");
  {
    const state = runtime.getState();
    check("5. decision ON_TASK after return", state.decision === "ON_TASK", `${state.decision} · ${state.detail}`);
    check("5. countdown 0 after unlock", state.countdownSec === 0, String(state.countdownSec));
    check("5. policy emitted unlock", runtime.policyEvents.some((event) => event.type === "unlock"), runtime.policyEvents.map((event) => event.type).join(","));
    check("5. chrome still running after unlock", !host.killed.has(100), `killed=${[...host.killed]}`);
  }

  // --- 6. Demo Kill instant path ---
  host.seed.push({ pid: 202, name: "discord.exe" });
  const demo = await runtime.demoKill();
  await snapshotStep("demo-kill", "Demo Kill instant blocklist termination");
  check("6. Demo Kill returned a result", demo.killed.length > 0 || demo.errors.length > 0, namesOf(demo));
  check("6. Demo Kill terminated discord stand-in", host.killed.has(202) || killedHas(demo, "discord"), `killed pids=${[...host.killed]} result=${namesOf(demo)}`);
  check("6. Demo Kill terminated steam (enabled blocklist)", host.killed.has(300) || killedHas(demo, "steam"), `killed pids=${[...host.killed]} result=${namesOf(demo)}`);
  check("6. Demo Kill did not kill chrome", !host.killed.has(100) && !killedHas(demo, "chrome.exe"), namesOf(demo));
  check("6. Demo Kill did not kill Code", !host.killed.has(500), `killed=${[...host.killed]}`);
  check("6. Demo Kill log event", runtime.getLog().some((event) => event.kind === "kill" && event.detail.toLowerCase().includes("demo")), JSON.stringify(runtime.getLog().filter((event) => event.kind === "kill")));
  check("6. countdown remains 0 after Demo Kill", runtime.getState().countdownSec === 0, String(runtime.getState().countdownSec));

  // --- Desk-away kills running blocklist only ---
  host.seed.push({ pid: 600, name: "VALORANT.exe" });
  host.seed.push({ pid: 301, name: "steam.exe" });
  clock.advance(250);
  await world(chromeFocus(clock.ms), awayDesk(clock.ms));
  {
    const state = runtime.getState();
    check("desk-away decision AWAY", state.decision === "AWAY", `${state.decision} · ${state.detail}`);
    check("desk-away starts countdown", state.countdownSec === 10, String(state.countdownSec));
    check("desk-away does not kill immediately", !host.killed.has(600), `killed=${[...host.killed]}`);
  }
  clock.advance(10_000);
  await runtime.tick();
  await snapshotStep("desk-away-kill", "High-conf away → kill running blocklist");
  check("desk-away killed VALORANT", host.killed.has(600), `killed=${[...host.killed]} running=${(await host.list()).map((p) => p.name)}`);
  check("desk-away killed steam respawn", host.killed.has(301), `killed=${[...host.killed]}`);
  check("desk-away never killed chrome study PC", !host.killed.has(100), `killed=${[...host.killed]}`);

  // --- Uncertain desk: no desk-only kill ---
  host.seed.push({ pid: 302, name: "steam.exe" });
  clock.advance(250);
  await world(chromeFocus(clock.ms), uncertainDesk(clock.ms));
  clock.advance(10_000);
  await runtime.tick();
  await snapshotStep("uncertain-hold", "Uncertain desk must not desk-only kill");
  check("uncertain desk does not kill steam", !host.killed.has(302), `killed=${[...host.killed]}`);
  check(
    "uncertain desk is not AWAY-enforced",
    runtime.getState().decision !== "AWAY",
    `${runtime.getState().decision} · ${runtime.getState().detail}`,
  );

  host.seed.push({ pid: 303, name: "steam.exe" });
  clock.advance(250);
  await world(chromeFocus(clock.ms), lowConfAway(clock.ms));
  clock.advance(10_000);
  await runtime.tick();
  check("low-confidence away does not kill", !host.killed.has(303), `killed=${[...host.killed]}`);

  // --- Session stop observe-only again ---
  await runtime.sessionStop();
  host.seed.push({ pid: 203, name: "Discord.exe" });
  clock.advance(250);
  await world(discordFocus(clock.ms), atDesk(clock.ms));
  clock.advance(10_000);
  await runtime.tick();
  check("stopped session does not kill new Discord", !host.killed.has(203), `killed=${[...host.killed]}`);
  check("stopped session is IDLE observe-only", runtime.getState().decision === "IDLE" && !runtime.getState().sessionActive, JSON.stringify(runtime.getState()));

  // --- Sentinel never forwarded ---
  check(
    "ProcessKiller never received *blocklist* sentinel",
    killCalls.every((call) => !call.includes(ALL_BLOCKLIST_TARGET)),
    JSON.stringify(killCalls),
  );

  // --- IPC coverage ---
  const channels = new Set(runtime.ipcTrace.map((item) => item.channel));
  for (const channel of Object.values(IPC_PUSH)) {
    check(`IPC push ${channel}`, channels.has(channel), [...channels].join(", "));
  }

  // --- Persist log ---
  const reloaded = createFocusPlugStore(dir);
  const persisted = reloaded.loadSessionLog();
  check("session log persisted to disk", persisted.length > 0, `count=${persisted.length}`);
  check(
    "persisted log includes session start",
    persisted.some((event) => event.kind === "session" && event.detail.toLowerCase().includes("started")),
    JSON.stringify(persisted.filter((event) => event.kind === "session")),
  );
  check(
    "persisted log includes Demo Kill",
    persisted.some((event) => event.kind === "kill" && event.detail.toLowerCase().includes("demo")),
    JSON.stringify(persisted.filter((event) => event.kind === "kill")),
  );

  const settingsRoundtrip = reloaded.loadSettings();
  check("settings persist with defaults", settingsRoundtrip.countdownSec === 10 && settingsRoundtrip.strictMode === true, JSON.stringify(settingsRoundtrip));

  runtime.dispose();

  const report: GauntletReport = {
    ranAt: new Date().toISOString(),
    bar: BAR,
    verdict: assertions.every((item) => item.pass) ? "PASS" : "FAIL",
    host: `${process.platform} ${process.arch}`,
    node: process.version,
    killCalls,
    demoKill: demo,
    ipcChannels: [...channels],
    persistedLogKinds: [...new Set(persisted.map((event) => event.kind))],
    steps,
    assertions,
  };

  if (writeEvidence) {
    writeGauntletEvidence(report);
  }

  return report;
}

function writeGauntletEvidence(report: GauntletReport): void {
  const here = dirname(fileURLToPath(import.meta.url));
  const evidenceDir = join(here, "evidence");
  mkdirSync(evidenceDir, { recursive: true });
  writeFileSync(join(evidenceDir, "gauntlet-run.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(join(here, "GOLDEN_PATH.md"), renderGoldenPathMarkdown(report), "utf8");
  writeFileSync(join(here, "GAUNTLET_EVIDENCE.md"), renderEvidenceMarkdown(report), "utf8");
}

function renderGoldenPathMarkdown(report: GauntletReport): string {
  const failed = report.assertions.filter((item) => !item.pass);
  const lines: string[] = [
    "# Session-wiring golden path",
    "",
    "## Inspectable bar",
    "",
    ...report.bar.map((item) => `- ${item}`),
    "",
    `## Verdict: **${report.verdict}**`,
    "",
    `- Ran: ${report.ranAt}`,
    `- Host: ${report.host} · Node ${report.node}`,
    `- Assertions: ${report.assertions.filter((item) => item.pass).length}/${report.assertions.length}`,
    `- IPC push channels seen: ${report.ipcChannels.join(", ") || "(none)"}`,
    `- ProcessKiller calls: ${report.killCalls.length}`,
    `- Demo Kill: ${report.demoKill ? namesOf(report.demoKill) : "(none)"}`,
    "",
    "## Checklist",
    "",
    "| # | Gate | Result | Detail |",
    "| --- | --- | --- | --- |",
  ];
  for (const assertion of report.assertions) {
    const mark = assertion.pass ? "PASS" : "FAIL";
    lines.push(`| | ${escapeTable(assertion.name)} | ${mark} | ${escapeTable(assertion.detail)} |`);
  }
  lines.push("", "## Steps", "");
  for (const step of report.steps) {
    lines.push(`### ${step.id} — ${step.title}`);
    lines.push("");
    lines.push("```json");
    lines.push(
      JSON.stringify(
        {
          decision: step.state.decision,
          detail: step.state.detail,
          sessionActive: step.state.sessionActive,
          countdownSec: step.state.countdownSec,
          focus: step.state.focus,
          desk: step.state.desk,
          running: step.running,
          killedPids: step.killedPids,
        },
        null,
        2,
      ),
    );
    lines.push("```");
    lines.push("");
  }
  if (failed.length > 0) {
    lines.push("## Failures", "");
    for (const item of failed) {
      lines.push(`- **${item.name}**: ${item.detail}`);
    }
    lines.push("");
  }
  lines.push("## How to re-run", "");
  lines.push("```bash");
  lines.push("npx vitest run src/main/session");
  lines.push("npx tsx --tsconfig tsconfig.node.json src/main/session/gauntlet.ts");
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function renderEvidenceMarkdown(report: GauntletReport): string {
  return [
    "# Gauntlet evidence (session-wiring)",
    "",
    `Last run: **${report.verdict}** (${report.ranAt}) on ${report.host}, Node ${report.node}.`,
    "",
    "Command:",
    "",
    "```bash",
    "npx vitest run src/main/session",
    "```",
    "",
    "This VM is not a Windows desktop with Discord. The harness injects:",
    "",
    "- `ScriptedWindowMonitor` (FocusSnapshot: Chrome/Docs ↔ Discord)",
    "- `ScriptedDeskMonitor` (at_desk / away / uncertain)",
    "- `MemoryProcessHost` (chrome, Discord, steam, explorer, Code, System, VALORANT)",
    "- `ProcessKiller` via `createProcessKiller({ host })`",
    "- `PolicyEngine.step` (pure, un-rewritten)",
    "",
    `Machine-readable dump: \`src/main/session/evidence/gauntlet-run.json\`.`,
    `Checklist: \`src/main/session/GOLDEN_PATH.md\`.`,
    "",
    failedBlock(report),
  ].join("\n");
}

function failedBlock(report: GauntletReport): string {
  const failed = report.assertions.filter((item) => !item.pass);
  if (failed.length === 0) {
    return "All assertions passed.\n";
  }
  return `Failures:\n\n${failed.map((item) => `- ${item.name}: ${item.detail}`).join("\n")}\n`;
}

function escapeTable(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

async function mainCli(): Promise<void> {
  const report = await runGoldenPathGauntlet({ writeEvidence: true });
  const passed = report.assertions.filter((item) => item.pass).length;
  console.log(`${report.verdict} ${passed}/${report.assertions.length}`);
  if (report.verdict !== "PASS") {
    for (const item of report.assertions.filter((entry) => !entry.pass)) {
      console.error(`FAIL ${item.name}: ${item.detail}`);
    }
    process.exitCode = 1;
  }
}

const isCli = process.argv[1]?.replaceAll("\\", "/").endsWith("/session/gauntlet.ts");
if (isCli) {
  void mainCli();
}
