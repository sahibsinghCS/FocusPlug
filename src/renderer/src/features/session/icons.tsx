import type { JSX } from "react";
import type { Decision } from "@shared/ipc";

interface IconProps {
  className?: string;
}

export function IconOnTask(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={props.className} aria-hidden="true">
      <circle cx="24" cy="24" r="16.5" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="24" cy="24" r="8.5" stroke="currentColor" strokeWidth="2.4" />
      <circle cx="24" cy="24" r="2.6" fill="currentColor" />
    </svg>
  );
}

export function IconDistracted(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={props.className} aria-hidden="true">
      <circle cx="24" cy="24" r="16.5" stroke="currentColor" strokeWidth="2.4" />
      <path d="M16 16 32 32M32 16 16 32" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}

export function IconAway(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={props.className} aria-hidden="true">
      <circle cx="24" cy="15" r="6" stroke="currentColor" strokeWidth="2.4" />
      <path
        d="M12 34.5c1.6-6 6.1-9 12-9s10.4 3 12 9"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
      <path d="M38 12 42 8M42 12l-4-4" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconIdle(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={props.className} aria-hidden="true">
      <circle cx="24" cy="24" r="16.5" stroke="currentColor" strokeWidth="2.4" />
      <path d="M19 17v14M29 17v14" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" />
    </svg>
  );
}

export function DecisionGlyph(props: { decision: Decision; className?: string }): JSX.Element {
  if (props.decision === "ON_TASK") return <IconOnTask className={props.className} />;
  if (props.decision === "DISTRACTED") return <IconDistracted className={props.className} />;
  if (props.decision === "AWAY") return <IconAway className={props.className} />;
  return <IconIdle className={props.className} />;
}
