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
  formatConfidence,
  padCountdown,
  windowPrimary,
  windowSecondary,
  type Tone,
} from "../lib/format";
import { IconBolt } from "../lib/icons";
import { useAppState } from "../state/AppState";
import { Chip, DangerButton, GhostButton, Led, PrimaryButton } from "../components/ui";

export function SessionPage(): JSX.Element {
  const app = useAppState();
  const { state } = app;
  const flag = focusFlag(state.focus);
  const deskToneValue: Tone = state.desk ? deskTone(state.desk.label) : "mute";
  const decision = decisionTone(state.decision);
  const countdownIdle = !app.countdown;
  const windowName = resolveAppName(windowPrimary(state.focus), app.lists);

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
              <Chip tone={decision}>Live</Chip>
              <GhostButton onClick={() => void app.stopSession()}>Stop</GhostButton>
            </>
          ) : (
            <PrimaryButton onClick={() => void app.startSession()}>Start session</PrimaryButton>
          )}
        </div>
      </header>

      <section className="border-b border-fp-line">
        <PropertyRow
          kicker="Window"
          tone={flag.tone}
          live={Boolean(state.focus)}
          title={windowName}
          body={windowSecondary(state.focus)}
          chip={flag.label}
        />
        <PropertyRow
          kicker="Desk AI"
          tone={deskToneValue}
          live={Boolean(state.desk?.webcamEnabled)}
          title={deskPrimary(state.desk)}
          body={
            state.desk
              ? `${formatConfidence(state.desk.confidence)} confidence · ${state.desk.webcamEnabled ? "cam on" : "cam off"}`
              : "Webcam + on-device presence model"
          }
          chip={state.desk?.webcamEnabled ? "Cam on" : "Cam off"}
          meter={state.desk ? state.desk.confidence : null}
        />
        <PropertyRow
          kicker="Decision"
          tone={decision}
          live={state.sessionActive}
          title={decisionLabel(state.decision)}
          body={state.detail}
          chip={state.sessionActive ? "Armed" : "Observe"}
        />
        <PropertyRow
          kicker="Countdown"
          tone={countdownIdle ? "mute" : "red"}
          live={!countdownIdle}
          title={countdownIdle ? "Idle" : padCountdown(app.countdown?.seconds ?? 0)}
          body={
            countdownIdle
              ? `${app.settings.countdownSec}s fuse when a blocked app takes focus or you leave the desk`
              : (app.countdown?.reason ?? "")
          }
          chip={countdownIdle ? "Idle" : "Fuse"}
          monoTitle={!countdownIdle}
        />
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

function PropertyRow(props: {
  kicker: string;
  tone: Tone;
  live?: boolean;
  title: string;
  body: string;
  chip: string;
  meter?: number | null;
  monoTitle?: boolean;
}): JSX.Element {
  return (
    <div className="grid grid-cols-[108px_minmax(0,1fr)_auto] items-center gap-3 border-b border-fp-line px-6 py-2.5 last:border-b-0">
      <div className="flex items-center gap-2">
        <Led tone={props.tone} live={props.live} />
        <h2 className="text-[11px] font-medium uppercase tracking-[0.14em] text-fp-faint">
          {props.kicker}
        </h2>
      </div>
      <div className="min-w-0">
        <p
          className={cn(
            "truncate text-[14px] font-medium tracking-tight",
            props.monoTitle && "font-mono text-[18px] font-bold tabular text-fp-red",
          )}
          title={props.title}
        >
          {props.title}
        </p>
        <p className="truncate text-[12px] text-fp-mute" title={props.body}>
          {props.body}
        </p>
        {props.meter !== null && props.meter !== undefined ? (
          <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-fp-lime"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, props.meter)) * 100)}%` }}
            />
          </div>
        ) : null}
      </div>
      <Chip tone={props.tone}>{props.chip}</Chip>
    </div>
  );
}

function LogRow(props: { event: SessionEvent }): JSX.Element {
  const kind = props.event.kind.toLowerCase();
  const tone =
    kind.includes("kill") || kind === "demo"
      ? "text-fp-red"
      : kind.includes("decision") || kind === "session"
        ? "text-fp-lime"
        : kind.includes("desk")
          ? "text-fp-amber"
          : "text-fp-blue";
  return (
    <li className="grid grid-cols-[76px_84px_minmax(0,1fr)] gap-3 border-b border-fp-line px-6 py-1.5">
      <time className="font-mono text-[11px] text-fp-faint tabular">{formatClock(props.event.ts)}</time>
      <span className={cn("font-mono text-[11px] font-medium uppercase tracking-[0.08em]", tone)}>
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
