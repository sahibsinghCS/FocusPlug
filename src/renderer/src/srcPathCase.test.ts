import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/** Repo `src/` — this file lives at `src/renderer/src/srcPathCase.test.ts`. */
const SRC_ROOT = fileURLToPath(new URL("../../", import.meta.url));

function listSrcFilePaths(srcRoot: string): string[] {
  const files: string[] = [];

  const walk = (absDir: string): void => {
    for (const entry of readdirSync(absDir, { withFileTypes: true })) {
      const abs = join(absDir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (entry.isFile()) {
        files.push(relative(srcRoot, abs).split(sep).join("/"));
      }
    }
  };

  walk(srcRoot);
  return files;
}

function groupsThatDifferOnlyByCase(paths: readonly string[]): string[][] {
  const byLower = new Map<string, string[]>();
  for (const path of paths) {
    const key = path.toLowerCase();
    const group = byLower.get(key);
    if (group) {
      if (!group.includes(path)) {
        group.push(path);
      }
    } else {
      byLower.set(key, [path]);
    }
  }
  return [...byLower.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
}

describe("src/ path case", () => {
  it("treats two paths as a collision only when they differ solely by letter case", () => {
    expect(groupsThatDifferOnlyByCase(["a/Foo.ts", "a/foo.ts"])).toEqual([
      ["a/Foo.ts", "a/foo.ts"],
    ]);
    expect(groupsThatDifferOnlyByCase(["a/foo.ts", "a/foo.tsx"])).toEqual([]);
    expect(
      groupsThatDifferOnlyByCase(["flight/routePicker.ts", "flight/RoutePicker.tsx"]),
    ).toEqual([]);
  });

  it("has no two file paths that differ only in letter case", () => {
    const collisions = groupsThatDifferOnlyByCase(listSrcFilePaths(SRC_ROOT));
    expect(collisions).toEqual([]);
  });
});
