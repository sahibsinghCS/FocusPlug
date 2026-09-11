import { anyMatch } from "./match";
import {
  collectProtectedMatchers,
  isCriticalPid,
  isSelfPid,
  selfProcessPids,
} from "./protect";
import { createPlatformHost } from "./hosts";
import type {
  ListedProcess,
  ProcessHost,
  ProcessKiller,
  KillResult,
  TerminatorOptions,
} from "./types";

export function formatProc(proc: ListedProcess): string {
  return `${proc.name} (pid ${proc.pid})`;
}

export function formatUnknownError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return String(error);
}

function trimMatchers(matchers: readonly string[]): string[] {
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const matcher of matchers) {
    const trimmed = matcher.trim();
    if (!trimmed) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    cleaned.push(trimmed);
  }
  return cleaned;
}

/**
 * Windows-first blocklist terminator. Implements ProcessKiller.kill(matchers).
 * Never terminates allowlisted study processes or critical OS/self PIDs.
 */
export class BlocklistTerminator implements ProcessKiller {
  private readonly host: ProcessHost;
  private readonly getAllowlistMatchers: () => string[] | Promise<string[]>;
  private readonly extraProtected: readonly string[];

  constructor(options: TerminatorOptions = {}) {
    this.host = options.host ?? createPlatformHost();
    this.getAllowlistMatchers = options.getAllowlistMatchers ?? (() => []);
    this.extraProtected = options.protectedMatchers ?? [];
  }

  async kill(matchers: string[]): Promise<KillResult> {
    const killed: string[] = [];
    const errors: string[] = [];

    const cleaned = trimMatchers(matchers);
    if (cleaned.length === 0) {
      return { killed, errors: ["No process matchers provided"] };
    }

    let processes: ListedProcess[];
    try {
      processes = await this.host.list();
    } catch (error) {
      return {
        killed,
        errors: [`Failed to list processes: ${formatUnknownError(error)}`],
      };
    }

    let allowlist: string[] = [];
    try {
      allowlist = [...(await this.getAllowlistMatchers())];
    } catch (error) {
      return {
        killed,
        errors: [
          `Failed to load allowlist matchers: ${formatUnknownError(error)}`,
        ],
      };
    }

    const protectedMatchers = collectProtectedMatchers(
      allowlist,
      this.extraProtected,
    );
    const selfPids = selfProcessPids();
    const considered = new Set<number>();
    const targets: ListedProcess[] = [];

    for (const proc of processes) {
      if (considered.has(proc.pid)) {
        continue;
      }
      if (!anyMatch(proc.name, cleaned, "kill")) {
        continue;
      }
      considered.add(proc.pid);

      if (isCriticalPid(proc.pid) || isSelfPid(proc.pid, selfPids)) {
        errors.push(
          `Refused to kill protected process ${formatProc(proc)} (self or system pid)`,
        );
        continue;
      }
      if (anyMatch(proc.name, protectedMatchers, "protect")) {
        errors.push(
          `Refused to kill allowlisted/protected process ${formatProc(proc)}`,
        );
        continue;
      }
      targets.push(proc);
    }

    if (targets.length === 0 && errors.length === 0) {
      errors.push(`No running processes matched: ${cleaned.join(", ")}`);
    }

    for (const proc of targets) {
      try {
        await this.host.terminate(proc.pid);
        killed.push(formatProc(proc));
      } catch (error) {
        errors.push(
          `Failed to kill ${formatProc(proc)}: ${formatUnknownError(error)}`,
        );
      }
    }

    return { killed, errors };
  }
}

export function createProcessKiller(
  options: TerminatorOptions = {},
): ProcessKiller {
  return new BlocklistTerminator(options);
}
