import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function extractContractTypes(markdown) {
  const heading = "## Types (`src/shared/types.ts`)";
  const headingAt = markdown.indexOf(heading);
  if (headingAt < 0) {
    throw new Error("docs/CONTRACTS.md is missing the Types heading");
  }

  const fenceAt = markdown.indexOf("```ts", headingAt);
  if (fenceAt < 0) {
    throw new Error("docs/CONTRACTS.md is missing the Types TypeScript fence");
  }

  const bodyStart = fenceAt + "```ts".length;
  const fenceEnd = markdown.indexOf("```", bodyStart);
  if (fenceEnd < 0) {
    throw new Error("docs/CONTRACTS.md Types fence is unclosed");
  }

  return markdown.slice(bodyStart, fenceEnd).replace(/^\r?\n/, "").replace(/\r\n/g, "\n");
}

function normalizeSource(source) {
  return source.replace(/\r\n/g, "\n").replace(/\s+$/u, "") + "\n";
}

const contracts = readFileSync(join(root, "docs/CONTRACTS.md"), "utf8");
const expected = normalizeSource(extractContractTypes(contracts));
const actual = normalizeSource(readFileSync(join(root, "src/shared/types.ts"), "utf8"));

if (actual !== expected) {
  console.error("src/shared/types.ts does not match docs/CONTRACTS.md Types block exactly.");
  process.exitCode = 1;
} else {
  console.log("OK: src/shared/types.ts matches docs/CONTRACTS.md");
}
