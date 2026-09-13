import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";
import type { PlanRecommendation } from "@shared/ipc";
import { parseRoute, type RouteId, ROUTES, navigate } from "../lib/routes";
import { countdownIsPreview } from "../features/session/model";
import {
  armContextFor,
  liveRoundFor,
  planContextFor,
  revisionFor,
  usePlanRecommendation,
} from "../features/focusplan";
import { useAppState } from "../state/AppState";
import { driftPauseStep } from "../features/timer/driftPause";
import { useSessionTimer, type EnforceArm } from "../features/timer/useSessionTimer";
import { shellView, viewIsLocked } from "../features/timer/view";
import { ErrorBanner } from "./page";
import { KillOverlay } from "../features/kill/KillOverlay";
import { NudgeOverlay } from "../features/nudge/NudgeOverlay";
import { TopRail } from "./TopRail";
import { SetupPage } from "../pages/SetupPage";
import { SessionPage } from "../pages/SessionPage";
import { LockPage } from "../pages/LockPage";
import { ListPage } from "../pages/ListPage";
import { SettingsPage } from "../pages/SettingsPage";
import { PlugsPage } from "../pages/PlugsPage";
import { LogPage } from "../pages/LogPage";

function useHashRoute(): RouteId {
  const [route, setRoute] = useState<RouteId>(() => parseRoute(window.location.hash));

  useEffect(() => {
    const onHash = (): void => {
      setRoute(parseRoute(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) {
      window.location.hash = "#/";
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return route;
}

export function Shell(): JSX.Element {
  const app = useAppState();
  const route = useHashRoute();
  const { startSession, stopSession } = app;

  /* Read at arm time rather than closed over. `onEnforce` has to exist before
     `useSessionTimer`, and the recommendation is only known after it — a ref
     is what breaks that circle, and the arm fires from an effect, so the
     value is always the one the card was showing when the switch was thrown. */
  const recommendationRef = useRef<PlanRecommendation | null>(null);

  // The plan is what arms enforcement: focus blocks start a real session,
  // breaks and pauses stop it, so a break genuinely hands Discord back.
  //
  // The second argument is the Focus Plan arm context. It is advisory: main
  // hands it to `declareRound` and then calls `controller.start()` regardless,
  // so a null context costs a labelled round and nothing else.
  const onEnforce = useCallback(
    (armed: boolean, arm: EnforceArm | null): void => {
      if (!armed) {
        void stopSession();
        return;
      }
      const base = arm === null ? null : armContextFor(arm);
      void startSession(
        base === null ? undefined : planContextFor(base, recommendationRef.current),
      );
    },
    [startSession, stopSession],
  );

  const timer = useSessionTimer({ onEnforce });

  /* A confirmed drift stops the study clock, and only a deliberate restart
     starts it again — time on your phone or out of the room must not accrue as
     study time. Main is what decides "confirmed": sustained readings above
     that head's confidence floor, `uncertain` never counting, and a setting
     per kind, all of it landing here as `pause: true` on the nudge it already
     pushes. Read through a ref so the effect keys on the event alone: every
     pause-carrying nudge is consumed exactly once, on arrival, which is what
     stops a stale one from re-pausing a clock they have just restarted. */
  const timerRef = useRef(timer);
  timerRef.current = timer;
  const handledNudgeTs = useRef<number | null>(null);
  useEffect(() => {
    const clock = timerRef.current;
    const step = driftPauseStep({
      nudge: app.nudge,
      handledTs: handledNudgeTs.current,
      status: clock.status,
      position: clock.position,
    });
    handledNudgeTs.current = step.handledTs;
    if (step.pause !== null) {
      clock.pauseForDrift(step.pause);
    }
  }, [app.nudge]);

  /* The round in progress, assembled here so main never has to stream one.
     It is what makes the cold-start wobble rung reachable inside the very
     first round of a fresh install, and what feeds `reviseBreak`. */
  const live = useMemo(
    () =>
      liveRoundFor({
        startedAtMs: timer.startedAtMs,
        position: timer.position,
        forecastOn: app.settings.forecastEnabled,
        forecastEvents: app.forecastEvents,
        history: app.forecastHistory,
      }),
    [
      timer.startedAtMs,
      timer.position,
      app.settings.forecastEnabled,
      app.forecastEvents,
      app.forecastHistory,
    ],
  );
  const plan = usePlanRecommendation(live);
  recommendationRef.current = plan.recommendation;

  /* Focus Plan's only live surface (decision 5): one extra sentence on a
     nudge main already fired. Computed only while a nudge is up, and
     `reviseBreak` refuses outright whenever a countdown is on screen — the
     plan never offers a break that could read as a way out of the fuse. */
  const revision = useMemo(() => {
    if (app.nudge === null || plan.recommendation === null) {
      return null;
    }
    return revisionFor({
      live,
      position: timer.position,
      estimateMin: plan.recommendation.estimate.medianMin,
      risk: app.forecast?.risk ?? null,
      nudgeRisk: app.settings.forecastNudgeRisk,
      countdownActive: app.countdown !== null,
    });
  }, [
    app.nudge,
    app.forecast,
    app.countdown,
    app.settings.forecastNudgeRisk,
    plan.recommendation,
    live,
    timer.position,
  ]);
  // Lock is a *view* of a live session, not the session itself. Enforcement is
  // armed exactly while the plan runs, so deriving the lock from the lifecycle
  // alone is what would make the live console unreachable in the shipped app.
  const view = shellView({
    status: timer.status,
    consoleOpen: timer.consoleOpen,
    sessionActive: app.state.sessionActive,
  });
  const locked = viewIsLocked(view);

  useEffect(() => {
    if (locked) {
      return;
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.altKey && event.key >= "1" && event.key <= "6") {
        const target = ROUTES[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          navigate(target.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [locked]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-fp-bg text-fp-ink">
      {locked ? (
        <LockPage timer={timer} />
      ) : (
        <>
          <a href="#fp-main" className="fp-skip">
            Skip to main
          </a>
          <TopRail route={route} showStatus={route !== "session"} />
          {app.error && route !== "session" && route !== "log" ? (
            <div className="fp-page-x py-2">
              <ErrorBanner message={app.error} onDismiss={app.clearError} />
            </div>
          ) : null}
          <main id="fp-main" className="min-h-0 min-w-0 flex-1 overflow-auto" tabIndex={-1}>
            {/* One route, two states. The plan is what you edit before the
                lock goes on; a live session you have stepped out of lock mode
                to see becomes the console — decision, forecast, sensors,
                timeline. Lock mode itself is the full-screen LockPage above,
                and `Console` there is the door between them. */}
            {route === "session" ? (
              view === "console" ? (
                <SessionPage onLock={timer.status === "setup" ? undefined : timer.closeConsole} />
              ) : (
                <SetupPage timer={timer} />
              )
            ) : null}
            {route === "allowlist" ? <ListPage kind="allow" /> : null}
            {route === "blocklist" ? <ListPage kind="block" /> : null}
            {route === "plugs" ? <PlugsPage /> : null}
            {route === "settings" ? <SettingsPage /> : null}
            {route === "log" ? <LogPage /> : null}
          </main>
        </>
      )}

      {app.countdown ? (
        <KillOverlay
          seconds={app.countdown.seconds}
          total={app.countdown.total}
          reason={app.countdown.reason}
          state={app.state}
          plugs={app.plugs}
          preview={countdownIsPreview(app.state.countdownSec)}
          onDemoKill={() => {
            void app.demoKill();
          }}
          onDismiss={app.dismissPreview}
        />
      ) : null}

      {app.nudge ? (
        <NudgeOverlay
          nudge={app.nudge}
          position={timer.position}
          revision={revision}
          onDismiss={app.dismissNudge}
        />
      ) : null}
    </div>
  );
}
