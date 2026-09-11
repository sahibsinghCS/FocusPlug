import type { KillResult, ProcessKiller } from "@shared/ipc";

export type { KillResult, ProcessKiller };

/** A running OS process as seen by a ProcessHost. */
export interface ListedProcess {
  pid: number;
  /** Image / executable basename, e.g. Discord.exe or chrome. */
  name: string;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: number;
}

/** Injectable subprocess runner so Windows hosts can be tested off Windows. */
export interface CommandRunner {
  execFile(
    file: string,
    args: readonly string[],
    options?: { timeout?: number },
  ): Promise<ExecResult>;
}

export interface ProcessHost {
  list(): Promise<ListedProcess[]>;
  terminate(pid: number): Promise<void>;
}

export interface TerminatorOptions {
  /**
   * Additional allowlist matchers (live Store list). Always unioned with the
   * default study-process floor — callers cannot opt out of that protection.
   */
  getAllowlistMatchers?: () => string[] | Promise<string[]>;
  host?: ProcessHost;
  /** Extra protected matchers (tests / session wiring). */
  protectedMatchers?: readonly string[];
}
