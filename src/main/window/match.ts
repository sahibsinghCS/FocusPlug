import type { AppEntry } from "../../shared/types.ts";

/** Lowercase, trim, strip a trailing `.exe` so `Discord.exe` and `discord` compare equal. */
export function normalizeMatcher(raw: string): string {
  return raw.trim().toLowerCase().replace(/\.exe$/u, "");
}

/** Last path segment of a process name or image path, then {@link normalizeMatcher}. */
export function processBasename(processName: string): string {
  const unified = processName.trim().replace(/\\/gu, "/");
  const slash = unified.lastIndexOf("/");
  const base = slash >= 0 ? unified.slice(slash + 1) : unified;
  return normalizeMatcher(base);
}

/**
 * Case-insensitive match of an allow/block entry against the focused window.
 *
 * Process: exact basename (`chrome` ↔ `chrome.exe` ↔ `...\chrome.exe`).
 * Title: substring of the matcher as written and of its normalized form.
 */
export function entryMatches(
  entry: AppEntry,
  processName: string,
  windowTitle: string,
): boolean {
  if (!entry.enabled) {
    return false;
  }

  const titleLc = windowTitle.toLowerCase();
  const procBase = processBasename(processName);

  for (const raw of entry.match) {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      continue;
    }

    const asWrittenLc = trimmed.toLowerCase();
    const norm = normalizeMatcher(trimmed);
    if (norm.length === 0) {
      continue;
    }

    if (procBase.length > 0 && procBase === norm) {
      return true;
    }
    if (titleLc.includes(asWrittenLc)) {
      return true;
    }
    if (norm !== asWrittenLc && titleLc.includes(norm)) {
      return true;
    }
  }

  return false;
}

export function findMatchingEntry(
  entries: AppEntry[],
  processName: string,
  windowTitle: string,
): AppEntry | undefined {
  return entries.find((entry) => entryMatches(entry, processName, windowTitle));
}
