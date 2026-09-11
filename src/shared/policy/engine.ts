import { REASONS, SESSION_OFF_DETAIL, type PolicyReason } from "./constants";
import { classify, killTargetsFor } from "./evaluate";
import type { PolicyEvent, PolicyInput } from "../types";

export interface PolicyState {
  /** Monotonic clock derived from snapshot `ts` values (epoch ms). */
  lastTs: number;
  /** When the active countdown started, or null if none. */
  countdownStartedAt: number | null;
  countdownReason: PolicyReason | null;
  countdownTargets: string[];
  /** True after kill until on-task unlock or session off. */
  locked: boolean;
}

export const INITIAL_POLICY_STATE: PolicyState = {
  lastTs: 0,
  countdownStartedAt: null,
  countdownReason: null,
  countdownTargets: [],
  locked: false,
};

/**
 * Pure reducer: `(state, input) → { state, events }`.
 * No I/O, no wall clock — time comes from snapshot timestamps.
 */
export function stepPolicy(
  state: PolicyState,
  input: PolicyInput,
): { state: PolicyState; events: PolicyEvent[] } {
  const next: PolicyState = {
    lastTs: currentTs(state.lastTs, input),
    countdownStartedAt: state.countdownStartedAt,
    countdownReason: state.countdownReason,
    countdownTargets: [...state.countdownTargets],
    locked: state.locked,
  };
  const now = next.lastTs;
  const events: PolicyEvent[] = [];

  if (!input.sessionActive) {
    if (next.countdownStartedAt !== null) {
      events.push({ type: "cancel_countdown" });
    }
    events.push({
      type: "status",
      decision: "IDLE",
      detail: SESSION_OFF_DETAIL,
    });
    return {
      state: {
        lastTs: next.lastTs,
        countdownStartedAt: null,
        countdownReason: null,
        countdownTargets: [],
        locked: false,
      },
      events,
    };
  }

  const classified = classify(input);

  if (classified.onTask) {
    const recovering = next.countdownStartedAt !== null || next.locked;
    if (next.countdownStartedAt !== null) {
      events.push({ type: "cancel_countdown" });
    }
    if (recovering) {
      events.push({ type: "unlock" });
    }
    events.push({
      type: "status",
      decision: classified.decision,
      detail: classified.detail,
    });
    return {
      state: {
        lastTs: next.lastTs,
        countdownStartedAt: null,
        countdownReason: null,
        countdownTargets: [],
        locked: false,
      },
      events,
    };
  }

  if (next.locked) {
    events.push({
      type: "status",
      decision: classified.decision,
      detail: classified.detail,
    });
    return { state: next, events };
  }

  if (classified.violation !== null) {
    const reason = reasonFor(classified.violation);
    const targets = killTargetsFor(input, classified.desk);
    if (next.countdownStartedAt === null) {
      next.countdownStartedAt = now;
      next.countdownReason = reason;
      next.countdownTargets = targets;
      events.push({
        type: "start_countdown",
        reason,
        seconds: countdownSeconds(input.countdownSec),
      });
    } else {
      next.countdownTargets = unique([...next.countdownTargets, ...targets]);
    }
  }

  if (next.countdownStartedAt !== null) {
    const duration = durationMs(input.countdownSec);
    if (duration !== null && now - next.countdownStartedAt >= duration) {
      events.push({
        type: "kill",
        targets: [...next.countdownTargets],
        reason: next.countdownReason ?? REASONS.blockedFocus,
      });
      next.locked = true;
      next.countdownStartedAt = null;
      next.countdownReason = null;
      next.countdownTargets = [];
    }
  }

  events.push({
    type: "status",
    decision: classified.decision,
    detail: classified.detail,
  });
  return { state: next, events };
}

/** Stateful wrapper matching the `PolicyEngine` seam in `src/shared/ipc.ts`. */
export class PolicyEngine {
  private state: PolicyState = { ...INITIAL_POLICY_STATE, countdownTargets: [] };

  step(input: PolicyInput): PolicyEvent[] {
    const result = stepPolicy(this.state, input);
    this.state = result.state;
    return result.events;
  }
}

function currentTs(lastTs: number, input: PolicyInput): number {
  let now = lastTs;
  if (input.focus !== null && Number.isFinite(input.focus.ts)) {
    now = Math.max(now, input.focus.ts);
  }
  if (input.desk !== null && Number.isFinite(input.desk.ts)) {
    now = Math.max(now, input.desk.ts);
  }
  return now;
}

function reasonFor(violation: "blocked" | "away"): PolicyReason {
  return violation === "blocked" ? REASONS.blockedFocus : REASONS.deskAway;
}

function countdownSeconds(raw: number): number {
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, raw);
}

function durationMs(countdownSec: number): number | null {
  if (!Number.isFinite(countdownSec)) {
    return null;
  }
  return Math.max(0, countdownSec) * 1000;
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}
