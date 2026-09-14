import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Pull the first ```ts fence that follows `heading` out of a markdown doc.
 *
 * Every doc that publishes a file as "complete source" is checked here rather
 * than by eye, because a fence that has quietly drifted from the file it
 * claims to be is worse than no fence at all.
 */
function extractFence(markdown, where, heading) {
  const headingAt = markdown.indexOf(heading);
  if (headingAt < 0) {
    throw new Error(`${where} is missing the heading: ${heading}`);
  }

  const fenceAt = markdown.indexOf("```ts", headingAt);
  if (fenceAt < 0) {
    throw new Error(`${where} is missing the TypeScript fence under: ${heading}`);
  }

  const bodyStart = fenceAt + "```ts".length;
  const fenceEnd = markdown.indexOf("```", bodyStart);
  if (fenceEnd < 0) {
    throw new Error(`${where} has an unclosed fence under: ${heading}`);
  }

  return markdown.slice(bodyStart, fenceEnd).replace(/^\r?\n/, "").replace(/\r\n/g, "\n");
}

function normalizeSource(source) {
  return source.replace(/\r\n/g, "\n").replace(/\s+$/u, "") + "\n";
}

/**
 * Every fence a doc publishes as the complete source of a shipped file.
 * `docs/CONTRACTS.md` freezes the kill-path contract; the Focus Plan and
 * correction-loop appendices freeze their cores' types and constants — and an
 * appendix is exactly where an unchecked claim would earn the most undeserved
 * trust. The correction loop's fence earns its keep the hard way: the anchor
 * strength in it is a tuned number, and a tuned number that drifted from the
 * document explaining how it was tuned is worse than no document.
 */
const FROZEN = [
  {
    doc: "docs/CONTRACTS.md",
    heading: "## Types (`src/shared/types.ts`)",
    source: "src/shared/types.ts",
  },
  {
    doc: "docs/FOCUS-PLAN.md",
    heading: "## 1. New shared types — `src/shared/plan/types.ts` (complete source)",
    source: "src/shared/plan/types.ts",
  },
  {
    doc: "docs/CORRECTION-LOOP.md",
    heading: "## 1. New shared types — `src/shared/correction/types.ts` (complete source)",
    source: "src/shared/correction/types.ts",
  },
  {
    doc: "docs/CORRECTION-LOOP.md",
    heading: "## 2. Constants — `src/shared/correction/constants.ts` (complete source)",
    source: "src/shared/correction/constants.ts",
  },
  {
    doc: "docs/FOCUS-PLAN.md",
    heading: "## 2. Constants — `src/shared/plan/constants.ts` (complete source)",
    source: "src/shared/plan/constants.ts",
  },
];

let failed = false;
for (const { doc, heading, source } of FROZEN) {
  const markdown = readFileSync(join(root, doc), "utf8");
  const expected = normalizeSource(extractFence(markdown, doc, heading));
  const actual = normalizeSource(readFileSync(join(root, source), "utf8"));
  if (actual !== expected) {
    console.error(`${source} does not match its fence in ${doc} exactly.`);
    failed = true;
  } else {
    console.log(`OK: ${source} matches ${doc}`);
  }
}

if (failed) {
  process.exitCode = 1;
}
