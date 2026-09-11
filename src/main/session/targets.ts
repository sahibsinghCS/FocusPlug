import { ALL_BLOCKLIST_TARGET } from "../../shared/policy/index.ts";
import type { AppEntry } from "../../shared/types.ts";

function addUnique(out: string[], seen: Set<string>, matcher: string): void {
  const trimmed = matcher.trim();
  if (trimmed.length === 0) {
    return;
  }
  if (trimmed === ALL_BLOCKLIST_TARGET) {
    return;
  }
  const key = trimmed.toLowerCase();
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  out.push(trimmed);
}

export function flattenEnabledMatchers(entries: readonly AppEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }
    for (const matcher of entry.match) {
      addUnique(out, seen, matcher);
    }
  }
  return out;
}

/**
 * Expand policy kill targets to ProcessKiller matchers.
 * `*blocklist*` becomes every enabled blocklist matcher and is never forwarded.
 */
export function expandKillTargets(
  targets: readonly string[],
  blocklist: readonly AppEntry[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const trimmed = target.trim();
    if (trimmed === ALL_BLOCKLIST_TARGET) {
      for (const matcher of flattenEnabledMatchers(blocklist)) {
        addUnique(out, seen, matcher);
      }
      continue;
    }
    addUnique(out, seen, trimmed);
  }
  return out;
}

export function enabledBlocklistMatchers(blocklist: readonly AppEntry[]): string[] {
  return flattenEnabledMatchers(blocklist);
}
