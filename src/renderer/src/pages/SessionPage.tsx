import { useEffect, useState, type JSX } from "react";
import type { FaceId } from "@shared/faces";
import type { ForecastEvent } from "@shared/ipc";
import { EmptyState, ErrorBanner, PageFrame } from "../components/page";
import { DangerButton, GhostButton, PrimaryButton } from "../components/ui";
import {
  FaceHost,
  buildFaceProps,
  readFaceOverride,
  readProgressOverride,
  selectedFaceId,
} from "../features/faces";
import { ForecastPanel } from "../features/forecast/ForecastPanel";
import { NudgeToast } from "../features/forecast/NudgeToast";
import { forecastSensorCard, prearmPlate } from "../features/forecast/model";
import { DecisionHero } from "../features/session/DecisionHero";
import { SensorRail } from "../features/session/SensorRail";
import { SessionClock } from "../features/session/SessionClock";
import {
  STAGE_ORDER,
  buildTimelinePreview,
  deskSensor,
  plugsSensor,
  sessionClockView,
  stageHint,
  stageLabel,
  windowSensor,
  type TimelinePreview,
} from "../features/session/model";
import { useSessionElapsed } from "../features/session/useSessionElapsed";
import { Stakes } from "../features/timer/Stakes";
import { cn } from "../lib/cn";
import { formatClock } from "../lib/format";
import { IconBolt } from "../lib/icons";
import { enabledPlugViews } from "../lib/plugsUi";
import { routeHash } from "../lib/routes";
import { toneChip, toneText } from "../lib/tone";
import { useAppState } from "../state/AppState";

/**
 * The live console. The plan page (SetupPage) is what you edit before the lock
 * goes on and LockPage is the sealed room; this is the instrumented view of a
 * session that is already armed — what the policy engine currently believes,
 * what the forecast thinks is coming, and the enforcement chain as it happens.
 *
 * `onLock` is passed when a plan owns this session — it is the way back to lock
 * mode, and its presence is also what tells the console the plan, not a button
 * here, decides when the session stops.
 */
