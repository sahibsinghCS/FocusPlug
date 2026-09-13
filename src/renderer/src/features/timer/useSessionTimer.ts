import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  clampPlan,
  DEFAULT_PLAN,
  planSegments,
  planTotalSec,
  type PlanSegment,
  type TimerPlan,
} from "./plan";
import {
  focusSecondsDone,
  positionAt,
  shouldEnforce,
  skipTo,
  type RunPosition,
  type RunStatus,
} from "./runtime";

const PLAN_KEY = "focusplug.plan.v1";
const TICK_MS = 250;

export interface SessionTimer {
  plan: TimerPlan;
  setPlan: (next: TimerPlan) => void;
  status: RunStatus;
  segments: PlanSegment[];
  position: RunPosition | null;
  elapsedSec: number;
  /** Wall-clock finish, projected from what is left. `null` before you commit. */
  endsAtMs: number | null;
  /**
   * Wall-clock when `start()` ran. Survives pause/resume so lock faces can
   * ignore persisted log from earlier sessions. `null` on the setup screen.
   */
  startedAtMs: number | null;
  remainingSec: number;
  /** Focus time actually served — a skipped round does not count as work. */
  workedSec: number;
  armed: boolean;
  start: () => void;
  pause: () => void;
  resume: () => void;
  skip: () => void;
  end: () => void;
}

export function loadPlan(): TimerPlan {
  try {
    const raw = window.localStorage.getItem(PLAN_KEY);
    if (!raw) {
      return DEFAULT_PLAN;
    }
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_PLAN;
    }
    const record = parsed as Partial<TimerPlan>;
    if (
      typeof record.focusMin !== "number" ||
      typeof record.breakMin !== "number" ||
      typeof record.rounds !== "number"
    ) {
      return DEFAULT_PLAN;
    }
    return clampPlan({
      shape: record.shape ?? "custom",
      focusMin: record.focusMin,
      breakMin: record.breakMin,
      rounds: record.rounds,
    });
  } catch {
    return DEFAULT_PLAN;
  }
}

function savePlan(plan: TimerPlan): void {
  try {
    window.localStorage.setItem(PLAN_KEY, JSON.stringify(plan));
  } catch {
    // A locked-down profile should not stop you starting a session.
  }
}

/**
 * Drives the plan in real time and tells the caller when enforcement should be
 * armed. Elapsed time is read from the wall clock rather than counted in
 * ticks, so a stalled renderer cannot shorten a round.
 *
 * `onEnforce` fires only on a change, and only ever with the truth: armed
 * during a running focus block, released on a break, a pause, or the finish.
 */
export function useSessionTimer(options: {
  onEnforce: (armed: boolean) => void;
  onPhaseChange?: (position: RunPosition | null) => void;
}): SessionTimer {
  const [plan, setPlanState] = useState<TimerPlan>(loadPlan);
  const [status, setStatus] = useState<RunStatus>("setup");
  const [startedAtMs, setStartedAtMs] = useState<number | null>(null);
  const [anchorMs, setAnchorMs] = useState<number | null>(null);
  const [bankedSec, setBankedSec] = useState(0);
  const [skippedFocusSec, setSkippedFocusSec] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const segments = useMemo(() => planSegments(plan), [plan]);
  const totalSec = useMemo(() => planTotalSec(plan), [plan]);

  useEffect(() => {
    if (status !== "running") {
      return;
    }
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, TICK_MS);
    return () => clearInterval(id);
  }, [status]);

  const rawElapsed =
    status === "running" && anchorMs !== null
      ? bankedSec + Math.max(0, nowMs - anchorMs) / 1000
      : bankedSec;
  const elapsedSec = status === "setup" ? 0 : Math.min(rawElapsed, totalSec);

  // The plan runs out on a tick, not on a click: settle it before painting.
  useEffect(() => {
    if (status === "running" && rawElapsed >= totalSec) {
      setStatus("done");
      setAnchorMs(null);
      setBankedSec(totalSec);
    }
  }, [rawElapsed, status, totalSec]);

  const position = status === "setup" || status === "done" ? null : positionAt(segments, elapsedSec);
  const armed = shouldEnforce(position, status);

  const enforceRef = useRef(options.onEnforce);
  enforceRef.current = options.onEnforce;
  const phaseRef = useRef(options.onPhaseChange);
  phaseRef.current = options.onPhaseChange;

  const lastArmed = useRef(false);
  useEffect(() => {
    if (lastArmed.current === armed) {
      return;
    }
    lastArmed.current = armed;
    enforceRef.current(armed);
  }, [armed]);

  const lastSegment = useRef<number | null>(null);
  useEffect(() => {
    const index = position?.segment.index ?? null;
    if (lastSegment.current === index) {
      return;
    }
    lastSegment.current = index;
    phaseRef.current?.(position);
  }, [position]);

  const setPlan = useCallback((next: TimerPlan): void => {
    const safe = clampPlan(next);
    setPlanState(safe);
    savePlan(safe);
  }, []);

  const start = useCallback((): void => {
    const now = Date.now();
    setStartedAtMs(now);
    setBankedSec(0);
    setSkippedFocusSec(0);
    setAnchorMs(now);
    setNowMs(now);
    setStatus("running");
  }, []);

  const pause = useCallback((): void => {
    setBankedSec((banked) =>
      anchorMs === null ? banked : banked + Math.max(0, Date.now() - anchorMs) / 1000,
    );
    setAnchorMs(null);
    setStatus("paused");
  }, [anchorMs]);

  const resume = useCallback((): void => {
    const now = Date.now();
    setAnchorMs(now);
    setNowMs(now);
    setStatus("running");
  }, []);

  const skip = useCallback((): void => {
    const now = Date.now();
    const current =
      status === "running" && anchorMs !== null
        ? bankedSec + Math.max(0, now - anchorMs) / 1000
        : bankedSec;
    const skipped = positionAt(segments, current);
    if (skipped && skipped.segment.kind === "focus") {
      setSkippedFocusSec((total) => total + Math.max(0, skipped.segment.endSec - current));
    }
    const next = skipTo(segments, current);
    setBankedSec(next);
    setNowMs(now);
    if (next >= totalSec) {
      setAnchorMs(null);
      setStatus("done");
      return;
    }
    setAnchorMs(status === "paused" ? null : now);
  }, [anchorMs, bankedSec, segments, status, totalSec]);

  const end = useCallback((): void => {
    setStatus("setup");
    setStartedAtMs(null);
    setAnchorMs(null);
    setBankedSec(0);
    setSkippedFocusSec(0);
  }, []);

  const remainingSec = Math.max(0, totalSec - elapsedSec);
  const workedSec = Math.max(0, focusSecondsDone(segments, elapsedSec) - skippedFocusSec);
  // Projected from what is left, so a pause pushes the finish back honestly.
  const endsAtMs = status === "setup" ? null : nowMs + remainingSec * 1000;

  return {
    plan,
    setPlan,
    status,
    segments,
    position,
    elapsedSec,
    endsAtMs,
    startedAtMs,
    remainingSec,
    workedSec,
    armed,
    start,
    pause,
    resume,
    skip,
    end,
  };
}
