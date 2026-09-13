import { useEffect, useMemo, useState, type JSX } from "react";
import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "@shared/defaults";
import type { ForecastEvent, SessionState } from "@shared/ipc";
import { CountdownOverlay } from "@renderer/components/CountdownOverlay";
import { Chip, StatusPill } from "@renderer/components/ui";
import { cn } from "@renderer/lib/cn";
import { deskChrome, plugChrome, sessionChrome } from "@renderer/lib/format";
import { ForecastPanel } from "@renderer/features/forecast/ForecastPanel";
import { NudgeToast } from "@renderer/features/forecast/NudgeToast";
import {
  forecastSensorCard,
  overlayLeadSec,
  prearmPlate,
} from "@renderer/features/forecast/model";
import { DecisionHero } from "@renderer/features/session/DecisionHero";
import { SensorRail } from "@renderer/features/session/SensorRail";
import { SessionClock } from "@renderer/features/session/SessionClock";
import {
  deskSensor,
  plugsSensor,
  sessionClockView,
  windowSensor,
  type SensorCardView,
} from "@renderer/features/session/model";
import "@renderer/features/session/session.css";
import "@renderer/features/forecast/forecast.css";
import { LiveDesk } from "./components/LiveDesk";
import { EventFeed, StageCard } from "./components/Narration";
import { Transport } from "./components/Transport";
import { useLiveSession } from "./live";
import { stageNote } from "./narrative";
import {
  DEMO_SETTINGS,
  frameEvents,
  frameHistory,
  type DemoFrame,
} from "./pipeline";
import { buildDemoTimeline } from "./timeline";

/**
 * The judge-facing page. It owns layout and transport and nothing else: every
 * number on screen comes out of `DemoPipeline`, and every instrument is the
 * console's own component (`ForecastPanel`, `DecisionHero`, `SessionClock`,
 * `SensorRail`, `NudgeToast`, `CountdownOverlay`) rendered against the same
 * `ForecastSnapshot` / `SessionState` shapes the Electron app pushes over IPC.
 */

type Mode = "script" | "live";

interface DemoQuery {
  /** Freeze at this second of the scripted run (1-based). */
  t: number | null;
  freeze: boolean;
  mode: Mode;
}

export function parseDemoQuery(search: string): DemoQuery {
  const params = new URLSearchParams(search);
  const raw = params.get("t");
  const parsed = raw === null ? Number.NaN : Number.parseInt(raw, 10);
  return {
    t: Number.isFinite(parsed) && parsed >= 1 ? parsed : null,
    freeze: params.get("freeze") !== null,
    mode: params.get("mode") === "live" ? "live" : "script",
  };
}

