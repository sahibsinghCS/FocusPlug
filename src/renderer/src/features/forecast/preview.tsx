import { StrictMode, useEffect, useMemo, useState, type JSX } from "react";
import { createRoot } from "react-dom/client";
import { DEFAULT_SETTINGS } from "@shared/defaults";
import type { ForecastEvent, SessionState } from "@shared/ipc";
import { FORECAST_BASIS, FORECAST_PARAM_COUNT } from "@shared/forecast";
import "../../index.css";
import { Chip } from "../../components/ui";
import { cn } from "../../lib/cn";
import { KillOverlay } from "../kill/KillOverlay";
import { DecisionHero } from "../session/DecisionHero";
import { SessionClock } from "../session/SessionClock";
import { sessionClockView } from "../session/model";
import { ForecastPanel } from "./ForecastPanel";
import { NudgeToast } from "./NudgeToast";
import { describeForecastEvent, overlayLeadSec, prearmPlate } from "./model";
import {
  REPLAY_BEATS,
  buildForecastReplay,
  replayEvents,
  replayHistory,
  type ForecastReplay,
} from "./replay";
import "./forecast.css";

/**
 * Browser judge demo: the scripted replay pushed through the SAME
 * @shared/forecast core the Electron main process runs, rendered with the
 * console's own components. Scrub bar + beat chips; `?t=<sec>&freeze=1`
 * gives deterministic stills. Network tab stays silent — everything is
 * on-device, in this tab.
 */

interface PreviewQuery {
  t: number | null;
  freeze: boolean;
}

export function parsePreviewQuery(search: string): PreviewQuery {
  const params = new URLSearchParams(search);
  const rawT = params.get("t");
  const parsed = rawT === null ? Number.NaN : Number.parseInt(rawT, 10);
  return {
    t: Number.isFinite(parsed) && parsed >= 1 ? parsed : null,
    freeze: params.get("freeze") !== null,
  };
}

function findEventT(
  replay: ForecastReplay,
  match: (event: ForecastEvent) => boolean,
): number | null {
  for (const frame of replay.frames) {
    if (frame.events.some(match)) {
      return frame.t;
    }
  }
  return null;
}

