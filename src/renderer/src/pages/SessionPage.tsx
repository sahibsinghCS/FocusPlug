import type { JSX } from "react";
import type { SessionEvent } from "@shared/ipc";
import { cn } from "../lib/cn";
import {
  decisionLabel,
  decisionTone,
  deskPrimary,
  formatClock,
  formatConfidence,
  padCountdown,
  plugKillNote,
  plugStatusLine,
  windowPrimary,
  windowSecondary,
} from "../lib/format";
import { enabledPlugViews } from "../lib/plugsUi";
import { IconBolt } from "../lib/icons";
import { useAppState } from "../state/AppState";
import { Chip, DangerButton } from "../components/ui";

export function SessionPage(): JSX.Element {
  const app = useAppState();
  const { state } = app;
  const tone = decisionTone(state.decision);
  const countdownIdle = !app.countdown;
  const windowName = resolveAppName(windowPrimary(state.focus), app.lists);
  const deskText = state.desk
    ? `${deskPrimary(state.desk)} ${formatConfidence(state.desk.confidence)}`
    : "Desk AI standby";
  const armedPlugs = enabledPlugViews(app.plugs);
  const plugNote = plugKillNote(app.plugs);
  const plugBody =
    app.plugs.length === 0
      ? "No outlets configured"
      : armedPlugs.length === 0
        ? "None armed. Demo Kill will not cut outlets."
        : "Armed plugs cut on kill overlay and Demo Kill.";

  const decisionColor =
    tone === "live"
      ? "text-fp-live"
      : tone === "kill"
        ? "text-fp-kill"
        : tone === "warn"
          ? "text-fp-warn"
          : "text-fp-ink";

  return (
    <div className="flex h-full min-h-0 flex-col bg-fp-well">
      <section className="grid grid-cols-1 border-b border-fp-line lg:grid-cols-[minmax(0,1.4fr)_minmax(220px,0.55fr)]">
        <div className="min-w-0 px-7 py-6">
          <p className="text-[12px] text-fp-faint">Decision</p>
          <p
            className={cn(
              "font-display text-[clamp(44px,7vw,76px)] font-extrabold leading-[0.92] tracking-[-0.045em]",
              decisionColor,
            )}
          >
            {decisionLabel(state.decision)}
          </p>
          <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-fp-mute" title={state.detail}>
            {state.detail}
          </p>
          {plugNote ? (
            <p className="mt-1 max-w-xl text-[12px] text-fp-warn" title={plugNote}>
              {plugNote}. Never the study PC.
            </p>
          ) : null}
        </div>
        <div className="flex flex-col justify-between border-t border-fp-line px-7 py-6 lg:border-l lg:border-t-0">
          <div>
            <p className="text-[12px] text-fp-faint">Fuse</p>
            <p
              className={cn(
                "mt-1 font-display text-[clamp(44px,7vw,76px)] font-extrabold leading-[0.92] tracking-[-0.045em] tabular",
                countdownIdle ? "text-fp-faint" : "text-fp-kill",
              )}
            >
              {countdownIdle
                ? padCountdown(app.settings.countdownSec)
                : padCountdown(app.countdown?.seconds ?? 0)}
            </p>
          </div>
          <p className="mt-3 font-mono text-[11px] text-fp-faint">
            {countdownIdle
              ? `Idle ${app.settings.countdownSec}s`
              : `${padCountdown(app.countdown?.seconds ?? 0)}s ${app.countdown?.reason ?? "fuse"}`}
          </p>
        </div>
      </section>

      <section className="grid border-b border-fp-line md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Sensor
          label="Window"
          title={windowName}
          body={windowSecondary(state.focus)}
          live={Boolean(state.focus && state.focus.matchedAllow)}
          warn={Boolean(state.focus?.matchedBlock)}
        />
        <div className="grid border-t border-fp-line md:border-l md:border-t-0">
          <Sensor
            label="Desk AI"
            title={deskText}
            body={
              state.desk
                ? state.desk.webcamEnabled
                  ? `Webcam on, ${app.settings.deskModelId}`
                  : "Webcam off"
                : "Presence model idle"
            }
            live={state.desk?.label === "at_desk"}
            warn={state.desk?.label === "away"}
            compact
          />
          <Sensor
            label="Plugs"
            title={plugStatusLine(app.plugs)}
            body={plugBody}
            live={armedPlugs.some((plug) => plug.online && plug.powerOn === true)}
            warn={armedPlugs.length > 0 && armedPlugs.every((plug) => plug.powerOn === false)}
            compact
            last
          />
        </div>
      </section>

      <section className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-baseline justify-between px-7 py-3">
            <p className="text-[12px] text-fp-faint">Tape</p>
            <p className="font-mono text-[11px] text-fp-faint">{app.log.length}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {app.log.length === 0 ? (
              <p className="px-7 py-4 text-[13px] text-fp-mute">
                No events yet. Start a session to record activity.
              </p>
            ) : (
              <ol>
                {app.log.slice(0, 40).map((event, index) => (
                  <LogRow key={`${event.ts}-${event.kind}-${index}`} event={event} odd={index % 2 === 1} />
                ))}
              </ol>
            )}
          </div>
        </div>
        <aside className="hidden w-[240px] shrink-0 flex-col border-l border-fp-line bg-fp-bg sm:flex">
          <p className="px-5 py-3 text-[12px] text-fp-faint">Armed</p>
          <div className="min-h-0 flex-1 overflow-auto px-5 pb-4">
            <p className="text-[11px] font-medium text-fp-live">
              Allow {app.lists.allowlist.filter((e) => e.enabled).length}
            </p>
            <ul className="mt-2 space-y-1">
              {app.lists.allowlist.map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    "truncate text-[12px]",
                    entry.enabled ? "text-fp-ink" : "text-fp-faint line-through",
                  )}
                >
                  {entry.name}
                </li>
              ))}
            </ul>
            <p className="mt-5 text-[11px] font-medium text-fp-kill">
              Block {app.lists.blocklist.filter((e) => e.enabled).length}
            </p>
            <ul className="mt-2 space-y-1">
              {app.lists.blocklist.map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    "truncate text-[12px]",
                    entry.enabled ? "text-fp-ink" : "text-fp-faint line-through",
                  )}
                >
                  {entry.name}
                </li>
              ))}
            </ul>
          </div>
        </aside>
      </section>

      <footer className="flex items-center justify-between gap-4 border-t border-fp-kill/50 bg-fp-kill/[0.08] px-7 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-fp-kill">Danger</p>
          <p className="text-[13px] text-fp-ink">
            Demo Kill. Instant blocklist force-quit for filming. Never kills the study PC.
          </p>
          <p className="mt-0.5 text-[12px] text-fp-mute">
            {armedPlugs.length > 0
              ? `Also cuts ${armedPlugs.length} enabled plug${armedPlugs.length === 1 ? "" : "s"}: ${armedPlugs.map((plug) => plug.name).join(", ")}.`
              : "Also cuts plugs when any are enabled."}
            {app.killResult
              ? `  Killed ${app.killResult.killed.length ? app.killResult.killed.join(", ") : "nothing"}.`
              : ""}
          </p>
        </div>
        <DangerButton onClick={() => void app.demoKill()} className="shrink-0">
          <IconBolt className="h-4 w-4" />
          Demo Kill
        </DangerButton>
      </footer>
    </div>
  );
}

