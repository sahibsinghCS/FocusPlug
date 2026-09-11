import type { JSX } from "react";

interface IconProps {
  className?: string;
}

export function IconMark(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={props.className} aria-hidden="true">
      <rect x="3" y="3" width="26" height="26" rx="7" fill="currentColor" />
      <path
        d="M11 14.5V11.8c0-.7.6-1.3 1.3-1.3h1.4c.7 0 1.3.6 1.3 1.3v.9M17 11.8v.9c0-.7.6-1.3 1.3-1.3h1.4c.7 0 1.3.6 1.3 1.3V14.5"
        stroke="#09090b"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M10 16.2h12v3.2c0 2.4-2 4.4-4.4 4.4h-3.2C12 23.8 10 21.8 10 19.4v-3.2Z"
        stroke="#09090b"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconSession(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={props.className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="M8 8V5.2M8 8l2.3 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconAllow(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={props.className} aria-hidden="true">
      <path
        d="M3.2 8.3 6.1 11.2 12.8 4.6"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconBlock(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={props.className} aria-hidden="true">
      <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.4" />
      <path d="m4.4 4.4 7.2 7.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconPlug(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={props.className} aria-hidden="true">
      <path
        d="M6 3.2v3.1M10 3.2v3.1"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path
        d="M4.4 6.4h7.2v2.1c0 2.2-1.8 4-4 4h-.8c-2.2 0-4-1.8-4-4V6.4Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M8 12.5v1.3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconSettings(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={props.className} aria-hidden="true">
      <path d="M3 5h10M3 11h10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <circle cx="6.2" cy="5" r="1.5" fill="#09090b" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="9.8" cy="11" r="1.5" fill="#09090b" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function IconLog(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={props.className} aria-hidden="true">
      <path d="M4 4.5h8M4 8h8M4 11.5h5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconBolt(props: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" fill="none" className={props.className} aria-hidden="true">
      <path
        d="M8.8 2.5 3.5 9.2h4.1L7.2 13.5l5.3-6.7H8.4L8.8 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}
