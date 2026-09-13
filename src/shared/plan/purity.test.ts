import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The Focus Plan core must run unchanged in Electron main, the React console,
 * and a plain-browser Vite preview. That is what `npm run plan:stills` uses:
 * the real cards, rendered in a plain browser off the named fixtures, with no
 * Electron anywhere. It is also what would let `demo/` import this core, which
 * it does not do today — the demo is the forecast's scripted stream, and the
 * fence is kept so that stays a choice rather than a rewrite.
 *
 * This is a verbatim adaptation of `src/shared/forecast/purity.test.ts`: same
 * forbidden-module list, same comment/string stripping, and the same POSITIVE
 * CONTROLS, so a green run means the checker still works rather than that it
 * quietly stopped looking.
 *
 * Two fences on top of the forecast's:
 *   - `Date` is forbidden. `day` and `hour` are stamped in main at write time,
 *     precisely so the estimator is testable without clock injection.
 *   - nothing here may reach for the enforcement path: no `../policy`, nothing
 *     under `main`, nothing named `kill`.
 */

const FORBIDDEN_MODULES = ["fs", "path", "electron", "child_process", "os", "net", "http", "https"];

/** Focus Plan is a coaching layer. It has no business near the kill path. */
const FORBIDDEN_PATTERNS = [/(^|\/)policy(\/|$)/, /(^|\/)main(\/|$)/, /kill/i];

const planDir = dirname(fileURLToPath(import.meta.url));

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** All static import / export-from / require / dynamic import specifiers. */
function importSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /import\s+[^"'`]*?from\s*["'`]([^"'`]+)["'`]/g,
    /import\s*["'`]([^"'`]+)["'`]/g,
    /export\s+[^"'`]*?from\s*["'`]([^"'`]+)["'`]/g,
    /require\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
    /import\s*\(\s*["'`]([^"'`]+)["'`]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const spec = match[1];
      if (spec !== undefined) {
        specifiers.push(spec);
      }
    }
  }
  return specifiers;
}

function isForbiddenSpecifier(spec: string): boolean {
  return FORBIDDEN_MODULES.some(
    (name) =>
      spec === name ||
      spec === `node:${name}` ||
      spec.startsWith(`${name}/`) ||
      spec.startsWith(`node:${name}/`),
  );
}

function isEnforcementSpecifier(spec: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(spec));
}

/** Strip comments and string/template literals so prose never false-positives. */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/`(?:\\.|[^`\\])*`/g, '""')
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/'(?:\\.|[^'\\])*'/g, '""');
}

function browserGlobalUses(source: string): string[] {
  const stripped = stripCommentsAndStrings(source);
  return [...stripped.matchAll(/\b(window|document)\b/g)].map((match) => match[0]);
}

/** The clock fence: `day` and `hour` are stamped in main, never derived here. */
function clockUses(source: string): string[] {
  const stripped = stripCommentsAndStrings(source);
  return [...stripped.matchAll(/\b(Date|performance)\b/g)].map((match) => match[0]);
}

function violationsIn(source: string): string[] {
  const violations: string[] = [];
  for (const spec of importSpecifiers(source)) {
    if (isForbiddenSpecifier(spec)) {
      violations.push(`forbidden import "${spec}"`);
    }
    if (isEnforcementSpecifier(spec)) {
      violations.push(`enforcement-path import "${spec}"`);
    }
  }
  for (const use of browserGlobalUses(source)) {
    violations.push(`browser global "${use}"`);
  }
  for (const use of clockUses(source)) {
    violations.push(`clock global "${use}"`);
  }
  return violations;
}

describe("focus plan core purity", () => {
  it("scans the real core files (guard against silent renames)", () => {
    const names = sourceFiles(planDir).map((file) => file.split("/").pop());
    for (const required of [
      "types.ts",
      "constants.ts",
      "drift.ts",
      "survival.ts",
      "trend.ts",
      "ledger.ts",
      "estimate.ts",
      "progression.ts",
      "debrief.ts",
      "revise.ts",
      "copy.ts",
      "index.ts",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("no plan source imports fs/path/electron, touches window/document, or reads a clock", () => {
    for (const file of sourceFiles(planDir)) {
      const source = readFileSync(file, "utf8");
      expect({ file, violations: violationsIn(source) }).toEqual({ file, violations: [] });
    }
  });

  it("no plan source can reach the enforcement path", () => {
    for (const file of sourceFiles(planDir)) {
      const source = readFileSync(file, "utf8");
      for (const spec of importSpecifiers(source)) {
        expect({ file, spec, enforcement: isEnforcementSpecifier(spec) }).toEqual({
          file,
          spec,
          enforcement: false,
        });
      }
    }
  });

  it("the checker actually flags forbidden imports (positive controls)", () => {
    expect(violationsIn('import { readFileSync } from "node:fs";')).toContain(
      'forbidden import "node:fs"',
    );
    expect(violationsIn('import { join } from "path";')).toContain('forbidden import "path"');
    expect(violationsIn('import { app } from "electron";')).toContain(
      'forbidden import "electron"',
    );
    expect(violationsIn('const fs = require("fs");')).toContain('forbidden import "fs"');
    expect(violationsIn('const p = import("node:path");')).toContain(
      'forbidden import "node:path"',
    );
    expect(violationsIn('export { x } from "fs/promises";')).toContain(
      'forbidden import "fs/promises"',
    );
    expect(violationsIn("const w = window.innerWidth;")).toContain('browser global "window"');
    expect(violationsIn("document.title = t;")).toContain('browser global "document"');
    expect(violationsIn("const now = Date.now();")).toContain('clock global "Date"');
    expect(violationsIn("const t = performance.now();")).toContain('clock global "performance"');
    expect(violationsIn('import { stepPolicy } from "../policy/engine";')).toContain(
      'enforcement-path import "../policy/engine"',
    );
    expect(violationsIn('import { runKill } from "../../main/kill/taskkill";')).toContain(
      'enforcement-path import "../../main/kill/taskkill"',
    );
  });

  it("the checker ignores prose and strings (no false positives)", () => {
    expect(violationsIn("// the policy engine decides kills, not this file")).toEqual([]);
    expect(violationsIn('const detail = "started with a blocked app already open";')).toEqual([]);
    expect(violationsIn("const dayKey = 1;")).toEqual([]);
    expect(violationsIn('import { holdMinutes } from "./drift";')).toEqual([]);
    expect(violationsIn('import { isDriftedDecision } from "../forecast/labels";')).toEqual([]);
  });
});
