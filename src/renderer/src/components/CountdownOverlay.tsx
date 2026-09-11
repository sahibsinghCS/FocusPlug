import type { JSX } from "react";
import type { SessionState } from "@shared/ipc";
import { IconBolt } from "../lib/icons";
import {
  deskPrimary,
  formatConfidence,
  padCountdown,
  plugStatusLine,
  windowPrimary,
  windowSecondary,
} from "../lib/format";
import { enabledPlugViews, type PlugView } from "../lib/plugsUi";

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
  const accused = props.state.focus ? windowSecondary(props.state.focus) : windowPrimary(props.state.focus);
  const processName = windowPrimary(props.state.focus);
  const deskText = props.state.desk
    ? `${deskPrimary(props.state.desk)} ${formatConfidence(props.state.desk.confidence)}`
    : "Desk AI standby";
  const armed = enabledPlugViews(props.plugs ?? []);
  const plugText = armed.length > 0 ? `${plugStatusLine(props.plugs ?? [])}, will cut` : "No plugs armed";

  return (
    <div
      className="lockout"
      role="alertdialog"
      aria-modal="true"
      aria-label={`Force-quit in ${props.seconds} seconds`}
    >
      <div className="lockout-fuse" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden="true" />

      <div className="lockout-top">
        <p className="lockout-brand">FocusPlug</p>
        <div className="lockout-copy">
          <p>Killing blocked apps in</p>
          <p>{props.reason}</p>
          <p>Return to an allowlisted app to cancel</p>
        </div>
      </div>

      <div className="lockout-hero">
        <p key={props.seconds} className="lockout-secs">
          {padCountdown(props.seconds)}
        </p>
        <p className="lockout-window" title={accused}>
          {accused}
        </p>
      </div>

      <div className="lockout-foot">
        <dl className="lockout-sensors">
          <div className="lockout-sensor">
            <dt>Window</dt>
            <dd>
              <b>{processName}</b>
            </dd>
          </div>
          <div className="lockout-sensor">
            <dt>Desk AI</dt>
            <dd>
              <b>{deskText}</b>
            </dd>
          </div>
          <div className="lockout-sensor">
            <dt>Plugs</dt>
            <dd>
              <b>{plugText}</b>
            </dd>
          </div>
        </dl>
        <button type="button" className="lockout-kill" onClick={props.onDemoKill}>
          <IconBolt className="h-5 w-5" />
          Demo Kill, skip wait
        </button>
      </div>
    </div>
  );
}
