import type { JSX } from "react";
import type { SessionState } from "@shared/ipc";
import { IconBolt } from "../lib/icons";
import {
  decisionLabel,
  deskPrimary,
  formatConfidence,
  padCountdown,
  windowPrimary,
} from "../lib/format";
import { DangerButton } from "./ui";

interface CountdownOverlayProps {
  seconds: number;
  total: number;
  reason: string;
  state: SessionState;
  onDemoKill: () => void;
}

export function CountdownOverlay(props: CountdownOverlayProps): JSX.Element {
  const total = Math.max(props.total, props.seconds, 1);
  const progress = props.seconds / total;
  const radius = 132;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - progress);
  const windowText = windowPrimary(props.state.focus);
  const deskText = props.state.desk
    ? `${deskPrimary(props.state.desk)} ${formatConfidence(props.state.desk.confidence)}`
    : "Desk AI standby";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-black/88"
      role="alertdialog"
      aria-modal="true"
      aria-label={`Force-quit in ${props.seconds} seconds`}
    >
      <div className="overlay-glow pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,45,85,0.38),transparent_58%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.45),transparent_18%,transparent_82%,rgba(0,0,0,0.55))]" />

      <div className="relative z-10 flex justify-center gap-2 px-6 pt-6">
        <HudChip k="Window" v={windowText} />
        <HudChip k="Desk AI" v={deskText} />
        <HudChip k="Decision" v={decisionLabel(props.state.decision)} danger />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <p className="text-[12px] font-semibold uppercase tracking-[0.46em] text-fp-red">
          Killing blocked apps in
        </p>

        <div className="relative mt-5 flex h-[300px] w-[300px] items-center justify-center">
          <svg className="absolute inset-0" viewBox="0 0 300 300" aria-hidden="true">
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
            className="overlay-num font-mono text-[148px] font-bold leading-none tabular text-white drop-shadow-[0_0_40px_rgba(255,45,85,0.55)]"
          >
            {padCountdown(props.seconds)}
          </p>
        </div>

        <p className="mt-2 max-w-xl text-center text-[17px] text-zinc-200">{props.reason}</p>
        <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.22em] text-zinc-500">
          Return to an allowlisted app to cancel
        </p>
      </div>

      <div className="relative z-10 flex flex-col items-center gap-3 pb-8">
        <DangerButton onClick={props.onDemoKill} className="min-w-[240px] uppercase tracking-[0.14em]">
          <IconBolt className="h-4 w-4" />
          Demo Kill — skip wait
        </DangerButton>
      </div>
    </div>
  );
}

function HudChip(props: { k: string; v: string; danger?: boolean }): JSX.Element {
  return (
    <div
      className={`rounded-md border px-3 py-1.5 ${
        props.danger
          ? "border-fp-red/40 bg-fp-red/10"
          : "border-white/10 bg-black/40"
      }`}
    >
      <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-zinc-500">{props.k}</p>
      <p className="max-w-[220px] truncate font-mono text-[12px] text-zinc-100">{props.v}</p>
    </div>
  );
}
