import { DEFAULT_BLOCKLIST } from "../../shared/defaults.ts";
import { ALL_BLOCKLIST_TARGET } from "../../shared/policy/index.ts";
import type { AppEntry, FocusSnapshot } from "../../shared/types.ts";

function uniqueMatchers(matchers: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const matcher of matchers) {
    const trimmed = matcher.trim();
    if (trimmed.length === 0 || trimmed === ALL_BLOCKLIST_TARGET) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Enabled blocklist/allowlist matcher strings, de-duplicated. */
export function enabledMatchers(entries: readonly AppEntry[]): string[] {
  const raw: string[] = [];
  for (const entry of entries) {
    if (!entry.enabled) {
      continue;
    }
    for (const matcher of entry.match) {
      raw.push(matcher);
    }
  }
  return uniqueMatchers(raw);
}

/**
 * Expand PolicyEngine kill targets before ProcessKiller.
 * `*blocklist*` becomes every enabled blocklist matcher — never an OS name.
 */
export function expandKillTargets(
  targets: readonly string[],
  blocklist: readonly AppEntry[],
): string[] {
  const expanded: string[] = [];
  for (const target of targets) {
    if (target.trim() === ALL_BLOCKLIST_TARGET) {
      expanded.push(...enabledMatchers(blocklist));
    } else {
      expanded.push(target);
    }
  }
  return uniqueMatchers(expanded);
}

/**
 * Demo Kill: current enabled blocklist matchers, plus the focused blocked
 * process if any. Falls back to default blocklist matchers when the live
 * list is empty.
 */
export function demoKillMatchers(
  blocklist: readonly AppEntry[],
  focus: FocusSnapshot | null,
): string[] {
  const fromList = enabledMatchers(blocklist);
  const fallback = fromList.length > 0 ? fromList : enabledMatchers(DEFAULT_BLOCKLIST);
  if (focus !== null && focus.matchedBlock && focus.processName.trim().length > 0) {
    return uniqueMatchers([focus.processName, ...fallback]);
  }
  return fallback;
}
