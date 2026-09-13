import type { FocusPlanState, PlanRound } from "@shared/ipc";
import { civilDayUtc } from "@shared/plan";
import { clean3, drift19_22_20, fresh, mixedRounds, stationary20 } from "@shared/plan/fixtures";

/**
 * Seeded Focus Plan states for `preview:renderer` and the stills script.
 *
 * They read from `src/shared/plan/fixtures.ts` — the same named ledgers the
 * estimator's own tests use — so a screenshot and a unit test can never be
 * looking at two different sets of numbers. The scene names live here rather
 * than in `lib/urlScene.ts` because they are this feature's own vocabulary,
 * and the session scenes are orthogonal to them (`?scene=plan-measured` still
 * boots the standby session, exactly as a fresh app does).
 */

export const PLAN_SCENES = [
  "plan-cold",
  "plan-measured",
  "plan-mixed",
  "debrief-drifted",
  "debrief-clean",
  "debrief-flat",
  "nudge-revision",
] as const;

export type PlanScene = (typeof PLAN_SCENES)[number];

function readParam(search: string, hash: string, name: string): string | null {
  const query = new URLSearchParams(search);
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return query.get(name) ?? new URLSearchParams(hashQuery).get(name);
}

export function readPlanScene(search: string, hash: string): PlanScene | null {
  const raw = readParam(search, hash, "scene");
  return PLAN_SCENES.find((scene) => scene === raw) ?? null;
}

/**
 * Slide a fixture ledger forward so its newest round ended a minute ago. The
 * debrief on the setup page is deliberately time-boxed (30 minutes), so a
 * fixture stamped in September 2026 would render nothing at all; shifting
 * every round by one delta keeps the day spread — and therefore the trend
 * gates — exactly as the fixture wrote them.
 */
function rebase(rounds: readonly PlanRound[], nowMs: number): PlanRound[] {
  const newest = rounds.reduce((max, round) => Math.max(max, round.endedAt), 0);
  if (newest === 0) {
    return [...rounds];
  }
  const delta = nowMs - 60_000 - newest;
  return rounds.map((round) => {
    const startedAt = round.startedAt + delta;
    const stamped = civilDayUtc(startedAt);
    return {
      ...round,
      startedAt,
      endedAt: round.endedAt + delta,
      day: stamped.day,
      hour: stamped.hour,
      roundKey: `${startedAt}-${round.round}`,
    };
  });
}

function stateOf(rounds: readonly PlanRound[]): FocusPlanState {
  return { v: 1, enabled: true, rounds: [...rounds], lifetimeRounds: rounds.length };
}

/** The seeded state for a scene, or null when the scene is not a plan scene. */
export function planSceneState(scene: PlanScene | null, nowMs: number): FocusPlanState | null {
  switch (scene) {
    case "plan-cold":
      return stateOf(fresh.rounds);
    case "plan-measured":
    case "nudge-revision":
      return stateOf(drift19_22_20.rounds);
    case "plan-mixed":
      return stateOf(mixedRounds.rounds);
    case "debrief-drifted":
      return stateOf(rebase(drift19_22_20.rounds, nowMs));
    case "debrief-clean":
      return stateOf(rebase(clean3.rounds, nowMs));
    // Twenty rounds over ten evenings from a student who is NOT improving.
    // Every volume gate passes and the trend is still refused, by `below-noise`
    // — the case the debrief used to mis-describe as missing history, and the
    // only reason this scene exists.
    case "debrief-flat":
      return stateOf(rebase(stationary20.rounds, nowMs));
    default:
      return null;
  }
}
