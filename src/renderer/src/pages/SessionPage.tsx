import type { JSX } from "react";
import { ErrorBanner, PageFrame } from "../components/page";
import { ArmedLists } from "../features/session/ArmedLists";
import { DecisionHero } from "../features/session/DecisionHero";
import { EventTimeline } from "../features/session/EventTimeline";
import { SensorRail } from "../features/session/SensorRail";
import { SessionActions } from "../features/session/SessionActions";
import { SessionClock } from "../features/session/SessionClock";
import { SessionLoading } from "../features/session/SessionStatus";
import {
  buildTimelinePreview,
  deskSensor,
  plugsSensor,
  sessionClockView,
  windowSensor,
} from "../features/session/model";
import { useSessionElapsed } from "../features/session/useSessionElapsed";
import "../features/session/session.css";
import { enabledPlugViews } from "../lib/plugsUi";
import { useAppState } from "../state/AppState";

export function SessionPage(): JSX.Element {
  const app = useAppState();
  const { elapsedSec } = useSessionElapsed(app.state.sessionActive, app.log);

  if (!app.ready) {
    return <SessionLoading />;
  }

  const clock = sessionClockView({
    sessionActive: app.state.sessionActive,
    elapsedSec,
    countdownSec: app.countdown?.seconds ?? 0,
    fuseSec: app.settings.countdownSec,
  });
  const sensors = [
    windowSensor(app.state.focus, app.lists),
    deskSensor(app.state.desk, app.settings.deskModelId),
    plugsSensor(app.plugs),
  ];
  const preview = buildTimelinePreview(app.log);
  const killNote = demoKillNote(app);

  return (
    <PageFrame className="gap-3">
      {app.error ? (
        <ErrorBanner
          title="Session error"
          message={app.error}
          hint="Start / Stop / Demo Kill still call the same IPC. Fix the fault and retry."
          onDismiss={app.clearError}
        />
      ) : null}

      <div className="grid min-h-0 gap-3 min-[960px]:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
        <DecisionHero
          decision={app.state.decision}
          detail={app.state.detail}
          sessionActive={app.state.sessionActive}
          strictMode={app.settings.strictMode}
          usingMock={app.usingMock}
        />
        <div className="flex min-w-0 flex-col gap-3">
          <SessionClock clock={clock} />
          <SessionActions
            sessionActive={app.state.sessionActive}
            onStart={() => {
              void app.startSession();
            }}
            onStop={() => {
              void app.stopSession();
            }}
            onDemoKill={() => {
              void app.demoKill();
            }}
            killNote={killNote}
          />
        </div>
      </div>

      <div className="shrink-0">
        <SensorRail sensors={sensors} />
      </div>

      <div className="shrink-0">
        <ArmedLists allowlist={app.lists.allowlist} blocklist={app.lists.blocklist} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <EventTimeline preview={preview} />
      </div>
    </PageFrame>
  );
}

function demoKillNote(app: ReturnType<typeof useAppState>): string {
  const armed = enabledPlugViews(app.plugs);
  const plugBit =
    armed.length > 0
      ? `Cuts ${armed.length} enabled plug${armed.length === 1 ? "" : "s"}: ${armed
          .map((plug) => plug.name)
          .join(", ")}. Never the study PC.`
      : "Cuts plugs when any are enabled. Never the study PC.";
  if (!app.killResult) {
    return plugBit;
  }
  const killed =
    app.killResult.killed.length > 0 ? app.killResult.killed.join(", ") : "nothing";
  return `${plugBit} Last kill: ${killed}.`;
}
