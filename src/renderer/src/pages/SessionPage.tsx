import type { JSX } from "react";
import { cn } from "../lib/cn";
import {
  decisionLabel,
  decisionTone,
  deskPrimary,
  deskTone,
  focusFlag,
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

  return (
    <div className="mx-auto flex max-w-[980px] flex-col gap-5 px-7 py-6">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">Home</p>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Session</h1>
          <p className="mt-1 text-[13px] text-fp-mute">
            Live window, desk AI, and kill decision.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <PrimaryButton onClick={() => void app.startSession()} disabled={state.sessionActive}>
            Start session
          </PrimaryButton>
          <GhostButton onClick={() => void app.stopSession()} disabled={!state.sessionActive}>
            Stop
          </GhostButton>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <StatusCard
          kicker="Window"
          tone={flag.tone}
          live={Boolean(state.focus)}
          title={windowPrimary(state.focus)}
          body={windowSecondary(state.focus)}
          chip={flag.label}
        />
        <StatusCard
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
        <StatusCard
          kicker="Decision"
          tone={decision}
          live={state.sessionActive}
          title={decisionLabel(state.decision)}
          body={state.detail}
          chip={state.sessionActive ? "Armed" : "Observe"}
        />
      </section>

      <section className="flex items-center gap-5 rounded-lg border border-fp-line bg-fp-panel px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-fp-faint">
            Kill countdown
          </p>
          <p className="mt-1 text-[13px] text-fp-mute">
            {countdownIdle
              ? `Idle · ${app.settings.countdownSec}s fuse when a blocked app takes focus or you leave the desk.`
              : app.countdown?.reason}
          </p>
        </div>
        <p
          className={cn(
            "font-mono text-[44px] font-bold leading-none tabular",
            countdownIdle ? "text-zinc-700" : "text-fp-red",
          )}
        >
          {countdownIdle ? "—" : padCountdown(app.countdown?.seconds ?? 0)}
        </p>
      </section>

      <section className="rounded-lg border border-fp-red/35 bg-[linear-gradient(180deg,rgba(255,45,85,0.12),rgba(255,45,85,0.04))] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fp-red">Danger</p>
            <h2 className="mt-1 text-[16px] font-semibold">Demo Kill</h2>
            <p className="mt-1 max-w-xl text-[13px] leading-5 text-zinc-300">
              Instantly force-quit every enabled blocklist process. For filming — does not wait
              for the countdown. Never kills the study PC.
            </p>
          </div>
          <DangerButton onClick={() => void app.demoKill()} className="uppercase tracking-[0.12em]">
            <IconBolt className="h-4 w-4" />
            Demo Kill
          </DangerButton>
        </div>
        {app.killResult ? (
          <p className="mt-3 font-mono text-[12px] text-zinc-400">
            killed {app.killResult.killed.length ? app.killResult.killed.join(", ") : "nothing"}
            {app.killResult.errors.length > 0 ? ` · ${app.killResult.errors.join("; ")}` : ""}
          </p>
        ) : null}
      </section>
    </div>
  );
}

function StatusCard(props: {
  kicker: string;
  tone: Tone;
  live?: boolean;
  title: string;
  body: string;
  chip: string;
  meter?: number | null;
}): JSX.Element {
  return (
    <article className="min-w-0 rounded-lg border border-fp-line bg-fp-panel p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Led tone={props.tone} live={props.live} />
          <h2 className="text-[11px] font-medium uppercase tracking-[0.16em] text-fp-faint">
            {props.kicker}
          </h2>
        </div>
        <Chip tone={props.tone}>{props.chip}</Chip>
      </div>
      <p className="mt-3 truncate text-[18px] font-semibold tracking-tight" title={props.title}>
        {props.title}
      </p>
      <p className="mt-1 line-clamp-2 text-[13px] leading-5 text-fp-mute" title={props.body}>
        {props.body}
      </p>
      {props.meter !== null && props.meter !== undefined ? (
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-fp-lime"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, props.meter)) * 100)}%` }}
          />
        </div>
      ) : (
        <div className="mt-3 h-1" />
      )}
    </article>
  );
}
