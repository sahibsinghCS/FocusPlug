/**
 * The session plan: what you are about to commit to, before anything is locked.
 *
 * A plan is a shape (focus length, break length, round count). Everything the
 * setup page draws — the ribbon, the totals, the finish time — is derived here
 * so the picture on screen and the clock in lock mode can never disagree.
 */

export type ShapeId = "classic" | "deep" | "sprint" | "custom";

export interface TimerPlan {
  shape: ShapeId;
  /** Minutes of work per round. */
  focusMin: number;
  /** Minutes of break between rounds. */
  breakMin: number;
  /** Focus blocks in the session. Breaks sit between them, so breaks = rounds - 1. */
  rounds: number;
}

export interface ShapeDef {
  id: ShapeId;
  label: string;
  /** What this shape is for, in the student's words. */
  blurb: string;
  focusMin: number;
  breakMin: number;
  rounds: number;
}

export type SegmentKind = "focus" | "break";

export interface PlanSegment {
  /** Position in the run, 0-based. */
  index: number;
  kind: SegmentKind;
  /** 1-based focus block. A break carries the round it follows. */
  round: number;
  seconds: number;
  /** Offset from session start. */
  startSec: number;
  endSec: number;
}

export interface DialLimit {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

/* ────────────────────────────────────────────────────────────────────────
 * The demo round pin — a filming affordance, in the spirit of
 * FOCUSPLUG_NO_ADAPT and FOCUSPLUG_NO_PLAN
 *
 * The shipped floor on a focus block is five minutes, and it stays five
 * minutes for everyone: a "study session" you can set to sixty seconds is not
 * a study session, and Focus Plan's own `PLAN_MIN_ROUND_SEC` refuses to
 * measure a clean round shorter than that for the same reason.
 *
 * But a round has to CLOSE before there is a debrief, and a block only
 * reaches `completed` by serving its planned length — so with the shipped
 * floor the last beat of a two-minute film costs five minutes of dead air.
 * Pinned, the Length dial goes down to one minute in steps of one, a two-
 * minute block runs out on camera, and the debrief on screen is the real one
 * `debriefFor` computes from the round main actually measured.
 *
 * It changes NOTHING else: not the fuse, not a threshold, not a claim, and
 * not what is recorded. And it cannot be reached by accident — an env var at
 * launch, a localStorage key, or an explicit query flag on a preview URL.
 * Unpinned, `clampPlan` pulls a stored 2 back up to 5 on the next read, so
 * forgetting to unset it cannot leave a real user on a one-minute floor.
 * ──────────────────────────────────────────────────────────────────────── */

/** Set to 1 (or true) before `npm run dev`. Vite exposes the RENDERER_VITE_
 *  and VITE_ prefixes to the renderer; both spellings are accepted. */
export const DEMO_ROUND_ENV_KEYS = [
  "RENDERER_VITE_FOCUSPLUG_DEMO_ROUND",
  "VITE_FOCUSPLUG_DEMO_ROUND",
] as const;
/** `localStorage.setItem("focusplug.demo.round", "1")`, then reload. The route
 *  that works in a packaged build, where there is no Vite to read an env. */
export const DEMO_ROUND_STORAGE_KEY = "focusplug.demo.round";
/** `?demoRound=1` — for `npm run preview:renderer` and the stills scripts. */
export const DEMO_ROUND_QUERY_KEY = "demoRound";
/** The pinned floor and step, in minutes. */
export const DEMO_ROUND_MIN = 1;
export const DEMO_ROUND_STEP = 1;
/** The shipped floor and step, which no pin may raise or lower for anyone else. */
export const SHIPPED_FOCUS_MIN = 5;
export const SHIPPED_FOCUS_STEP = 5;

export interface DemoRoundSources {
  /** `import.meta.env`, or a plain record in a test. */
  env?: Readonly<Record<string, unknown>> | null | undefined;
  /** `window.localStorage`, or anything with `getItem`. */
  storage?: { getItem(key: string): string | null } | null | undefined;
  /** `window.location.search`. */
  search?: string | null | undefined;
}

/** "1" / "true" and nothing else. An empty or absent value is not a pin. */
function pinned(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

/** Pure, so the pin is testable without a DOM or a Vite define. */
export function demoRoundPinned(sources: DemoRoundSources): boolean {
  const env = sources.env;
  if (env) {
    for (const key of DEMO_ROUND_ENV_KEYS) {
      if (pinned(env[key])) {
        return true;
      }
    }
  }
  const storage = sources.storage;
  if (storage) {
    try {
      if (pinned(storage.getItem(DEMO_ROUND_STORAGE_KEY))) {
        return true;
      }
    } catch {
      // A locked-down profile throws on localStorage. Not a pin, not a crash.
    }
  }
  const search = sources.search;
  if (typeof search === "string" && search.length > 0) {
    try {
      if (pinned(new URLSearchParams(search).get(DEMO_ROUND_QUERY_KEY))) {
        return true;
      }
    } catch {
      // A malformed query string is not a pin either.
    }
  }
  return false;
}

/**
 * Whatever of the three sources this environment actually has.
 *
 * Two shapes here are load-bearing and neither is style:
 *
 *  - `(import.meta as …).env` must stay ONE expression. Vite replaces the
 *    `import.meta.env` member access itself; hoisting it (`const m =
 *    import.meta; m.env`) leaves a bare `import.meta`, which in a browser has
 *    no `env` at all, and the env route would silently never fire. Verified
 *    against a real build, not assumed.
 *  - `globalThis`, not `window`, and a cast rather than `vite/client`'s typed
 *    `ImportMeta`, because `src/shared/plan/progression.test.ts` imports this
 *    module and therefore compiles it under the NODE tsconfig too, where there
 *    is no DOM and no `vite/client`.
 *
 * Everything is absent-tolerant: outside a browser there is no pin, which is
 * the correct answer.
 */
interface AmbientGlobals {
  localStorage?: { getItem(key: string): string | null } | null;
  location?: { search?: string } | null;
}

function ambientSources(): DemoRoundSources {
  const globals = globalThis as unknown as AmbientGlobals;
  const sources: DemoRoundSources = {
    env: (import.meta as unknown as { env?: Readonly<Record<string, unknown>> }).env ?? null,
  };
  try {
    sources.storage = globals.localStorage ?? null;
  } catch {
    sources.storage = null;
  }
  try {
    sources.search = globals.location?.search ?? null;
  } catch {
    sources.search = null;
  }
  return sources;
}

/** Resolved once at module load, so every dial and every clamp agrees. */
export const DEMO_ROUND: boolean = demoRoundPinned(ambientSources());

export function focusMinLimit(demoRound: boolean = DEMO_ROUND): DialLimit {
  return {
    min: demoRound ? DEMO_ROUND_MIN : SHIPPED_FOCUS_MIN,
    max: 120,
    step: demoRound ? DEMO_ROUND_STEP : SHIPPED_FOCUS_STEP,
  };
}

export const LIMITS: {
  readonly focusMin: DialLimit;
  readonly breakMin: DialLimit;
  readonly rounds: DialLimit;
} = {
  focusMin: focusMinLimit(),
  breakMin: { min: 1, max: 30, step: 1 },
  rounds: { min: 1, max: 10, step: 1 },
};

export const SHAPES: readonly ShapeDef[] = [
  {
    id: "classic",
    label: "Classic",
    blurb: "The original pomodoro. Short enough that starting is easy.",
    focusMin: 25,
    breakMin: 5,
    rounds: 4,
  },
  {
    id: "deep",
    label: "Deep work",
    blurb: "Long blocks for essays and problem sets that need a running start.",
    focusMin: 50,
    breakMin: 10,
    rounds: 3,
  },
  {
    id: "sprint",
    label: "Sprint",
    blurb: "Tight rounds for readings, flashcards, and a brain that will not sit still.",
    focusMin: 15,
    breakMin: 3,
    rounds: 6,
  },
  {
    id: "custom",
    label: "Custom",
    blurb: "Your own shape. Set it once and it is remembered.",
    focusMin: 40,
    breakMin: 8,
    rounds: 3,
  },
];

/** One block, no breaks. Rounds are available, they are just not the default. */
export const DEFAULT_PLAN: TimerPlan = {
  shape: "custom",
  focusMin: 50,
  breakMin: 10,
  rounds: 1,
};

export function shapeDef(id: ShapeId): ShapeDef {
  const found = SHAPES.find((shape) => shape.id === id);
  if (!found) {
    throw new Error(`Unknown timer shape: ${id}`);
  }
  return found;
}

export function planFromShape(id: ShapeId): TimerPlan {
  const shape = shapeDef(id);
  return {
    shape: shape.id,
    focusMin: shape.focusMin,
    breakMin: shape.breakMin,
    rounds: shape.rounds,
  };
}

function clampStep(value: number, limit: { min: number; max: number }): number {
  if (!Number.isFinite(value)) {
    return limit.min;
  }
  return Math.min(limit.max, Math.max(limit.min, Math.round(value)));
}

export function clampPlan(plan: TimerPlan): TimerPlan {
  return {
    shape: plan.shape,
    focusMin: clampStep(plan.focusMin, LIMITS.focusMin),
    breakMin: clampStep(plan.breakMin, LIMITS.breakMin),
    rounds: clampStep(plan.rounds, LIMITS.rounds),
  };
}

/**
 * Editing any dial drops you out of a named shape unless the numbers still
 * match it — so the picker never lies about what is loaded.
 */
export function withEdit(plan: TimerPlan, patch: Partial<TimerPlan>): TimerPlan {
  const next = clampPlan({ ...plan, ...patch });
  const matching = SHAPES.find(
    (shape) =>
      shape.id !== "custom" &&
      shape.focusMin === next.focusMin &&
      shape.breakMin === next.breakMin &&
      shape.rounds === next.rounds,
  );
  return { ...next, shape: matching ? matching.id : "custom" };
}

/** focus, break, focus, … focus. No trailing break: the session ends on work. */
export function planSegments(plan: TimerPlan): PlanSegment[] {
  const safe = clampPlan(plan);
  const segments: PlanSegment[] = [];
  let cursor = 0;
  for (let round = 1; round <= safe.rounds; round += 1) {
    const focusSec = safe.focusMin * 60;
    segments.push({
      index: segments.length,
      kind: "focus",
      round,
      seconds: focusSec,
      startSec: cursor,
      endSec: cursor + focusSec,
    });
    cursor += focusSec;
    if (round < safe.rounds) {
      const breakSec = safe.breakMin * 60;
      segments.push({
        index: segments.length,
        kind: "break",
        round,
        seconds: breakSec,
        startSec: cursor,
        endSec: cursor + breakSec,
      });
      cursor += breakSec;
    }
  }
  return segments;
}

export function planTotalSec(plan: TimerPlan): number {
  const safe = clampPlan(plan);
  return safe.rounds * safe.focusMin * 60 + Math.max(0, safe.rounds - 1) * safe.breakMin * 60;
}

export function planFocusSec(plan: TimerPlan): number {
  const safe = clampPlan(plan);
  return safe.rounds * safe.focusMin * 60;
}

export function breakCount(plan: TimerPlan): number {
  return Math.max(0, clampPlan(plan).rounds - 1);
}

/** "2h 50m" / "45m" — never "0h 45m". */
export function formatSpan(totalSec: number): string {
  // Round to whole minutes first: rounding the remainder separately turns
  // 7,199 seconds into "1h 60m".
  const totalMinutes = Math.round(Math.max(0, totalSec) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

/** "25:00" / "1:04:00" — the readout in lock mode. */
export function formatReadout(totalSec: number): string {
  const safe = Math.max(0, Math.ceil(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function planEndsAt(plan: TimerPlan, startMs: number): number {
  return startMs + planTotalSec(plan) * 1000;
}

/** One line under the ribbon: the whole commitment, in plain words. */
export function planSummary(plan: TimerPlan): string {
  const safe = clampPlan(plan);
  const breaks = breakCount(safe);
  const roundWord = safe.rounds === 1 ? "round" : "rounds";
  if (breaks === 0) {
    return `one unbroken block of ${safe.focusMin}m`;
  }
  return `${safe.rounds} ${roundWord} of ${safe.focusMin}m · ${breaks} break${
    breaks === 1 ? "" : "s"
  } of ${safe.breakMin}m`;
}
