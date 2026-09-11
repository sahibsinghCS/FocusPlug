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
  windowPrimary,
  windowSecondary,
} from "../lib/format";
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
    ? `${deskPrimary(state.desk)} · ${formatConfidence(state.desk.confidence)}`
    : "Desk AI standby";
  const countdownText = countdownIdle
    ? `Idle · ${app.settings.countdownSec}s`
    : `${padCountdown(app.countdown?.seconds ?? 0)}s · ${app.countdown?.reason ?? "fuse"}`;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-4 border-b border-fp-line px-6 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">Home</p>
          <h1 className="text-[17px] font-semibold tracking-tight">Session</h1>
        </div>
        <div className="flex items-center gap-2">
          {state.sessionActive ? (
            <>
              <Chip tone={tone}>Live</Chip>
              <GhostButton onClick={() => void app.stopSession()}>Stop</GhostButton>
            </>
          ) : (
            <PrimaryButton onClick={() => void app.startSession()}>Start session</PrimaryButton>
          )}
        </div>
      </header>

      <section className="border-b border-fp-line px-6 py-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fp-faint">
              Decision
            </p>
            <p
              className={cn(
                "mt-1 text-[32px] font-semibold tracking-tight",
                tone === "lime"
                  ? "text-fp-lime"
                  : tone === "red"
                    ? "text-fp-red"
                    : tone === "amber"
                      ? "text-fp-amber"
                      : "text-fp-ink",
              )}
            >
              {decisionLabel(state.decision)}
            </p>
            <p className="mt-1 max-w-xl truncate text-[13px] text-fp-mute" title={state.detail}>
              {state.detail}
            </p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fp-faint">
              Countdown
            </p>
            <p
              className={cn(
                "mt-1 font-mono text-[32px] font-bold leading-none tabular",
                countdownIdle ? "text-zinc-500" : "text-fp-red",
              )}
            >
              {countdownIdle
                ? padCountdown(app.settings.countdownSec)
                : padCountdown(app.countdown?.seconds ?? 0)}
            </p>
            <p className="mt-1 text-[12px] text-fp-faint">
              {countdownIdle ? `Idle · ${app.settings.countdownSec}s fuse` : countdownText}
            </p>
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3 border-t border-fp-line pt-4">
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
                  ? "Webcam on · on-device model"
                  : "Webcam off"
                : "Presence model idle"
            }
          />
        </dl>
      </section>

      <section className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-fp-line px-6 py-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fp-faint">
            Recent events
          </p>
          <p className="font-mono text-[11px] text-fp-faint">{app.log.length}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-auto">
          {app.log.length === 0 ? (
            <p className="px-6 py-8 text-[13px] text-fp-mute">
              No events yet. Start a session to record window, desk, and kill activity.
            </p>
          ) : (
            <ol>
              {app.log.slice(0, 40).map((event, index) => (
                <LogRow key={`${event.ts}-${event.kind}-${index}`} event={event} />
              ))}
            </ol>
          )}
        </div>
      </section>

      <footer className="flex items-center justify-between gap-4 border-t border-fp-red/40 bg-fp-red/[0.07] px-6 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-fp-red">Danger</p>
          <p className="truncate text-[13px] text-zinc-300">
            Demo Kill — instant blocklist force-quit for filming. Never kills the study PC.
            {app.killResult
              ? ` · killed ${app.killResult.killed.length ? app.killResult.killed.join(", ") : "nothing"}`
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
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <Led tone={tone} live={props.live && !props.warn} />
        <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-fp-faint">
          {props.label}
        </dt>
      </div>
      <dd className="mt-1 min-w-0">
        <p className="truncate text-[14px] font-medium" title={props.title}>
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
