import type { JSX } from "react";
import type { SessionState } from "@shared/ipc";
import { IconBolt } from "../lib/icons";
import {
  decisionLabel,
  deskPrimary,
  formatConfidence,
  padCountdown,
  plugStatusLine,
  windowPrimary,
} from "../lib/format";
import { enabledPlugViews, type PlugView } from "../lib/plugsUi";
import { DangerButton } from "./ui";

interface CountdownOverlayProps {
  seconds: number;
  total: number;
  reason: string;
  state: SessionState;
  plugs?: readonly PlugView[];
  onDemoKill: () => void;
}

export function CountdownOverlay(props: CountdownOverlayProps): JSX.Element {
  const total = Math.max(props.total, props.seconds, 1);
  const progress = props.seconds / total;
  const windowText = windowPrimary(props.state.focus);
  const deskText = props.state.desk
    ? `${deskPrimary(props.state.desk)} ${formatConfidence(props.state.desk.confidence)}`
    : "Desk AI standby";
  const armed = enabledPlugViews(props.plugs ?? []);
  const plugText =
    armed.length > 0 ? `${plugStatusLine(props.plugs ?? [])} will cut` : "No plugs armed";

  return (
    <div
      className="fixed inset-0 z-[50] flex flex-col bg-[#140808]"
      role="alertdialog"
      aria-modal="true"
      aria-label={`Force-quit in ${props.seconds} seconds`}
    >
      <div className="overlay-glow pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(230,25,25,0.32),transparent_58%)]" />
      <div className="fp-scan absolute inset-0 z-[1] opacity-40" aria-hidden="true" />

      <div className="relative z-10 grid grid-cols-2 gap-px border-b border-white/10 bg-white/10 md:grid-cols-4">
        <HudChip k="Window" v={windowText} />
        <HudChip k="Desk AI" v={deskText} />
        <HudChip k="Plugs" v={plugText} danger={armed.length > 0} />
        <HudChip k="Decision" v={decisionLabel(props.state.decision)} danger />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <p className="font-mono text-[12px] font-medium uppercase tracking-[0.28em] text-fp-red">
          Killing blocked apps in
        </p>

        <p
          key={props.seconds}
          className="overlay-num mt-3 font-mono text-[min(38vw,220px)] font-bold leading-none tabular text-white"
        >
          {padCountdown(props.seconds)}
        </p>

        <div className="mt-6 h-2 w-full max-w-xl bg-white/10" aria-hidden="true">
          <div
            className="h-full origin-left bg-fp-red transition-transform duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>

        <p className="mt-5 max-w-xl text-center text-[17px] text-pretty text-zinc-200">
          {props.reason}
        </p>
        <p className="mt-2 font-mono text-[12px] uppercase tracking-[0.16em] text-zinc-500">
          Return to an allowlisted app to cancel
        </p>
        {armed.length > 0 ? (
          <p className="mt-2 max-w-lg text-center text-[13px] text-fp-amber">
            Enabled plugs cut with the kill. Never the study PC.
          </p>
        ) : null}
      </div>

      <div className="hazard-band relative z-10 flex flex-col items-center gap-3 border-t border-fp-red/40 py-6">
        <DangerButton onClick={props.onDemoKill} className="min-w-[240px] uppercase tracking-[0.14em]">
          <IconBolt className="h-4 w-4" />
          Demo Kill - skip wait
        </DangerButton>
      </div>
    </div>
  );
}

function HudChip(props: { k: string; v: string; danger?: boolean }): JSX.Element {
  return (
    <div className={`bg-[#140808] px-4 py-3 ${props.danger ? "text-fp-red" : ""}`}>
      <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-zinc-500">
        [ {props.k} ]
      </p>
      <p className="mt-1 max-w-full truncate font-mono text-[12px] text-zinc-100">{props.v}</p>
    </div>
  );
}
