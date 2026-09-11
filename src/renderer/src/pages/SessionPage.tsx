import type { JSX } from "react";
import type { SessionEvent } from "@shared/ipc";
import { cn } from "../lib/cn";
import {
  decisionLabel,
  decisionTone,
  deskPrimary,
  deskTone,
  focusFlag,
  formatClock,
  plugKillNote,
  resolveAppName,
  windowPrimary,
  windowSecondary,
} from "../lib/format";
import { enabledPlugViews } from "../lib/plugsUi";
import { useAppState } from "../state/AppState";
import { FusePlate } from "../components/FusePlate";

export function SessionPage(): JSX.Element {
  const app = useAppState();
  const { state } = app;
  const tone = decisionTone(state.decision);
  const countdownIdle = !app.countdown;
  const processName = windowPrimary(state.focus);
  const appName = resolveAppName(processName, app.lists);
  const windowTitle = windowSecondary(state.focus);
  const flag = focusFlag(state.focus);
  const deskConfidence = state.desk ? state.desk.confidence : null;
  const armedPlugs = enabledPlugViews(app.plugs);
  const plugNote = plugKillNote(app.plugs);
  const chambers = app.lists.blocklist.slice(0, 4);
  const tape = app.log.slice(0, 4);
  const outlets = app.plugs.slice(0, 3);

  return (
    <div className="face">
      <div className="face-main">
        <section className="scope" aria-label="Window">
          <div className="min-w-0">
            <p className="scope-kicker">Window · {flag.label}</p>
            <h1 className="scope-title" title={windowTitle}>
              {state.focus ? windowTitle : "No foreground app"}
            </h1>
            <p className="scope-meta" title={state.detail}>
              {appName}
              {state.detail ? ` · ${state.detail}` : ""}
            </p>
          </div>
          <div className="scope-lock">
            <span className={toneClass(flag.tone)}>{flag.label}</span>
            <span>{state.sessionActive ? "Locked to allowlist" : "Observe only"}</span>
          </div>
        </section>

        <section className="chambers" aria-label="Blocklist">
          <p className="chambers-label">Chambers · {app.lists.blocklist.filter((e) => e.enabled).length} armed</p>
          <div className="chamber-row">
            {chambers.length === 0 ? (
              <div className="chamber is-empty">
                <p className="chamber-name">No kill targets</p>
                <p className="chamber-match">Add apps on Blocklist</p>
              </div>
            ) : (
              chambers.map((entry) => (
                <div key={entry.id} className={cn("chamber", entry.enabled && "is-armed")}>
                  <p className="chamber-name">{entry.name}</p>
                  <p className="chamber-match">{entry.match.join(" · ")}</p>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="outlets" aria-label="Plugs">
          <p className="outlets-label">Outlets · {armedPlugs.length} armed</p>
          <div className="outlet-row">
            {outlets.length === 0 ? (
              <div className="outlet">
                <div className="socket-wells" aria-hidden="true">
                  <span className="socket-well" />
                  <span className="socket-well" />
                </div>
                <span className="outlet-name">No outlets</span>
                <span className="outlet-rocker">Add on Plugs</span>
              </div>
            ) : (
              outlets.map((plug) => (
                <div
                  key={plug.id}
                  className={cn(
                    "outlet",
                    plug.enabled && plug.powerOn !== false && "is-on",
                  )}
                >
                  <div className="socket-wells" aria-hidden="true">
                    <span className="socket-well" />
                    <span className="socket-well" />
                  </div>
                  <span className="outlet-name">{plug.name}</span>
                  <span className="outlet-rocker">
                    {plug.enabled ? (plug.powerOn === false ? "Cut" : "On") : "Off"}
                  </span>
                </div>
              ))
            )}
          </div>
          {plugNote ? <p className="setting-copy">{plugNote}. Never the study PC.</p> : null}
        </section>

        <section className="tape" aria-label="Tape">
          <p className="tape-label">Tape</p>
          {tape.length === 0 ? (
            <p className="empty">No events yet. Start a session to record activity.</p>
          ) : (
            <ol className="tape-list">
              {tape.map((event, index) => (
                <TapeLine key={`${event.ts}-${event.kind}-${index}`} event={event} />
              ))}
            </ol>
          )}
        </section>
      </div>

      <FusePlate
        seconds={countdownIdle ? app.settings.countdownSec : (app.countdown?.seconds ?? 0)}
        total={app.countdown?.total ?? app.settings.countdownSec}
        idle={countdownIdle}
        decision={decisionLabel(state.decision)}
        decisionTone={tone}
        deskLabel={state.desk ? deskPrimary(state.desk) : "Standby"}
        deskConfidence={deskConfidence}
        deskTone={state.desk ? deskTone(state.desk.label) : "mute"}
        onDemoKill={() => {
          void app.demoKill();
        }}
      />
    </div>
  );
}

function TapeLine(props: { event: SessionEvent }): JSX.Element {
  const kill = props.event.kind.toLowerCase().includes("kill") || props.event.kind.toLowerCase() === "demo";
  return (
    <li className="tape-line">
      <time className="tape-time">{formatClock(props.event.ts)}</time>
      <span className={kill ? "tone-kill" : undefined} title={props.event.detail}>
        {props.event.kind} · {props.event.detail}
      </span>
    </li>
  );
}

function toneClass(tone: ReturnType<typeof decisionTone>): string {
  if (tone === "live") return "tone-live";
  if (tone === "kill") return "tone-kill";
  if (tone === "warn") return "tone-warn";
  return "tone-mute";
}
