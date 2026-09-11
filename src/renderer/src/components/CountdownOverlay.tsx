import { useRef, type JSX } from "react";
import type { SessionState } from "@shared/ipc";
import { IconBolt } from "../lib/icons";
import {
  decisionLabel,
  deskPrimary,
  formatConfidence,
  padCountdown,
  windowPrimary,
} from "../lib/format";
import { enabledPlugViews, type PlugView } from "../lib/plugsUi";
import { overlayConsequenceLines } from "../features/session/model";
import { useOverlayFocus } from "../features/session/useOverlayFocus";
import "../features/session/session.css";

interface CountdownOverlayProps {
  seconds: number;
  total: number;
  reason: string;
  state: SessionState;
  plugs?: readonly PlugView[];
  onDemoKill: () => void;
}

export function CountdownOverlay(props: CountdownOverlayProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(rootRef, true);

  const total = Math.max(props.total, props.seconds, 1);
  const progress = props.seconds / total;
  const radius = 132;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const windowText = windowPrimary(props.state.focus);
  const deskText = props.state.desk
    ? `${deskPrimary(props.state.desk)} ${formatConfidence(props.state.desk.confidence)}`
    : "Desk AI standby";
  const plugs = props.plugs ?? [];
  const armed = enabledPlugViews(plugs);
  const consequence = overlayConsequenceLines(plugs);

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-50 flex flex-col bg-[#070104] text-white"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fp-overlay-title"
      aria-describedby="fp-overlay-consequence"
    >
      <div className="fp-session-overlay-glow pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,45,85,0.46),transparent_58%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.55),transparent_16%,transparent_78%,rgba(0,0,0,0.7))]" />
      <div className="pointer-events-none absolute inset-0 overflow-hidden opacity-30">
        <div className="fp-session-scan h-1/2 w-full bg-[linear-gradient(to_bottom,transparent,rgba(255,45,85,0.18),transparent)]" />
      </div>

      <div className="relative z-10 flex flex-wrap justify-center gap-2 px-6 pt-5">
        <HudChip k="Window" v={windowText} danger={Boolean(props.state.focus?.matchedBlock)} />
        <HudChip k="Desk AI" v={deskText} danger={props.state.desk?.label === "away"} />
        <HudChip
          k="Plugs"
          v={armed.length > 0 ? `${armed.length} armed · will cut` : "No plugs armed"}
          danger={armed.length > 0}
        />
        <HudChip k="Decision" v={decisionLabel(props.state.decision)} danger />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <p
          id="fp-overlay-title"
          className="text-[14px] font-semibold uppercase tracking-[0.46em] text-fp-red"
        >
          Killing blocked apps in
        </p>

        <div className="relative mt-1 flex h-[min(34vh,280px)] w-[min(34vh,280px)] items-center justify-center sm:h-[min(42vh,320px)] sm:w-[min(42vh,320px)]">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 300 300" aria-hidden="true">
            <circle cx="150" cy="150" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10" />
            <circle
              cx="150"
              cy="150"
              r={radius}
              fill="none"
              stroke="#ff2d55"
              strokeWidth="10"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              transform="rotate(-90 150 150)"
            />
          </svg>
          <p
            key={props.seconds}
            className="fp-session-fuse-num font-mono text-[min(28vw,200px)] font-bold leading-none tabular text-white drop-shadow-[0_0_48px_rgba(255,45,85,0.75)]"
            aria-live="assertive"
          >
            {padCountdown(props.seconds)}
          </p>
        </div>

        <p className="mt-1 max-w-xl text-center text-[20px] font-medium text-zinc-100">
          {props.reason}
        </p>

        <div
          id="fp-overlay-consequence"
          className="mt-4 grid w-full max-w-3xl gap-2 min-[720px]:grid-cols-2"
        >
          <ConsequenceCard kicker="App kill" title={consequence.apps} />
          <ConsequenceCard kicker="Plugs cut" title={consequence.plugs} />
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 flex-col items-center gap-3 px-6 pb-7">
        <p className="font-mono text-[12px] uppercase tracking-[0.22em] text-zinc-400">
          Return to an allowlisted app + at desk to cancel · Esc does not dismiss
        </p>
        <button
          type="button"
          onClick={props.onDemoKill}
          className="fp-btn inline-flex h-11 min-w-[260px] items-center justify-center gap-2 rounded-md bg-fp-red px-5 text-[13px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_0_28px_rgba(255,45,85,0.35)] hover:bg-[#ff4d6d]"
        >
          <IconBolt className="h-4 w-4" />
          Demo Kill — skip wait
        </button>
      </div>
    </div>
  );
}

function HudChip(props: { k: string; v: string; danger?: boolean }): JSX.Element {
  return (
    <div
      className={`rounded-md border px-3 py-1.5 ${
        props.danger ? "border-fp-red/45 bg-fp-red/15" : "border-white/10 bg-black/45"
      }`}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{props.k}</p>
      <p className="max-w-[240px] truncate font-mono text-[12px] text-zinc-100">{props.v}</p>
    </div>
  );
}

function ConsequenceCard(props: { kicker: string; title: string }): JSX.Element {
  return (
    <div className="rounded-lg border border-white/15 bg-black/50 px-4 py-3 text-left">
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-fp-red">{props.kicker}</p>
      <p className="mt-1 text-[17px] font-semibold leading-5 text-white">{props.title}</p>
    </div>
  );
}
