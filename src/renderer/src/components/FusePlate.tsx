import type { JSX } from "react";
import { IconBolt } from "../lib/icons";
import { padCountdown, type Tone } from "../lib/format";

interface FusePlateProps {
  seconds: number;
  total: number;
  idle: boolean;
  decision: string;
  decisionTone: Tone;
  deskLabel: string;
  deskConfidence: number | null;
  deskTone: Tone;
  onDemoKill: () => void;
}

const SIZE = 236;
const CX = SIZE / 2;
const CY = SIZE / 2;
const OUTER_R = 102;
const INNER_R = 84;
const OUTER_C = 2 * Math.PI * OUTER_R;
const INNER_C = 2 * Math.PI * INNER_R;

export function FusePlate(props: FusePlateProps): JSX.Element {
  const fuseProgress = props.idle ? 1 : Math.min(1, Math.max(0, props.seconds / Math.max(props.total, 1)));
  const deskProgress = props.deskConfidence === null ? 0 : Math.min(1, Math.max(0, props.deskConfidence));
  const fuseColor = props.idle
    ? props.decisionTone === "live"
      ? "#f4efe4"
      : "#5c616a"
    : "#e23b2f";
  const deskColor = hexForTone(props.deskTone);
  const stampClass =
    props.decisionTone === "live"
      ? "tone-live"
      : props.decisionTone === "kill"
        ? "tone-kill"
        : props.decisionTone === "warn"
          ? "tone-warn"
          : "tone-mute";
  const secsClass = props.idle ? (props.decisionTone === "live" ? "tone-live" : "tone-mute") : "tone-kill";

  return (
    <aside className="fuse" aria-label="Fuse plate">
      <div className="fuse-dial">
        <svg className="fuse-svg" viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden="true">
          <circle
            cx={CX}
            cy={CY}
            r={OUTER_R}
            fill="none"
            stroke="#2a2d33"
            strokeWidth="7"
          />
          <circle
            cx={CX}
            cy={CY}
            r={INNER_R}
            fill="none"
            stroke="#24262c"
            strokeWidth="5"
          />
          <circle
            cx={CX}
            cy={CY}
            r={OUTER_R}
            fill="none"
            stroke={fuseColor}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={OUTER_C}
            strokeDashoffset={OUTER_C * (1 - fuseProgress)}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
          <circle
            cx={CX}
            cy={CY}
            r={INNER_R}
            fill="none"
            stroke={deskColor}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={INNER_C}
            strokeDashoffset={INNER_C * (1 - deskProgress)}
            transform={`rotate(-90 ${CX} ${CY})`}
          />
        </svg>
        <div className="fuse-center">
          <p key={props.seconds} className={`fuse-secs ${secsClass}`}>
            {padCountdown(props.seconds)}
          </p>
          <p className="fuse-unit">{props.idle ? "armed fuse" : "seconds left"}</p>
        </div>
      </div>

      <span className={`stamp ${stampClass}`}>{props.decision}</span>

      <div className={`desk-read ${deskColorClass(props.deskTone)}`}>
        <div className="desk-read-top">
          <span>Desk AI</span>
          <span>
            {props.deskLabel}
            {props.deskConfidence === null ? "" : ` ${Math.round(props.deskConfidence * 100)}%`}
          </span>
        </div>
        <div className="desk-track">
          <div className="desk-fill" style={{ width: `${Math.round(deskProgress * 100)}%` }} />
        </div>
      </div>

      <button type="button" className="kill-plate" onClick={props.onDemoKill}>
        <IconBolt className="h-4 w-4" />
        Demo Kill
      </button>
    </aside>
  );
}

function deskColorClass(tone: Tone): string {
  if (tone === "live") return "tone-live";
  if (tone === "warn") return "tone-warn";
  if (tone === "kill") return "tone-kill";
  return "tone-mute";
}

function hexForTone(tone: Tone): string {
  if (tone === "live") return "#f4efe4";
  if (tone === "warn") return "#d4a056";
  if (tone === "kill") return "#e23b2f";
  return "#5c616a";
}
