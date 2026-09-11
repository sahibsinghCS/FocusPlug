import type { JSX } from "react";
import { Chip } from "../components/ui";
import { ArmedLists } from "../features/session/ArmedLists";
import { DecisionHero } from "../features/session/DecisionHero";
import { EventTimeline } from "../features/session/EventTimeline";
import { SensorRail } from "../features/session/SensorRail";
import { SessionActions } from "../features/session/SessionActions";
import { SessionClock } from "../features/session/SessionClock";
import { SessionErrorBanner, SessionLoading } from "../features/session/SessionStatus";
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
    <div className="flex h-full min-h-0 flex-col px-5 py-4 min-[1100px]:px-6">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">
            Command center
          </p>
          <p className="truncate text-[13px] text-fp-mute">
            One decision. Live sensors. Kill is the consequence.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {app.usingMock ? <Chip tone="amber">Renderer mock</Chip> : <Chip tone="lime">Live IPC</Chip>}
          <Chip tone={app.settings.strictMode ? "lime" : "mute"}>
            {app.settings.strictMode ? "Strict" : "Loose"}
          </Chip>
        </div>
      </header>

      {app.error ? (
        <div className="mt-3">
          <SessionErrorBanner message={app.error} onDismiss={app.clearError} />
        </div>
      ) : null}

      <div className="mt-3 grid min-h-0 gap-3 min-[960px]:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
        <DecisionHero
          decision={app.state.decision}
          detail={app.state.detail}
          sessionActive={app.state.sessionActive}
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

      <div className="mt-3 shrink-0">
        <SensorRail sensors={sensors} />
      </div>

      <div className="mt-3 shrink-0">
        <ArmedLists allowlist={app.lists.allowlist} blocklist={app.lists.blocklist} />
      </div>

      <div className="mt-3 flex min-h-0 flex-1 flex-col">
        <EventTimeline preview={preview} />
      </div>
    </div>
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
