/**
 * demo-seed — fabricate a Focus Plan history so the plan card has something to
 * say on a clean machine, and take it away again afterwards.
 *
 *   npm run demo:seed              # write the seeded ledger
 *   npm run demo:seed -- --settings    # …and pin the filming settings too
 *   npm run demo:unseed            # put everything back
 *
 * WHY THIS EXISTS. Focus Plan's whole claim is that it measures YOU: the card
 * reads "20 minutes of work, then 4 off, because your last three sessions
 * drifted at 19, 22 and 20 minutes". On a fresh install there are no sessions,
 * so the card correctly falls back to "start with 25 minutes, then 5 off —
 * that is the pomodoro default, not a reading of you", and the best beat in
 * the feature is unfilmable. Sitting through three real 25-minute rounds on
 * camera is not an option the day before a deadline.
 *
 * WHAT IT WILL NOT DO. It will not invent a shape the estimator has never
 * seen: every round comes from `src/shared/plan/fixtures.ts`, the same named
 * ledgers the estimator's own unit tests and the stills scripts read, slid
 * forward onto real local days. And it will not let the result pass for
 * measurement. The ledger it writes carries a `seed` stamp that
 * `reviveLedger` preserves through every rewrite, `PlanRecorder` prints that
 * stamp into the app's own Log at start-up and again for every round armed on
 * top of it, this command prints it loudly here, and `docs/DEMO-TODAY.md`
 * makes saying it out loud step one of the film.
 *
 * The one thing a seeding tool must never do is delete something real, so:
 * an existing ledger is copied to `focus-plan.pre-demo-seed.json` before the
 * first seed, `--undo` restores it, and `--undo` refuses to remove a ledger
 * that carries no seed stamp.
 */

import { copyFileSync, existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AppSettings } from "../src/shared/ipc.ts";
import { seedNotice } from "../src/shared/plan/copy.ts";
import { FIXTURES } from "../src/shared/plan/fixtures.ts";
import { reviveLedger } from "../src/shared/plan/ledger.ts";
import {
  PLAN_LEDGER_VERSION,
  type FocusPlanLedger,
  type PlanRound,
  type PlanSeedStamp,
} from "../src/shared/plan/types.ts";
import { localDayStamp } from "../src/main/focusplan/ledger.ts";
import {
  PLAN_LEDGER_FILE,
  SETTINGS_FILE,
  normalizeSettings,
  planLedgerPath,
  readUserDataJson,
  settingsPath,
  writeUserDataJson,
} from "../src/main/store/appStore.ts";

/* ── what a seeded ledger says about itself ──────────────────────────── */

const SEED_SOURCE = "npm run demo:seed";
const SEED_NOTE =
  "Fabricated demo history from src/shared/plan/fixtures.ts, written for filming. " +
  "Nothing here was measured on this machine and no student produced it.";

/** Freshly seeded rounds end this long ago, so the setup page's debrief — which
 *  is time-boxed to PLAN_DEBRIEF_FRESH_MS — is already on screen at launch. */
const NEWEST_ENDED_MS_AGO = 90_000;

/* ── presets, all of them real fixture shapes ────────────────────────── */

interface Preset {
  id: string;
  rounds: readonly PlanRound[];
  /** What the card is expected to do with it, for the console report. */
  blurb: string;
}

const PRESETS: readonly Preset[] = [
  {
    id: "measured",
    rounds: FIXTURES.drift19_22_20.rounds,
    blurb: "3 rounds over 3 days, drifting at 19, 22 and 20 — a settled median, no trend claim.",
  },
  {
    id: "improving",
    rounds: FIXTURES.improving.rounds,
    blurb: "20 rounds over 10 days, 12 → 24 minutes — the one shape where every trend gate passes.",
  },
  {
    id: "stretch",
    rounds: FIXTURES.stretchReady.rounds,
    blurb: "6 rounds, median 18, the newest two held clean — the card offers a stretch.",
  },
  {
    id: "mixed",
    rounds: FIXTURES.mixedRounds.rounds,
    blurb: "5 rounds, two of them ineligible — the 'Why this?' table with its greyed rows.",
  },
];

function presetNames(): string {
  return PRESETS.map((preset) => preset.id).join(" | ");
}

/* ── userData, exactly where Electron would put it ───────────────────── */

/** `app.getName()` reads package.json `name`; nothing calls `app.setName`. */
const APP_NAME = "focusplug";