function Sensor(props: {
  label: string;
  title: string;
  body: string;
  live?: boolean;
  warn?: boolean;
  compact?: boolean;
  last?: boolean;
}): JSX.Element {
  const tone = props.warn ? "kill" : props.live ? "live" : "mute";
  return (
    <div className={cn("min-w-0 px-7 py-4", props.compact && !props.last && "border-b border-fp-line")}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] text-fp-faint">{props.label}</p>
        <Chip tone={tone}>{props.warn ? "Alert" : props.live ? "Live" : "Idle"}</Chip>
      </div>
      <p className="mt-1 truncate text-[15px] font-medium tracking-tight" title={props.title}>
        {props.title}
      </p>
      <p className="truncate text-[12px] text-fp-mute" title={props.body}>
        {props.body}
      </p>
    </div>
  );
}

function LogRow(props: { event: SessionEvent; odd: boolean }): JSX.Element {
  const kind = props.event.kind.toLowerCase();
  const kill = kind.includes("kill") || kind === "demo";
  return (
    <li
      className={cn(
        "grid grid-cols-[76px_84px_minmax(0,1fr)] gap-3 px-7 py-1.5",
        props.odd && "bg-white/[0.015]",
      )}
    >
      <time className="font-mono text-[11px] text-fp-faint tabular">{formatClock(props.event.ts)}</time>
      <span
        className={cn(
          "font-mono text-[11px] font-medium",
          kill ? "text-fp-kill" : "text-fp-mute",
        )}
      >
        {props.event.kind}
      </span>
      <span className="truncate text-[13px] text-fp-ink" title={props.event.detail}>
        {props.event.detail}
      </span>
    </li>
  );
}

function resolveAppName(
  processName: string,
  lists: { allowlist: Array<{ name: string; match: string[] }>; blocklist: Array<{ name: string; match: string[] }> },
): string {
  const needle = processName.toLowerCase();
  if (needle === "no foreground app") {
    return processName;
  }
  const all = [...lists.allowlist, ...lists.blocklist];
  const hit = all.find((entry) =>
    entry.match.some((token) => needle.includes(token.toLowerCase()) || token.toLowerCase().includes(needle)),
  );
  return hit?.name ?? processName;
}
