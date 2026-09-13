import { useCallback, useEffect, useMemo, useState } from "react";
import type { FocusPlanState, FocusPlugApi, PlanRecommendation, PlanRound } from "@shared/ipc";
import { PLAN_LEDGER_CAP, recommend, selectWindow, type LivePlanRound } from "@shared/plan";
import { getApi } from "../../lib/api";
import { useAppState } from "../../state/AppState";

/**
 * Focus Plan's own read of main: the closed-round ledger, plus the round-close
 * push. It is deliberately not folded into `AppState` — the plan is a coaching
 * layer that observes, and keeping its fetch here means nothing in the session
 * loop's own state has to know it exists.
 *
 * Every call is feature-detected. The preload of an older build, `probe.ts`
 * and the smoke scripts do not expose these channels, and a missing channel
 * must degrade to "no history" rather than throw on a page that is about to
 * arm a process killer.
 */

const EMPTY_STATE: FocusPlanState = { v: 1, enabled: true, rounds: [], lifetimeRounds: 0 };

export interface FocusPlanHandle {
  state: FocusPlanState;
  /** The first fetch has resolved (or been found unavailable). */
  ready: boolean;
  /** Forget my focus history. Resolves with the emptied state. */
  reset: () => Promise<void>;
  error: string | null;
}

type PlanCapableApi = FocusPlugApi & {
  planGetState?: () => Promise<FocusPlanState>;
  planReset?: () => Promise<FocusPlanState>;
  onPlanRound?: (cb: (round: PlanRound) => void) => () => void;
};

function hasPlanChannels(api: FocusPlugApi): api is Required<
  Pick<PlanCapableApi, "planGetState" | "planReset" | "onPlanRound">
> &
  FocusPlugApi {
  const candidate = api as PlanCapableApi;
  return (
    typeof candidate.planGetState === "function" &&
    typeof candidate.planReset === "function" &&
    typeof candidate.onPlanRound === "function"
  );
}

/** Newest last, capped exactly like the ledger main writes. */
function withRound(state: FocusPlanState, round: PlanRound): FocusPlanState {
  const rounds = [...state.rounds.filter((item) => item.roundKey !== round.roundKey), round]
    .sort((a, b) => a.startedAt - b.startedAt)
    .slice(-PLAN_LEDGER_CAP);
  return { ...state, rounds, lifetimeRounds: Math.max(state.lifetimeRounds, rounds.length) };
}

export function useFocusPlan(): FocusPlanHandle {
  const handle = useMemo(() => getApi(), []);
  const { api } = handle;
  const [state, setState] = useState<FocusPlanState>(EMPTY_STATE);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!hasPlanChannels(api)) {
      setReady(true);
      return;
    }
    void api
      .planGetState()
      .then((next) => {
        if (live) {
          setState(next);
          setReady(true);
        }
      })
      .catch((caught: unknown) => {
        if (live) {
          setError(caught instanceof Error ? caught.message : "Could not read focus history");
          setReady(true);
        }
      });
    const off = api.onPlanRound((round) => {
      setState((current) => withRound(current, round));
    });
    return () => {
      live = false;
      off();
    };
  }, [api]);

  const reset = useCallback(async () => {
    if (!hasPlanChannels(api)) {
      return;
    }
    try {
      setState(await api.planReset());
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not clear focus history");
    }
  }, [api]);

  return { state, ready, reset, error };
}

export interface PlanRecommendationHandle extends FocusPlanHandle {
  /**
   * Null exactly when the feature is switched off — off reproduces today's
   * screens, so every surface can render nothing on a null and be correct.
   */
  recommendation: PlanRecommendation | null;
  /** The estimator window, discarded rounds included for the disclosure. */
  estimatorWindow: PlanRound[];
}

/**
 * The recommendation every Focus Plan surface reads, computed from the ledger,
 * the two settings switches, and — on a fresh install, inside the first round
 * — the live round the renderer assembles. Nothing here is recorded: it is a
 * pure read, and the number moves only when a round closes.
 */
export function usePlanRecommendation(live: LivePlanRound | null = null): PlanRecommendationHandle {
  const app = useAppState();
  const plan = useFocusPlan();
  const enabled = app.settings.focusPlanEnabled && plan.state.enabled;
  const rounds = plan.state.rounds;
  const forecastEnabled = app.settings.forecastEnabled;
  const stretchEnabled = app.settings.focusPlanStretchEnabled;

  /* Not named `window`: this is the estimator's window of rounds, and shadowing
     the global in a renderer module is a trap for the next reader. */
  const estimatorWindow = useMemo(
    () => selectWindow(rounds, { nowMs: Date.now(), includeDiscarded: true }),
    [rounds],
  );

  const recommendation = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return recommend({ rounds: estimatorWindow, live, forecastEnabled, stretchEnabled });
  }, [enabled, estimatorWindow, live, forecastEnabled, stretchEnabled]);

  return { ...plan, recommendation, estimatorWindow };
}