/**
 * `app.getPath("userData")` is `join(app.getPath("appData"), app.getName())`.
 * Reproduced rather than imported, because importing Electron to read one
 * path would need Electron's own runtime.
 */
export function defaultUserDataDir(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    return join(env["APPDATA"] ?? join(home, "AppData", "Roaming"), APP_NAME);
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support", APP_NAME);
  }
  return join(env["XDG_CONFIG_HOME"] ?? join(home, ".config"), APP_NAME);
}

/* ── building the ledger ─────────────────────────────────────────────── */

/**
 * Slide fixture rounds forward so the newest ended `NEWEST_ENDED_MS_AGO` ago,
 * keeping every gap — and therefore the day spread the trend gates read — as
 * the fixture wrote it. `day` and `hour` are re-stamped through the SAME
 * `localDayStamp` main uses at write time, so the seeded rows are shaped
 * exactly like rows the recorder would have produced.
 */
export function rebaseRounds(rounds: readonly PlanRound[], nowMs: number): PlanRound[] {
  const newest = rounds.reduce((max, round) => Math.max(max, round.endedAt), 0);
  if (newest === 0) {
    return [];
  }
  const delta = nowMs - NEWEST_ENDED_MS_AGO - newest;
  return rounds
    .map((round) => {
      const startedAt = round.startedAt + delta;
      const stamp = localDayStamp(startedAt);
      return {
        ...round,
        startedAt,
        endedAt: round.endedAt + delta,
        day: stamp.day,
        hour: stamp.hour,
        // The renderer's own `<plan startedAtMs>-<segment index>` shape, so a
        // seeded round can never collide with a live one.
        roundKey: `${startedAt}-${round.round}`,
        driftsSec: [...round.driftsSec],
      };
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

export function buildSeedLedger(preset: Preset, nowMs: number): FocusPlanLedger {
  const rounds = rebaseRounds(preset.rounds, nowMs);
  const seed: PlanSeedStamp = {
    source: SEED_SOURCE,
    writtenAt: nowMs,
    rounds: rounds.length,
    note: SEED_NOTE,
  };
  return { v: PLAN_LEDGER_VERSION, lifetimeRounds: rounds.length, rounds, seed };
}

/* ── arguments ───────────────────────────────────────────────────────── */

interface Options {
  dir: string;
  preset: Preset;
  undo: boolean;
  settings: boolean;
  dryRun: boolean;
}

function parseArgs(argv: readonly string[]): Options {
  let dir = process.env["FOCUSPLUG_USER_DATA"] ?? defaultUserDataDir();
  let presetId = "measured";
  let undo = false;
  let settings = false;
  let dryRun = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--undo" || arg === "--remove" || arg === "--restore") {
      undo = true;
    } else if (arg === "--settings") {
      settings = true;
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--dir") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error("--dir needs a path");
      }
      dir = next;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--dir=")) {
      dir = arg.slice("--dir=".length);
    } else if (arg === "--preset") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new Error(`--preset needs one of: ${presetNames()}`);
      }
      presetId = next;
      i += 1;
    } else if (arg !== undefined && arg.startsWith("--preset=")) {
      presetId = arg.slice("--preset=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg !== undefined && arg.length > 0) {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const preset = PRESETS.find((candidate) => candidate.id === presetId);
  if (preset === undefined) {
    throw new Error(`Unknown preset "${presetId}". Try one of: ${presetNames()}`);
  }
  return { dir, preset, undo, settings, dryRun };
}

function printHelp(): void {
  console.log(`demo-seed — seed a Focus Plan history for filming, and take it back off.

  npm run demo:seed                      seed the default ledger
  npm run demo:seed -- --preset improving
  npm run demo:seed -- --settings        also pin the filming settings
  npm run demo:seed -- --dry-run         print what it would do, write nothing
  npm run demo:unseed                    restore whatever was there before

Options
  --dir <path>     userData directory (default: Electron's own, per platform)
  --preset <id>    ${presetNames()}
  --settings       set deskModelId=custom, pauseOnAwayEnabled=on, and the rest
                   of the pre-flight from docs/DEMO-TODAY.md
  --dry-run        report only
  --undo           restore the pre-seed ledger and settings

Environment
  FOCUSPLUG_USER_DATA   overrides the userData directory

Presets
${PRESETS.map((preset) => `  ${preset.id.padEnd(10)} ${preset.blurb}`).join("\n")}`);
}

/* ── settings, pinned for the film ───────────────────────────────────── */

/**
 * The pre-flight `docs/DEMO-TODAY.md` depends on, applied to the settings file
 * rather than clicked on camera — the Settings desk-model card ships internal
 * copy ("Timmy's drop-in") that should not be on film.
 *
 * `deskModelId: "custom"` is the load-bearing one: the away pause is gated on
 * the trained presence head by `deskModelMayPauseOnAway`, so on the shipped
 * BlazeFace detector the clock never stops and the walk-away beat has no
 * ending.
 */
const FILMING_SETTINGS: Partial<AppSettings> = {
  deskModelId: "custom",
  pauseOnAwayEnabled: true,
  webcamEnabled: true,
  strictMode: true,
  countdownSec: 10,
  forecastEnabled: true,
  forecastPrearmEnabled: true,
  focusPlanEnabled: true,
  plugMode: "nudge",
};

/* ── file plumbing ───────────────────────────────────────────────────── */

const LEDGER_BACKUP = "focus-plan.pre-demo-seed.json";
const SETTINGS_BACKUP = "settings.pre-demo-seed.json";

function backUpOnce(from: string, to: string, dryRun: boolean): "copied" | "kept" | "nothing" {
  if (!existsSync(from)) {
    return "nothing";
  }
  if (existsSync(to)) {
    // A second seed must not overwrite the FIRST backup — that one is the only
    // copy of whatever was real.
    return "kept";
  }
  if (!dryRun) {
    copyFileSync(from, to);
  }
  return "copied";
}

function line(): void {
  console.log("─".repeat(72));
}

function banner(title: string): void {
  line();
  console.log(title);
  line();
}

/* ── the two commands ────────────────────────────────────────────────── */

function seed(options: Options): number {
  const ledgerFile = planLedgerPath(options.dir);
  const backupFile = join(options.dir, LEDGER_BACKUP);
  const existing = reviveLedger(readUserDataJson(ledgerFile));
  const alreadySeeded = existing.seed !== undefined;

  const ledger = buildSeedLedger(options.preset, Date.now());
  const backup = alreadySeeded ? "nothing" : backUpOnce(ledgerFile, backupFile, options.dryRun);

  if (!options.dryRun) {
    writeUserDataJson(ledgerFile, ledger);
  }

  banner("SEEDED DEMO HISTORY WRITTEN — THIS IS NOT MEASUREMENT");
  console.log(seedNotice(ledger.seed ?? { source: SEED_SOURCE, writtenAt: 0, rounds: 0, note: SEED_NOTE }));
  console.log("");
  console.log(`  userData   ${options.dir}`);
  console.log(`  ledger     ${PLAN_LEDGER_FILE}${options.dryRun ? "  (dry run — nothing written)" : ""}`);
  console.log(`  preset     ${options.preset.id} — ${options.preset.blurb}`);
  console.log(`  rounds     ${ledger.rounds.length} across ${new Set(ledger.rounds.map((r) => r.day)).size} local days`);
  console.log(`  newest     ${describeNewest(ledger.rounds)}`);
  if (backup === "copied") {
    console.log(`  backup     ${LEDGER_BACKUP} (your real ledger, restored by npm run demo:unseed)`);
  } else if (backup === "kept") {
    console.log(`  backup     ${LEDGER_BACKUP} already exists — left untouched`);
  } else if (alreadySeeded) {
    console.log("  backup     the ledger it replaced was itself seeded, so nothing real was moved");
  } else {
    console.log("  backup     none needed — there was no ledger here");
  }

  const settingsResult = options.settings ? applySettings(options) : reportSettings(options);
  console.log("");
  console.log("Say this on camera, in these words or your own:");
  console.log('  "This history is seeded — I wrote three past sessions in so the plan');
  console.log('   card has something to read. The live round you are about to watch is real."');
  console.log("");
  console.log("Undo with:  npm run demo:unseed");
  line();
  return settingsResult;
}

function describeNewest(rounds: readonly PlanRound[]): string {
  const newest = rounds[rounds.length - 1];
  if (newest === undefined) {
    return "none";
  }
  const held =
    newest.firstDriftSec === null
      ? "ran clean"
      : `drifted at ${Math.round(newest.firstDriftSec / 60)} min`;
  const ago = Math.max(0, Math.round((Date.now() - newest.endedAt) / 1000));
  const at = new Date(newest.startedAt);
  const clock = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  return `${newest.day} ${clock}, ${held}, ended ${ago}s ago (the setup page shows its debrief)`;
}

function applySettings(options: Options): number {
  const file = settingsPath(options.dir);
  const backupFile = join(options.dir, SETTINGS_BACKUP);
  const current = normalizeSettings(readUserDataJson(file) as Partial<AppSettings> | null);
  // There may be no settings.json yet — the store writes one with the defaults
  // on its first load — so the pre-seed state is "the defaults", and that is
  // what gets backed up. Otherwise `--undo` would leave deskModelId pinned to
  // `custom` on a machine that never chose it.
  let backup: "copied" | "kept" | "nothing" = backUpOnce(file, backupFile, options.dryRun);
  if (backup === "nothing") {
    if (!options.dryRun) {
      writeUserDataJson(backupFile, current);
    }
    backup = "copied";
  }
  const next = normalizeSettings({ ...current, ...FILMING_SETTINGS });
  if (!options.dryRun) {
    writeUserDataJson(file, next);
  }
  console.log("");
  console.log(`  settings   ${SETTINGS_FILE} pinned for filming${options.dryRun ? " (dry run)" : ""}`);
  for (const key of Object.keys(FILMING_SETTINGS) as Array<keyof AppSettings>) {
    const was = JSON.stringify(current[key]);
    const now = JSON.stringify(next[key]);
    console.log(`             ${String(key)}: ${was === now ? `${now} (unchanged)` : `${was} → ${now}`}`);
  }
  if (backup === "copied") {
    console.log(`             backup ${SETTINGS_BACKUP}`);
  }
  return 0;
}

/** Read-only: say whether the two settings the film depends on are set. */
function reportSettings(options: Options): number {
  const current = normalizeSettings(
    readUserDataJson(settingsPath(options.dir)) as Partial<AppSettings> | null,
  );
  const custom = current.deskModelId === "custom";
  console.log("");
  console.log("  settings   not touched (pass --settings to pin them)");
  console.log(
    `             deskModelId: ${current.deskModelId}${custom ? "" : "  ← the walk-away beat needs \"custom\": on blazeface the clock never stops"}`,
  );
  console.log(`             pauseOnAwayEnabled: ${current.pauseOnAwayEnabled}`);
  console.log(`             countdownSec: ${current.countdownSec} · strictMode: ${current.strictMode}`);
  return 0;
}

function undo(options: Options): number {
  const ledgerFile = planLedgerPath(options.dir);
  const backupFile = join(options.dir, LEDGER_BACKUP);
  const existing = reviveLedger(readUserDataJson(ledgerFile));

  banner("REMOVING SEEDED DEMO HISTORY");
  console.log(`  userData   ${options.dir}`);

  if (existing.seed === undefined && existsSync(ledgerFile)) {
    console.error(
      `  refused    ${PLAN_LEDGER_FILE} carries no seed stamp, so it is real measured history.\n` +
        "             Nothing was changed. Delete it by hand if you really mean to.",
    );
    line();
    return 1;
  }

  if (existsSync(backupFile)) {
    if (!options.dryRun) {
      copyFileSync(backupFile, ledgerFile);
      rmSync(backupFile, { force: true });
    }
    console.log(`  ledger     restored from ${LEDGER_BACKUP}`);
  } else if (existsSync(ledgerFile)) {
    if (!options.dryRun) {
      rmSync(ledgerFile, { force: true });
    }
    console.log(`  ledger     ${PLAN_LEDGER_FILE} removed (there was nothing here before the seed)`);
  } else {
    console.log(`  ledger     nothing to remove`);
  }

  const settingsBackup = join(options.dir, SETTINGS_BACKUP);
  if (existsSync(settingsBackup)) {
    if (!options.dryRun) {
      copyFileSync(settingsBackup, settingsPath(options.dir));
      rmSync(settingsBackup, { force: true });
    }
    console.log(`  settings   restored from ${SETTINGS_BACKUP}`);
  } else {
    console.log("  settings   no backup to restore (they were never pinned from here)");
  }

  console.log("");
  console.log("The plan card is back to whatever this machine actually measured.");
  line();
  return 0;
}

/* ── entry point ─────────────────────────────────────────────────────── */

function main(): void {
  let options: Options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error("Run with --help for the options.");
    process.exitCode = 1;
    return;
  }
  process.exitCode = options.undo ? undo(options) : seed(options);
}

main();
