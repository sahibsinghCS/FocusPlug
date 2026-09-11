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
import { Chip, DangerButton, GhostButton, Led, PrimaryButton } from "../components/ui";

export function SessionPage(): JSX.Element {
  const app = useAppState();
  const { state } = app;
  const tone = decisionTone(state.decision);
  const countdownIdle = !app.countdown;
  const windowName = resolveAppName(windowPrimary(state.focus), app.lists);
  const deskText = state.desk
    ? `${deskPrimary(state.desk)} ${formatConfidence(state.desk.confidence)}`
    : "Desk AI standby";
  const countdownText = countdownIdle
    ? `Idle ${app.settings.countdownSec}s`
    : `${padCountdown(app.countdown?.seconds ?? 0)}s ${app.countdown?.reason ?? "fuse"}`;
  const armedPlugs = enabledPlugViews(app.plugs);
  const plugNote = plugKillNote(app.plugs);
  const plugBody =
    app.plugs.length === 0
      ? "No outlets configured"
      : armedPlugs.length === 0
        ? "None armed. Demo Kill will not cut outlets"
        : "Armed plugs cut on kill overlay / Demo Kill";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-end gap-2 border-b border-fp-line px-6 py-3">
        {state.sessionActive ? (
          <>
            <Chip tone={tone}>Live</Chip>
            <GhostButton onClick={() => void app.stopSession()}>Stop</GhostButton>
          </>
        ) : (
          <PrimaryButton onClick={() => void app.startSession()}>Start session</PrimaryButton>
        )}
      </div>

      <section className="grid grid-cols-1 gap-px border-b border-fp-line bg-fp-line lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.9fr)]">
        <div className="bg-fp-bg px-6 py-6 lg:py-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fp-faint">
            Decision
          </p>
          <p
            className={cn(
              "mt-2 text-[clamp(2.4rem,6vw,4.6rem)] font-semibold leading-[0.92] tracking-[-0.05em] uppercase text-pretty",
              tone === "lime"
                ? "text-fp-lime"
                : tone === "red"
                  ? "text-fp-red"
                  : tone === "amber"
                    ? "text-fp-amber"
                    : "text-fp-ink",
            )}
            aria-live="polite"
          >
            {decisionLabel(state.decision)}
          </p>
          <p className="mt-3 max-w-xl truncate text-[14px] text-fp-mute" title={state.detail}>
            {state.detail}
          </p>
          {plugNote ? (
            <p className="mt-1 max-w-xl text-[12px] text-fp-amber" title={plugNote}>
              {plugNote}. Never the study PC.
            </p>
          ) : null}
        </div>
        <div className="bg-fp-bg px-6 py-6 text-left lg:py-8 lg:text-right">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-fp-faint">
            Countdown
          </p>
          <p
            className={cn(
              "mt-2 font-mono text-[clamp(2.4rem,6vw,4.6rem)] font-bold leading-none tabular",
              countdownIdle ? "text-[#5a584e]" : "text-fp-red",
            )}
          >
            {countdownIdle
              ? padCountdown(app.settings.countdownSec)
              : padCountdown(app.countdown?.seconds ?? 0)}
          </p>
          <p className="mt-3 text-[12px] text-fp-faint">{countdownText}</p>
        </div>
      </section>

      <dl className="grid grid-cols-1 gap-px border-b border-fp-line bg-fp-line lg:grid-cols-3">
        <Meta
          label="Window"
          live={Boolean(state.focus && state.focus.matchedAllow)}
          warn={Boolean(state.focus?.matchedBlock)}
          title={windowName}
          body={windowSecondary(state.focus)}
        />
        <Meta
          label="Desk AI"
          live={state.desk?.label === "at_desk"}
          warn={state.desk?.label === "away"}
          title={deskText}
          body={
            state.desk
              ? state.desk.webcamEnabled
                ? `Webcam on ${app.settings.deskModelId}`
                : "Webcam off"
              : "Presence model idle"
          }
        />
        <Meta
          label="Plugs"
          live={armedPlugs.some((plug) => plug.online && plug.powerOn === true)}
          warn={armedPlugs.length > 0 && armedPlugs.every((plug) => plug.powerOn === false)}
          title={plugStatusLine(app.plugs)}
          body={plugBody}
        />
      </dl>

      <section className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-fp-line lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between border-b border-fp-line px-6 py-2">
            <p className="text-[13px] font-medium text-fp-mute">Recent events</p>
            <p className="font-mono text-[11px] text-fp-faint">{app.log.length}</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            {app.log.length === 0 ? (
              <div className="px-6 py-10">
                <p className="text-[15px] font-medium">No events yet</p>
                <p className="mt-1 max-w-[42ch] text-[13px] leading-relaxed text-fp-mute">
                  Start a session to record window matches, desk presence, and kills.
                </p>
              </div>
            ) : (
              <ol>
                {app.log.slice(0, 40).map((event, index) => (
                  <LogRow key={`${event.ts}-${event.kind}-${index}`} event={event} />
                ))}
              </ol>
            )}
          </div>
        </div>
        <div className="flex w-full shrink-0 flex-col lg:w-[280px]">
          <div className="border-b border-fp-line px-4 py-2">
            <p className="text-[13px] font-medium text-fp-mute">Armed lists</p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
            <p className="font-mono text-[11px] text-fp-lime">
              Allow {app.lists.allowlist.filter((entry) => entry.enabled).length}
            </p>
            <ul className="mt-2 space-y-1">
              {app.lists.allowlist.map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    "truncate text-[12px]",
                    entry.enabled ? "text-zinc-300" : "text-zinc-600 line-through",
                  )}
                >
                  {entry.name}
                </li>
              ))}
            </ul>
            <p className="mt-5 font-mono text-[11px] text-fp-red">
              Block {app.lists.blocklist.filter((entry) => entry.enabled).length}
            </p>
            <ul className="mt-2 space-y-1">
              {app.lists.blocklist.map((entry) => (
                <li
                  key={entry.id}
                  className={cn(
                    "truncate text-[12px]",
                    entry.enabled ? "text-zinc-300" : "text-zinc-600 line-through",
                  )}
                >
                  {entry.name}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <footer className="hazard-band flex items-center justify-between gap-4 border-t border-fp-red/50 px-6 py-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.16em] text-fp-red">
            Danger
          </p>
          <p className="text-[13px] text-zinc-300">
            Demo Kill: instant blocklist force-quit for filming. Never kills the study PC.
          </p>
          <p className="mt-0.5 text-[12px] text-zinc-400">
            {armedPlugs.length > 0
              ? `Also cuts ${armedPlugs.length} enabled plug${armedPlugs.length === 1 ? "" : "s"}: ${armedPlugs.map((plug) => plug.name).join(", ")}.`
              : "Also cuts plugs when any are enabled."}
            {app.killResult
              ? ` killed ${app.killResult.killed.length ? app.killResult.killed.join(", ") : "nothing"}`
              : ""}
          </p>
        </div>
        <DangerButton onClick={() => void app.demoKill()} className="shrink-0 uppercase tracking-[0.12em]">
          <IconBolt className="h-4 w-4" />
          Demo Kill
        </DangerButton>
      </footer>
    </div>
  );
}

function Meta(props: {
  label: string;
  title: string;
  body: string;
  live?: boolean;
  warn?: boolean;
}): JSX.Element {
  const tone = props.warn ? "red" : props.live ? "lime" : "mute";
  return (
    <div className="min-w-0 bg-fp-bg px-6 py-4">
      <div className="flex items-center gap-2">
        <Led tone={tone} live={props.live && !props.warn} />
        <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-fp-faint">
          {props.label}
        </dt>
      </div>
      <dd className="mt-2 min-w-0">
        <p className="truncate text-[15px] font-medium" title={props.title}>
          {props.title}
        </p>
        <p className="truncate text-[12px] text-fp-mute" title={props.body}>
          {props.body}
        </p>
      </dd>
    </div>
  );
}

function LogRow(props: { event: SessionEvent }): JSX.Element {
  const kind = props.event.kind.toLowerCase();
  const kill = kind.includes("kill") || kind === "demo";
  return (
    <li className="grid grid-cols-[76px_84px_minmax(0,1fr)] gap-3 border-b border-fp-line px-6 py-1.5">
      <time className="font-mono text-[11px] text-fp-faint tabular">{formatClock(props.event.ts)}</time>
      <span
        className={cn(
          "font-mono text-[11px] font-medium uppercase tracking-[0.08em]",
          kill ? "text-fp-red" : "text-fp-mute",
        )}
      >
        {props.event.kind}
      </span>
      <span className="truncate text-[13px] text-zinc-300" title={props.event.detail}>
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