export function SessionPage(props: { onLock?: () => void }): JSX.Element {
  const app = useAppState();
  const { elapsedSec, startedAt, now } = useSessionElapsed(
    app.state.sessionActive,
    app.log,
    app.sessionStartedAt,
  );
  const [previewFace, setPreviewFace] = useState<FaceId | null>(() => readFaceOverride());

  useEffect(() => {
    const apply = (): void => {
      const next = readFaceOverride();
      if (next) {
        setPreviewFace(next);
      }
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, []);

  if (!app.ready) {
    return (
      <PageFrame>
        <EmptyState kicker="Session" title="Loading the console…">
          Waiting for session state, lists, settings and the event log. No placeholder sensor
          readings.
        </EmptyState>
      </PageFrame>
    );
  }

  const clock = sessionClockView({
    sessionActive: app.state.sessionActive,
    elapsedSec,
    countdownSec: app.countdown?.seconds ?? 0,
    fuseSec: app.settings.countdownSec,
  });
  // Live process name for grey-app copy — only when focus matched no list.
  const greyApp =
    app.state.focus && !app.state.focus.matchedAllow && !app.state.focus.matchedBlock
      ? app.state.focus.processName
      : undefined;
  const sensors = [
    windowSensor(app.state.focus, app.lists),
    deskSensor(app.state.desk, app.settings.deskModelId),
    forecastSensorCard(app.forecast, {
      enabled: app.settings.forecastEnabled,
      sessionActive: app.state.sessionActive,
      greyApp,
    }),
    plugsSensor(app.plugs),
  ];
  const preview = buildTimelinePreview(app.log);
  const plate = app.settings.forecastEnabled ? prearmPlate(app.forecast) : null;
  const latestNudge =
    app.settings.forecastEnabled && app.state.sessionActive
      ? (app.forecastEvents.find(
          (event): event is Extract<ForecastEvent, { type: "forecast_nudge" }> =>
            event.type === "forecast_nudge",
        ) ?? null)
      : null;
  const faceId = previewFace ?? selectedFaceId(app.settings.faceId);
  const built = buildFaceProps({
    sessionActive: app.state.sessionActive,
    decision: app.state.decision,
    elapsedSec,
    countdownSec: app.countdown?.seconds ?? 0,
    fuseArmedSec: app.settings.countdownSec,
    startedAt,
    log: app.log,
    now: new Date(now),
    width: 960,
    height: 300,
  });
  const progressOverride = readProgressOverride();
  const face = progressOverride === null ? built : { ...built, progress: progressOverride };

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

      <FaceHost
        faceId={faceId}
        face={face}
        onFaceId={(id) => {
          setPreviewFace(null);
          void app.patchSettings({ faceId: id });
        }}
      />

      <div className="grid shrink-0 gap-3 min-[960px]:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
        <DecisionHero
          decision={app.state.decision}
          detail={app.state.detail}
          sessionActive={app.state.sessionActive}
          strictMode={app.settings.strictMode}
          usingMock={app.usingMock}
        />
        <div className="flex min-w-0 flex-col gap-3">
          <SessionClock clock={clock} prearm={plate} />
          <SessionActions onLock={props.onLock} />
        </div>
      </div>

      <div className="shrink-0">
        <ForecastPanel
          snapshot={app.forecast}
          events={app.forecastEvents}
          history={app.forecastHistory}
          enabled={app.settings.forecastEnabled}
          prearmEnabled={app.settings.forecastPrearmEnabled}
          sessionActive={app.state.sessionActive}
          nudgeRisk={app.settings.forecastNudgeRisk}
          prearmRisk={app.settings.forecastPrearmRisk}
          greyApp={greyApp}
        />
      </div>

      <div className="shrink-0">
        <SensorRail sensors={sensors} />
      </div>

      <div className="shrink-0">
        <Stakes lists={app.lists} plugs={app.plugs} settings={app.settings} />
      </div>

      {/* The forecast instrument made the page taller than one viewport:
          keep the timeline readable and let #fp-main scroll the overflow. */}
      <div className="flex min-h-[180px] flex-1 flex-col">
        <EventTimeline preview={preview} />
      </div>

      <NudgeToast event={latestNudge} snapshot={app.forecast} greyApp={greyApp} />
    </PageFrame>
  );
}

/**
 * The things you can do to a live session by hand. Demo Kill names its own
 * blast radius before you press it — that is the part people doubt.
 *
 * When a plan owns the session (`onLock`), Start/Stop is not offered: the plan
 * is the authority on whether enforcement is armed, and a Stop here would
 * disarm the main process while the plan — and the lock face — still said
 * locked. What you get instead is the way back into lock mode; ending early is
 * the hold switch there, deliberately.
 */
function SessionActions(props: { onLock?: () => void }): JSX.Element {
  const app = useAppState();
  const armed = enabledPlugViews(app.plugs);
  const plugNote =
    armed.length > 0
      ? `Cuts ${armed.length} enabled plug${armed.length === 1 ? "" : "s"}: ${armed
          .map((plug) => plug.name)
          .join(", ")}. Never the study PC.`
      : "Cuts plugs when any are enabled. Never the study PC.";
  const killed = app.killResult
    ? app.killResult.killed.length > 0
      ? app.killResult.killed.join(", ")
      : "nothing"
    : null;

  return (
    <section className="fp-card flex min-w-0 flex-col gap-2 px-4 py-3" aria-label="Session actions">
      <div className="flex flex-wrap items-center gap-2">
        {props.onLock ? (
          <GhostButton onClick={props.onLock}>Back to lock mode</GhostButton>
        ) : app.state.sessionActive ? (
          <GhostButton
            onClick={() => {
              void app.stopSession();
            }}
          >
            Stop session
          </GhostButton>
        ) : (
          <PrimaryButton
            onClick={() => {
              void app.startSession();
            }}
          >
            Start session
          </PrimaryButton>
        )}
        <DangerButton
          onClick={() => {
            void app.demoKill();
          }}
        >
          <IconBolt className="h-4 w-4" />
          Demo Kill
        </DangerButton>
      </div>
      <p className="text-[12px] leading-4 text-fp-mute">{plugNote}</p>
      {props.onLock ? (
        <p className="text-[12px] leading-4 text-fp-faint">
          The plan is running it. Pause, skip and hold-to-end live in lock mode.
        </p>
      ) : null}
      {killed ? <p className="text-[12px] text-fp-faint">Last kill: {killed}.</p> : null}
    </section>
  );
}

/**
 * Cause → countdown → consequence → recovery. The Log page is the full record
 * with filters; this is the enforcement chain of the session in front of you,
 * which is why forecast rows belong here — they are what explains a short fuse.
 */
function EventTimeline(props: { preview: TimelinePreview }): JSX.Element {
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="Enforcement timeline">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <p className="fp-section-label">Event timeline</p>
        <div className="flex items-center gap-3">
          <p className="hidden text-[11px] text-fp-faint sm:block">
            Cause → countdown → consequence → recovery
          </p>
          <a
            href={routeHash("log")}
            className="text-[11px] font-medium text-fp-mute hover:text-fp-ink"
          >
            Open log
          </a>
        </div>
      </div>

      <ol className="grid grid-cols-2 gap-2 min-[900px]:grid-cols-4">
        {STAGE_ORDER.map((stage) => (
          <li
            key={stage}
            className={cn(
              "fp-card px-3 py-2",
              props.preview.reached[stage] ? toneChip(stageTone(stage)) : "text-fp-faint",
            )}
          >
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em]">
              {stageLabel(stage)}
            </p>
            <p className="mt-1 text-[11px] leading-4 text-fp-mute">{stageHint(stage)}</p>
          </li>
        ))}
      </ol>

      <div className="fp-card mt-3 min-h-0 flex-1 overflow-auto">
        {props.preview.empty ? (
          <div className="flex h-full min-h-[9rem] flex-col justify-center px-5">
            <EmptyState kicker="Waiting" title="Start a session to record the enforcement chain">
              Blocked focus or desk Away (cause), the fuse (countdown), app kill + plug cut
              (consequence), then unlock (recovery). List-editor noise stays on the Log page.
            </EmptyState>
          </div>
        ) : (
          <ol>
            {props.preview.events.map((event, index) => (
              <li
                key={`${event.ts}-${event.kind}-${index}`}
                className="grid grid-cols-[72px_88px_72px_minmax(0,1fr)] items-center gap-2 border-b border-fp-line px-4 py-1.5 last:border-b-0"
              >
                <time className="font-mono text-[11px] text-fp-faint tabular">
                  {formatClock(event.ts)}
                </time>
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-[0.12em]",
                    toneText(stageTone(event.stage)),
                  )}
                >
                  {stageLabel(event.stage)}
                </span>
                <span className="truncate font-mono text-[11px] uppercase tracking-[0.08em] text-fp-mute">
                  {event.kind}
                </span>
                <span className="truncate text-[13px] text-fp-ink" title={event.detail}>
                  {event.detail}
                </span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function stageTone(stage: (typeof STAGE_ORDER)[number]): "focus" | "red" | "warn" | "mute" {
  if (stage === "countdown") return "warn";
  if (stage === "consequence") return "red";
  if (stage === "recovery") return "focus";
  return "mute";
}
