/**
 * Case-insensitive process-name matching for blocklist kill vs allowlist protect.
 *
 * Kill matching is strict (exact image name, optional .exe, or a separator
 * prefix like discord-canary). Protect matching is broader so chrome helpers
 * (chrome_crashpad_handler, msedgewebview2) cannot be shot while studying.
 */

const EXE_SUFFIX = /\.exe$/i;

export function imageBasename(processName: string): string {
  const trimmed = processName.trim();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  return slash >= 0 ? (normalized.slice(slash + 1) ?? "") : normalized;
}

export function peelExe(processName: string): string {
  return imageBasename(processName).trim().toLowerCase().replace(EXE_SUFFIX, "");
}

/** Alphanumeric-only token for broader allowlist prefix checks. */
export function compactToken(processName: string): string {
  return peelExe(processName).replace(/[^a-z0-9]+/g, "");
}

export function matchesForKill(processName: string, matcher: string): boolean {
  const process = peelExe(processName);
  const match = peelExe(matcher);
  if (!process || !match) {
    return false;
  }
  if (process === match) {
    return true;
  }
  if (process.startsWith(match) && process.length > match.length) {
    const next = process.charAt(match.length);
    if (next.length > 0 && /[^a-z0-9]/.test(next)) {
      return true;
    }
  }
  const processCompact = compactToken(processName);
  const matchCompact = compactToken(matcher);
  // discordcanary / discordptb via matcher "discord" (min 6 to avoid "steam" eating steamwebhelper)
  if (matchCompact.length >= 6 && processCompact.startsWith(matchCompact)) {
    return true;
  }
  return false;
}

export function matchesForProtect(processName: string, matcher: string): boolean {
  if (matchesForKill(processName, matcher)) {
    return true;
  }
  const process = compactToken(processName);
  const match = compactToken(matcher);
  if (!process || !match) {
    return false;
  }
  if (process === match) {
    return true;
  }
  // Prefix protect only for real app tokens (avoids matcher "c" shielding everything).
  if (match.length >= 4 && process.startsWith(match)) {
    return true;
  }
  return false;
}

export function anyMatch(
  processName: string,
  matchers: readonly string[],
  mode: "kill" | "protect",
): boolean {
  const fn = mode === "kill" ? matchesForKill : matchesForProtect;
  for (const matcher of matchers) {
    if (fn(processName, matcher)) {
      return true;
    }
  }
  return false;
}
