import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Two claims this feature makes that a unit test on a view-model cannot reach,
 * asserted against the source rather than promised in a comment.
 *
 *  1. **Silence is not a label.** *Start the clock again* is `LockPage`'s
 *     existing primary button, it calls `timer.resume` and nothing else, and
 *     no page in this app records a verdict. The only producer of a record
 *     request is `verdictAction`, which needs a verdict to produce one.
 *  2. **The photographs never leave the machine.** There is no network call
 *     anywhere in the correction UI — no `fetch`, no `XMLHttpRequest`, no
 *     `WebSocket`, no `sendBeacon` — and the only image source it ever renders
 *     is the thumbnail data URL main put in the state payload.
 *
 * Both have POSITIVE CONTROLS at the end, mirroring
 * `src/shared/plan/purity.test.ts`: a green run has to mean the checker still
 * works, not that it quietly stopped looking.
 */

const featureDir = dirname(fileURLToPath(import.meta.url));
const pagesDir = join(featureDir, "..", "..", "pages");

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function featureSources(): Array<{ name: string; source: string }> {
  return readdirSync(featureDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
        !entry.name.endsWith(".test.ts"),
    )
    .map((entry) => ({ name: entry.name, source: read(join(featureDir, entry.name)) }));
}

/** Comments and string literals stripped, so prose about `fetch` is not code. */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

const NETWORK = [
  /\bfetch\s*\(/,
  /\bXMLHttpRequest\b/,
  /\bWebSocket\b/,
  /\bsendBeacon\b/,
  /\bEventSource\b/,
  /\bnavigator\s*\.\s*clipboard\b/,
];

describe("the photographs never leave the machine", () => {
  it("has no network call anywhere in the correction UI", () => {
    for (const { name, source } of featureSources()) {
      const stripped = code(source);
      for (const pattern of NETWORK) {
        expect(pattern.test(stripped), `${name} must not reach the network (${pattern})`).toBe(
          false,
        );
      }
    }
  });

  it("renders only the thumbnail main put in the state payload", () => {
    const card = read(join(featureDir, "CorrectionsCard.tsx"));
    // One <img>, and its src is `row.thumbnail`. Full frames reach the screen
    // only through the OS file manager, which is what `Reveal folder` opens.
    const images = card.match(/<img\b/g) ?? [];
    expect(images).toHaveLength(1);
    expect(card).toContain("src={row.thumbnail}");
    expect(card).not.toMatch(/src=\{`file:/);
  });

  it("says the claim on screen, not only in this test", () => {
    const model = read(join(featureDir, "model.ts"));
    expect(model).toContain("never uploaded");
    expect(model).toContain("desk-corrections/");
  });

  it("POSITIVE CONTROL: the network checker still catches a network call", () => {
    const planted = code('const x = 1; void fetch("https://example.com");');
    expect(NETWORK.some((pattern) => pattern.test(planted))).toBe(true);
  });
});

describe("silence is not a label", () => {
  const lock = read(join(pagesDir, "LockPage.tsx"));

  it("the drift-stopped clock's primary button only resumes", () => {
    // The one loud button on a drift-stopped clock, unchanged by this feature.
    expect(lock).toContain("onClick={timer.resume}");
    expect(lock).toContain("{drift.action}");
  });

  it("no page records a verdict — the chips are the only way to produce one", () => {
    for (const name of readdirSync(pagesDir)) {
      if (!name.endsWith(".tsx")) {
        continue;
      }
      const source = code(read(join(pagesDir, name)));
      expect(/correctionsRecord/.test(source), `${name} must not record a verdict`).toBe(false);
      expect(/verdictAction/.test(source), `${name} must not answer for the student`).toBe(false);
    }
  });

  it("there is exactly one call site that records, and it is fed by verdictAction", () => {
    const callers = featureSources().filter(({ source }) =>
      /corrections\.record\s*\(/.test(code(source)),
    );
    expect(callers.map((entry) => entry.name)).toEqual(["VerdictRow.tsx"]);
    // And it sends what the tested function returned, never a literal it built
    // for itself — so "records nothing without a verdict" is a property of
    // `verdictAction`, which `model.test.ts` pins, rather than of this file.
    const row = code(read(join(featureDir, "VerdictRow.tsx")));
    expect(row).toContain("corrections.record(action.record)");
    expect(row).toContain("action.record === null ? null :");
  });

  it("POSITIVE CONTROL: the page checker still catches a recorded verdict", () => {
    expect(/correctionsRecord/.test(code("void api.correctionsRecord(request);"))).toBe(true);
  });
});

describe("the surfaces are actually mounted", () => {
  it("the paused lock screen carries the verdict row", () => {
    const lock = read(join(pagesDir, "LockPage.tsx"));
    expect(lock).toContain("<VerdictRow");
    expect(lock).toContain('from "../features/corrections"');
  });

  it("Settings carries the review card, under Desk model", () => {
    const settings = read(join(pagesDir, "SettingsPage.tsx"));
    expect(settings).toContain("<CorrectionsCard");
    const modelAt = settings.indexOf("Frozen <span");
    const cardAt = settings.indexOf("<CorrectionsCard");
    expect(modelAt).toBeGreaterThan(-1);
    expect(cardAt).toBeGreaterThan(modelAt);
  });
});