function Preview(): JSX.Element {
  const query = useMemo(() => parsePreviewQuery(window.location.search), []);
  const replay = useMemo(() => buildForecastReplay(), []);
  const maxIndex = replay.frames.length - 1;
  const [index, setIndex] = useState(() =>
    Math.min(maxIndex, Math.max(0, (query.t ?? 1) - 1)),
  );
  const [playing, setPlaying] = useState(!query.freeze);

  useEffect(() => {
    if (!playing) {
      return;
    }
    const timer = setInterval(() => {
      setIndex((current) => {
        if (current >= maxIndex) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [playing, maxIndex]);

  const frame = replay.frames[index] ?? replay.frames[0];
  if (!frame) {
    return <p className="p-6 text-fp-red">Replay produced no frames.</p>;
  }
  const events = replayEvents(replay, index);
  const history = replayHistory(replay, index);
  const greyApp =
    frame.focus.matchedAllow || frame.focus.matchedBlock
      ? undefined
      : frame.focus.processName;

  const clock = sessionClockView({
    sessionActive: true,
    elapsedSec: frame.t,
    countdownSec: frame.countdownSec,
    fuseSec: frame.snapshot.baseFuseSec,
  });
  const plate = prearmPlate(frame.snapshot);

  const state: SessionState = {
    sessionActive: true,
    focus: frame.focus,
    desk: frame.desk,
    decision: frame.decision,
    countdownSec: frame.countdownSec,
    detail: frame.detail,
  };

  // Beat chips — anchored on the emitted events, not hardcoded guesses.
  const tNudge = findEventT(replay, (event) => event.type === "forecast_nudge");
  const tPrearm = findEventT(replay, (event) => event.type === "forecast_prearm");
  const tReceipt = findEventT(
    replay,
    (event) => event.type === "forecast_hit" || event.type === "forecast_miss",
  );
  const tStoodDown = findEventT(
    replay,
    (event) => event.type === "forecast_clear" && event.wasPrearmed,
  );
  const beats: Array<{ label: string; t: number | null }> = [
    { label: "warm-up", t: 8 },
    { label: "calm", t: REPLAY_BEATS.calm + 2 },
    { label: "nudge", t: tNudge },
    { label: "elevated", t: tPrearm !== null ? tPrearm - 3 : null },
    { label: "pre-arm", t: tPrearm !== null ? tPrearm + 3 : null },
    { label: "drift", t: tReceipt !== null ? tReceipt + 2 : null },
    { label: "stood down", t: tStoodDown },
  ];

  // Toast: visible for 8 replay-seconds after a nudge (scrub-deterministic).
  const nudgeEvent =
    [...events]
      .reverse()
      .find(
        (event): event is Extract<ForecastEvent, { type: "forecast_nudge" }> =>
          event.type === "forecast_nudge" &&
          frame.snapshot.ts - event.ts >= 0 &&
          frame.snapshot.ts - event.ts <= 8_000,
      ) ?? null;

  const feed = [...events].reverse().slice(0, 7);

  return (
    <div className="min-h-full bg-fp-bg pb-8 text-fp-ink">
      <div className="mx-auto flex max-w-[1160px] flex-col gap-3 px-6 pt-5">
        <header className="flex flex-wrap items-center gap-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-fp-faint">
            FocusPlug · Focus Forecast
          </p>
          <Chip tone="amber">Replay</Chip>
          <Chip tone="focus">On-device</Chip>
          <p className="ml-auto font-mono text-[12px] text-fp-mute tabular">
            t +{frame.t}s / {replay.durationSec}s
          </p>
        </header>

        {/* Transport: play/pause, scrub, beat chips. */}
        <div className="fp-card flex flex-wrap items-center gap-3 px-4 py-2.5">
          <button
            type="button"
            onClick={() => setPlaying((current) => !current)}
            className="fp-btn inline-flex h-7 w-16 items-center justify-center rounded-md border border-fp-line-strong text-[12px] font-semibold uppercase tracking-[0.1em] text-fp-ink hover:bg-fp-hover"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <input
            type="range"
            min={0}
            max={maxIndex}
            step={1}
            value={index}
            aria-label="Replay position"
            onChange={(event) => {
              setPlaying(false);
              setIndex(Number(event.target.value));
            }}
            className="h-1 min-w-[160px] flex-1 accent-fp-lime"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {beats.map((beat) =>
              beat.t === null ? null : (
                <button
                  key={beat.label}
                  type="button"
                  onClick={() => {
                    setPlaying(false);
                    setIndex(Math.min(maxIndex, Math.max(0, beat.t! - 1)));
                  }}
                  className={cn(
                    "fp-btn rounded-full border border-fp-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-fp-mute hover:bg-fp-hover hover:text-fp-ink",
                  )}
                >
                  {beat.label}
                </button>
              ),
            )}
          </div>
        </div>

        <ForecastPanel
          snapshot={frame.snapshot}
          events={events}
          history={history}
          enabled
          prearmEnabled
          sessionActive
          // Live settings, never literals: RiskMeter draws its threshold ticks
          // here and buildForecastReplay escalates on DEFAULT_SETTINGS, so a
          // pinned 0.55/0.80 drew a PRE-ARM tick the page then fired below.
          nudgeRisk={DEFAULT_SETTINGS.forecastNudgeRisk}
          prearmRisk={DEFAULT_SETTINGS.forecastPrearmRisk}
          greyApp={greyApp}
        />

        <div className="grid min-h-0 gap-3 min-[960px]:grid-cols-[minmax(0,1.35fr)_minmax(300px,0.85fr)]">
          <DecisionHero
            decision={frame.decision}
            detail={frame.detail}
            sessionActive
            strictMode
            compact
          />
          <SessionClock clock={clock} prearm={plate} />
        </div>

        {/* Forecast event feed — the causal story so far. */}
        <section className="fp-card px-4 py-3" aria-label="Forecast events">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
            Forecast events
          </p>
          {feed.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-fp-mute">None yet — the model is watching.</p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {feed.map((event, feedIndex) => (
                <li key={feedIndex} className="flex items-baseline gap-2 font-mono text-[11px]">
                  <span className="w-12 shrink-0 text-right text-fp-faint tabular">
                    +{Math.round((event.ts - replay.startTs) / 1000)}s
                  </span>
                  <span
                    className={cn(
                      event.type === "forecast_hit"
                        ? "text-fp-lime"
                        : event.type === "forecast_miss" || event.type === "forecast_prearm"
                          ? "text-fp-red"
                          : event.type === "forecast_nudge"
                            ? "text-fp-amber"
                            : "text-fp-mute",
                    )}
                  >
                    {describeForecastEvent(event)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <p className="text-[11px] text-fp-faint">
          Scripted student-behavior stream → the shipped TelemetryRing, feature extractor,
          {" "}{FORECAST_PARAM_COUNT}-param {FORECAST_BASIS} head and escalation reducer — the
          exact code the Electron main process runs. No network, no canned risk numbers.
        </p>
      </div>

      <NudgeToast event={nudgeEvent} snapshot={frame.snapshot} greyApp={greyApp} frozen />

      {frame.countdownSec > 0 ? (
        <KillOverlay
          seconds={frame.countdownSec}
          total={frame.snapshot.effectiveFuseSec}
          reason={frame.detail}
          state={state}
          preview={false}
          forecastLeadSec={overlayLeadSec(events, frame.snapshot.ts)}
          onDemoKill={() => setPlaying(true)}
        />
      ) : null}
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Forecast preview root #root is missing");
}

createRoot(rootEl).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
