import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The shared forecast core must run unchanged in Electron main, the React
 * console, and a plain-browser Vite preview. This test enforces that at the
 * source level: no Node/Electron module imports, no browser globals, in any
 * non-test `.ts` file under `src/shared/forecast/`.
 *
 * Mechanism (so a green run means something): every import/require/dynamic-
 * import specifier is extracted and checked against the forbidden module
 * list, and comment/string-stripped source is scanned for `window` /
 * `document` identifier usage. The checker is itself verified against
 * positive controls below — if it ever stops flagging a smuggled
 * `node:fs` import, this file fails.
 */

const FORBIDDEN_MODULES = ["fs", "path", "electron", "child_process", "os", "net", "http", "https"];

const forecastDir = dirname(fileURLToPath(import.meta.url));

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

function violationsIn(source: string): string[] {
  const violations: string[] = [];
  for (const spec of importSpecifiers(source)) {
    if (isForbiddenSpecifier(spec)) {
      violations.push(`forbidden import "${spec}"`);
    }
  }
  for (const use of browserGlobalUses(source)) {
    violations.push(`browser global "${use}"`);
  }
  return violations;
}

describe("forecast core purity", () => {
  it("scans the real core files (guard against silent renames)", () => {
    const names = sourceFiles(forecastDir).map((file) => file.split("/").pop());
    for (const required of [
      "types.ts",
      "hash.ts",
      "ring.ts",
      "features.ts",
      "labels.ts",
      "model.ts",
      "escalate.ts",
      "index.ts",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("no forecast source imports fs/path/electron or touches window/document", () => {
    for (const file of sourceFiles(forecastDir)) {
      const source = readFileSync(file, "utf8");
      expect({ file, violations: violationsIn(source) }).toEqual({ file, violations: [] });
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
  });

  it("the checker ignores prose and strings (no false positives)", () => {
    expect(violationsIn("// seconds on the current window")).toEqual([]);
    expect(violationsIn('const detail = "window not on allowlist";')).toEqual([]);
    expect(violationsIn("const windowTitleHash = 1;")).toEqual([]);
    expect(violationsIn('import { titleHash } from "./hash";')).toEqual([]);
  });
});
