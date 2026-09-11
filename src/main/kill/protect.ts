/**
 * Safety floor: default study processes from docs/CONTRACTS.md / src/shared/defaults.ts.
 * Callers cannot disable this floor. Live allowlists are unioned on top.
 */
export const DEFAULT_STUDY_PROCESS_MATCHERS: readonly string[] = [
  "chrome",
  "chrome.exe",
  "google chrome",
  "msedge",
  "msedge.exe",
  "microsoft edge",
  "firefox",
  "firefox.exe",
  "code",
  "code.exe",
  "visual studio code",
  "notion",
  "notion.exe",
  "winword",
  "winword.exe",
  "microsoft word",
  "google docs",
  "docs.google.com",
];

/** OS / session-host processes that must never be terminated. */
export const CRITICAL_PROCESS_MATCHERS: readonly string[] = [
  "system",
  "system idle process",
  "idle",
  "registry",
  "smss",
  "csrss",
  "wininit",
  "winlogon",
  "services",
  "lsass",
  "lsaiso",
  "svchost",
  "dwm",
  "fontdrvhost",
  "explorer",
  "conhost",
  "searchindexer",
  "securityhealthservice",
  "memory compression",
  "secure system",
  "init",
  "systemd",
  "kthreadd",
];

export function collectProtectedMatchers(
  extraAllowlist: readonly string[] = [],
  extraProtected: readonly string[] = [],
): string[] {
  return [
    ...DEFAULT_STUDY_PROCESS_MATCHERS,
    ...CRITICAL_PROCESS_MATCHERS,
    ...extraAllowlist,
    ...extraProtected,
  ];
}

export function isSelfPid(pid: number, selfPids: ReadonlySet<number>): boolean {
  return selfPids.has(pid);
}

export function selfProcessPids(): Set<number> {
  const pids = new Set<number>();
  if (Number.isInteger(process.pid) && process.pid > 0) {
    pids.add(process.pid);
  }
  if (Number.isInteger(process.ppid) && process.ppid > 0) {
    pids.add(process.ppid);
  }
  return pids;
}

export function isCriticalPid(pid: number): boolean {
  return pid <= 4;
}
