/**
 * What the window sensor cannot see.
 *
 * FocusPlug decides on-task from the foreground window using substring rules
 * over the allow/blocklists. That works when the app is the signal — Discord is
 * always a distraction — and it cannot work when the app is identical on both
 * sides: a lecture and a prank video are both `chrome.exe`, and the only thing
 * separating them is the title.
 *
 * This scores exactly that. Every row is a window title labelled on_task or
 * distracted, where the process alone is not enough to decide. The number it
 * prints is a measurement of the *current* matcher, not of a model.
 *
 *   npm run eval:titles
 *
 * The dataset is generated, not observed — see datasets/window-titles.csv.
 */

import { readFileSync } from "node:fs";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "../src/shared/defaults.ts";
import { findMatchingEntry } from "../src/main/window/match.ts";

interface Row {
  title: string;
  process: string;
  label: "on_task" | "distracted";
}

/** Minimal RFC4180-ish reader: the file is ours and has three columns. */
function parseCsv(text: string): Row[] {
  const rows: Row[] = [];
  const lines = text.split(/\r?\n/).slice(1);
  for (const line of lines) {
    if (line.trim().length === 0) {
      continue;
    }
    const cells: string[] = [];
    let cell = "";
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (ch === '"') {
          quoted = false;
        } else {
          cell += ch;
        }
      } else if (ch === '"') {
        quoted = true;
      } else if (ch === ",") {
        cells.push(cell);
        cell = "";
      } else {
        cell += ch;
      }
    }
    cells.push(cell);
    const [title, process, label] = cells;
    if (title && process && (label === "on_task" || label === "distracted")) {
      rows.push({ title, process, label });
    }
  }
  return rows;
}

type Verdict = "on_task" | "distracted" | "unknown";

/** The live rule, in the same order the policy applies it. */
function decide(row: Row): Verdict {
  if (findMatchingEntry(DEFAULT_BLOCKLIST, row.process, row.title)) {
    return "distracted";
  }
  if (findMatchingEntry(DEFAULT_ALLOWLIST, row.process, row.title)) {
    return "on_task";
  }
  return "unknown";
}

function main(): void {
  const path = process.argv[2] ?? "datasets/window-titles.csv";
  const rows = parseCsv(readFileSync(path, "utf8"));
  if (rows.length === 0) {
    console.error(`no rows in ${path}`);
    process.exit(1);
  }

  let right = 0;
  let wrong = 0;
  let unknown = 0;
  const missed: Row[] = [];
  const perProcess = new Map<string, { n: number; right: number }>();

  for (const row of rows) {
    const verdict = decide(row);
    const stat = perProcess.get(row.process) ?? { n: 0, right: 0 };
    stat.n += 1;
    if (verdict === "unknown") {
      unknown += 1;
    } else if (verdict === row.label) {
      right += 1;
      stat.right += 1;
    } else {
      wrong += 1;
      if (row.label === "distracted") {
        missed.push(row);
      }
    }
    perProcess.set(row.process, stat);
  }

  const pct = (n: number): string => `${((n / rows.length) * 100).toFixed(1)}%`;
  console.log("WINDOW-TITLE EVAL — the current substring matcher, not a model");
  console.log(`  ${rows.length} labelled titles from ${path}\n`);
  console.log(`  correct    ${right}  ${pct(right)}`);
  console.log(`  wrong      ${wrong}  ${pct(wrong)}`);
  console.log(`  no opinion ${unknown}  ${pct(unknown)}  (neither list matched)\n`);

  console.log("  by process — where the app alone decides, and where it cannot:");
  const sorted = [...perProcess.entries()].sort((a, b) => b[1].n - a[1].n);
  for (const [name, stat] of sorted.slice(0, 8)) {
    const rate = ((stat.right / stat.n) * 100).toFixed(1);
    console.log(`    ${name.padEnd(18)} ${String(stat.n).padStart(4)} titles   ${rate.padStart(5)}% right`);
  }

  console.log(`\n  ${missed.length} distractions were called on task. The first few:`);
  for (const row of missed.slice(0, 6)) {
    const clipped = row.title.length > 68 ? `${row.title.slice(0, 68)}…` : row.title;
    console.log(`    [${row.process}] ${clipped}`);
  }
  console.log(
    "\n  These are the ones that matter: the app is allowlisted, so the session\n" +
      "  reads ON TASK and nothing is ever enforced. A title-aware signal is the\n" +
      "  gap this measures — it is not implemented, and this number is the case for it.",
  );
}

main();
