import type { JSX } from "react";
import type { SessionState } from "@shared/ipc";
import { IconBolt } from "../lib/icons";
import {
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
  const plugText = armed.length > 0 ? `${plugStatusLine(props.plugs ?? [])}, will cut` : "No plugs armed";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col bg-fp-well"
      role="alertdialog"
      aria-modal="true"
      aria-label={`Force-quit in ${props.seconds} seconds`}
    >
      <div
        className="h-[3px] origin-left bg-fp-kill transition-transform duration-1000 ease-linear"
        style={{ transform: `scaleX(${progress})` }}
        aria-hidden="true"
      />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-8">
        <p className="text-[13px] font-medium tracking-[0.18em] text-fp-kill">
          Killing blocked apps in
        </p>
        <p
          key={props.seconds}
          className="fuse-tick mt-2 font-display text-[min(32vw,220px)] font-extrabold leading-none tracking-[-0.06em] text-fp-ink tabular"
        >
          {padCountdown(props.seconds)}
        </p>
        <p className="mt-4 max-w-xl text-center text-[18px] text-fp-ink">{props.reason}</p>
        <p className="mt-3 max-w-lg text-center font-mono text-[12px] text-fp-faint">
          {windowText}
          {"  "}
          {deskText}
          {"  "}
          {plugText}
        </p>
        <p className="mt-2 text-[13px] text-fp-mute">Return to an allowlisted app to cancel</p>
        {armed.length > 0 ? (
          <p className="mt-2 max-w-lg text-center text-[13px] text-fp-warn">
            Enabled plugs cut with the kill. Never the study PC.
          </p>
        ) : null}
      </div>

      <div className="flex justify-center pb-10">
        <DangerButton onClick={props.onDemoKill} className="min-w-[220px]">
          <IconBolt className="h-4 w-4" />
          Demo Kill, skip wait
        </DangerButton>
      </div>
    </div>
  );
}