export function App(): JSX.Element {
  const query = useMemo(() => parseDemoQuery(window.location.search), []);
  const timeline = useMemo(() => buildDemoTimeline(), []);
  const maxIndex = timeline.frames.length - 1;

  const [mode, setMode] = useState<Mode>(query.mode);
  const [index, setIndex] = useState(() =>
    Math.min(maxIndex, Math.max(0, (query.t ?? 1) - 1)),
  );
  const [playing, setPlaying] = useState(!query.freeze);
  const [speed, setSpeed] = useState<1 | 2>(1);

  const live = useLiveSession();

  useEffect(() => {
    if (mode !== "script" || !playing) {
      return;
    }
    const id = window.setInterval(() => {
      setIndex((current) => {
        if (current >= maxIndex) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, Math.round(1000 / speed));
    return () => window.clearInterval(id);
  }, [mode, playing, speed, maxIndex]);

  const scripted = mode === "script";
  const frames: readonly DemoFrame[] = scripted
    ? timeline.frames.slice(0, index + 1)
    : live.frames;
  const frame = frames[frames.length - 1] ?? null;
  const startTs = scripted ? timeline.startTs : (live.frames[0]?.ts ?? 0) - 1000;

  const events = scripted
    ? frameEvents(timeline.frames, index)
    : frameEvents(live.frames, live.frames.length - 1);
  const history = scripted
    ? frameHistory(timeline.frames, index)
    : frameHistory(live.frames, live.frames.length - 1);

  return (
    <div className="min-h-full bg-fp-bg pb-10 text-fp-ink">
      {/* Tight vertical rhythm on purpose: the forecast panel's calibration
          readout is the last thing above the 800 px fold at 1280×800, and the
          stills are captured there. */}
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-2.5 px-4 pt-3 min-[900px]:px-6">
        <Header
          mode={mode}
          onMode={(next) => {
            // Leaving Mode 2 releases the camera — no tally light left on
            // behind a panel the judge can no longer see.
            if (next === "script") {
              live.stop();
            }
            setMode(next);
          }}
          frame={frame}
        />

        {scripted ? (
          <Transport
            playing={playing}
            onTogglePlay={() => {
              if (index >= maxIndex) {
                setIndex(0);
              }
              setPlaying((current) => !current);
            }}
            onRestart={() => {
              setIndex(0);
              setPlaying(true);
            }}
            speed={speed}
            onToggleSpeed={() => setSpeed((current) => (current === 1 ? 2 : 1))}
            index={index}
            maxIndex={maxIndex}
            onSeek={(next) => {
              setPlaying(false);
              setIndex(next);
            }}
            marks={timeline.marks}
            t={frame?.t ?? 0}
            durationSec={timeline.durationSec}
            finished={index >= maxIndex}
          />
        ) : (
          <LiveDesk session={live} />
        )}

        {frame === null ? (
          <Standby mode={mode} />
        ) : (
          <Stage
            frame={frame}
            frames={frames}
            events={events}
            history={history}
            startTs={startTs}
            mode={mode}
            onDemoKill={() => {
              if (scripted) {
                const killAt = timeline.marks.find((mark) => mark.id === "kill");
                if (killAt) {
                  setIndex(Math.max(0, killAt.t - 1));
                  setPlaying(true);
                }
                return;
              }
              live.skipFuse(frame.countdownSec);
            }}
          />
        )}

        <Provenance />
      </div>
    </div>
  );
}

function Header(props: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  frame: DemoFrame | null;
}): JSX.Element {
  return (
    <header className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-fp-faint">
          FocusPlug · Focus Forecast
        </p>
        <Chip tone="lime">Browser demo</Chip>
        <Chip tone="mute">On-device</Chip>
        <Chip tone="mute">No network</Chip>
        <div className="ml-auto flex items-center gap-1" role="tablist" aria-label="Demo mode">
          <ModeTab
            active={props.mode === "script"}
            onClick={() => props.onMode("script")}
            label="Scripted run"
          />
          <ModeTab
            active={props.mode === "live"}
            onClick={() => props.onMode("live")}
            label="Live Desk AI"
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        {/* One line at 1240 px+ (761 px of column, ~120 characters). The
            second line this used to wrap to cost 20 px that the forecast
            panel needs to clear the fold. */}
        <p className="max-w-3xl flex-1 text-[13px] leading-5 text-fp-mute">
          Predicts the tab-out before it happens, then shortens the fuse it will need —{" "}
          <span className="text-fp-ink">simulated student</span>,{" "}
          <span className="text-fp-ink">real model</span>,{" "}
          <span className="text-fp-ink">real policy</span>.
        </p>
        {props.frame ? <StatusStrip frame={props.frame} /> : null}
      </div>
    </header>
  );
}

/**
 * The console's titlebar status cluster. `StatusCluster` itself reads
 * `useAppState()`, which only exists inside the Electron app's provider, so
 * the demo composes the same three pills from the same pure view-models
 * (`sessionChrome` / `deskChrome` / `plugChrome`) and the same `StatusPill`.
 */
function StatusStrip(props: { frame: DemoFrame }): JSX.Element {
  const { frame } = props;
  const session = sessionChrome({
    sessionActive: true,
    focus: frame.focus,
    desk: frame.desk,
    decision: frame.decision,
    countdownSec: frame.countdownSec,
    detail: frame.detail,
  });
  const desk = deskChrome(frame.desk);
  const plugs = plugChrome([]);
  return (
    <div
      className="flex min-w-0 shrink-0 items-center gap-1.5"
      role="group"
      aria-label="Live session, desk AI, and plug status"
    >
      {[session, desk, plugs].map((status) => (
        <StatusPill
          key={status.label}
          label={status.label}
          detail={status.detail}
          tone={status.tone}
          live={status.live}
        />
      ))}
    </div>
  );
}

function ModeTab(props: {
  active: boolean;
  onClick: () => void;
  label: string;
}): JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={props.active}
      onClick={props.onClick}
      className={cn(
        "fp-btn h-7 rounded-md border px-3 text-[11px] font-semibold uppercase tracking-[0.1em]",
        props.active
          ? "border-fp-lime/40 bg-fp-lime/10 text-fp-lime"
          : "border-fp-line text-fp-mute hover:bg-fp-hover hover:text-fp-ink",
      )}
    >
      {props.label}
    </button>
  );
}

function Standby(props: { mode: Mode }): JSX.Element {
  return (
    <section className="fp-card px-4 py-6">
      <p className="text-[13px] text-fp-mute">
        {props.mode === "live"
          ? "Enable the webcam above to start a live session. The scripted run is the full story if you would rather not."
          : "Press play to start the scripted session."}
      </p>
    </section>
  );
}

function Stage(props: {
  frame: DemoFrame;
  frames: readonly DemoFrame[];
  events: readonly ForecastEvent[];
  history: readonly { ts: number; risk: number }[];
  startTs: number;
  mode: Mode;
  onDemoKill: () => void;
}): JSX.Element {
  const { frame } = props;
  const clock = sessionClockView({
    sessionActive: true,
    elapsedSec: frame.t,
    countdownSec: frame.countdownSec,
    fuseSec: frame.snapshot.baseFuseSec,
  });
  const state: SessionState = {
    sessionActive: true,
    focus: frame.focus,
    desk: frame.desk,
    decision: frame.decision,
    countdownSec: frame.countdownSec,
    detail: frame.detail,
  };
  // The console's own four cards. `href` is stripped: those links point at
  // Settings/Allowlist pages that only exist inside the Electron app.
  const sensors: SensorCardView[] = [
    windowSensor(frame.focus, {
      allowlist: DEFAULT_ALLOWLIST,
      blocklist: DEFAULT_BLOCKLIST,
    }),
    deskSensor(frame.desk, DEMO_SETTINGS.deskModelId),
    forecastSensorCard(frame.snapshot, {
      enabled: true,
      sessionActive: true,
      greyApp: frame.greyApp,
    }),
    plugsSensor([]),
  ].map((sensor) => ({ ...sensor, href: undefined }));

  // The toast is visible for 8 s of session time after a nudge — deterministic
  // under scrubbing, and correct in live mode too.
  const nudge =
    [...props.events]
      .reverse()
      .find(
        (event): event is Extract<ForecastEvent, { type: "forecast_nudge" }> =>
          event.type === "forecast_nudge" &&
          frame.snapshot.ts - event.ts >= 0 &&
          frame.snapshot.ts - event.ts <= 8_000,
      ) ?? null;

  return (
    <>
      {/* Verdict, clocks and the one-line "what am I looking at" note share a
          row so the forecast instrument stays above the fold at 1280×800. */}
      {/* The clock column's floor is 292 px because `00:37` renders at 40 px
          mono in a half-column: anything narrower clips the last digit. */}
      <div className="grid min-w-0 gap-3 min-[960px]:grid-cols-[minmax(0,1.4fr)_minmax(292px,0.8fr)] min-[1180px]:grid-cols-[minmax(0,1.15fr)_minmax(292px,0.66fr)_minmax(0,1.05fr)]">
        <DecisionHero
          decision={frame.decision}
          detail={frame.detail}
          sessionActive
          strictMode={DEMO_SETTINGS.strictMode}
          compact
        />
        <SessionClock clock={clock} prearm={prearmPlate(frame.snapshot)} />
        <div className="min-w-0 min-[960px]:col-span-2 min-[1180px]:col-span-1">
          <StageCard note={stageNote(frame, props.events)} />
        </div>
      </div>

      <ForecastPanel
        snapshot={frame.snapshot}
        events={props.events}
        history={props.history}
        enabled
        prearmEnabled={DEMO_SETTINGS.forecastPrearmEnabled}
        sessionActive
        nudgeRisk={DEMO_SETTINGS.forecastNudgeRisk}
        prearmRisk={DEMO_SETTINGS.forecastPrearmRisk}
        greyApp={frame.greyApp}
      />

      <SensorRail sensors={sensors} />

      <EventFeed frames={props.frames} startTs={props.startTs} />

      <NudgeToast
        event={nudge}
        snapshot={frame.snapshot}
        greyApp={frame.greyApp}
        frozen
      />

      {frame.countdownSec > 0 ? (
        <CountdownOverlay
          seconds={frame.countdownSec}
          total={frame.fuseTotalSec}
          reason={frame.detail}
          state={state}
          plugs={[]}
          preview={false}
          forecastLeadSec={overlayLeadSec(props.events, frame.snapshot.ts)}
          onDemoKill={props.onDemoKill}
          onDismiss={props.onDemoKill}
        />
      ) : null}
    </>
  );
}

function Provenance(): JSX.Element {
  return (
    <footer className="fp-card px-4 py-3" aria-label="Provenance">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
        Simulated inputs · real model · real policy
      </p>
      <ul className="mt-2 grid gap-1.5 text-[12px] leading-5 text-fp-mute min-[860px]:grid-cols-2">
        <li>
          <span className="text-fp-ink">Simulated:</span> the student. A scripted stream of
          window-focus and desk events stands in for the Win32 foreground monitor — raw
          behaviour, never features and never a risk number.
        </li>
        <li>
          <span className="text-fp-ink">Real:</span> the model.{" "}
          <code className="font-mono text-[11px] text-fp-ink">src/shared/forecast</code> — the
          same telemetry ring, feature extractor, trained{" "}
          <code className="font-mono text-[11px] text-fp-ink">weights.json</code> and escalation
          reducer the Electron main process runs, evaluated in this tab.
        </li>
        <li>
          <span className="text-fp-ink">Real:</span> the policy.{" "}
          <code className="font-mono text-[11px] text-fp-ink">src/shared/policy</code> decides
          On task / Distracted / Away, starts the countdown and fires the kill. The forecast
          can only shorten one number — <code className="font-mono text-[11px]">countdownSec</code>,
          floored at 3 s and never longer than the armed fuse.
        </li>
        <li>
          <span className="text-fp-ink">Not here:</span> the enforcement. A browser tab cannot
          force-quit Discord or cut a smart plug — the kill you see is the policy engine&apos;s
          decision and its targets, which the Windows app executes.
        </li>
      </ul>
    </footer>
  );
}
