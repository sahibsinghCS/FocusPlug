import { useId, type JSX } from "react";
import { cn } from "../../lib/cn";
import { formatReadout } from "./plan";

/**
 * Six ways to watch the same session run out.
 *
 * Every face is monochrome and draws in `currentColor` against `--ground`, so
 * a break inverting the room inverts the face with it and nothing needs a
 * second palette. They all take the same two numbers and nothing else, which
 * is what lets the picker render live previews of all six at once.
 */

export type FaceId = "hourglass" | "column" | "grid" | "eclipse" | "field" | "readout";

export interface FaceProps {
  /** 0..1 through the current phase. 1 means spent. */
  progress: number;
  remainingSec: number;
  /** Small, in the picker. Faces drop detail that will not survive the size. */
  preview?: boolean;
  className?: string;
}

export interface FaceDef {
  id: FaceId;
  label: string;
  blurb: string;
  Face: (props: FaceProps) => JSX.Element;
  /** Fills the whole room rather than sitting in the middle of it. */
  ambient?: boolean;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

const SVG = "0 0 100 124";

/** Sand leaves the top chamber and piles up in the bottom. Nothing else. */
function Hourglass(props: FaceProps): JSX.Element {
  const id = useId();
  const p = clamp01(props.progress);
  const surface = 11 + 48 * p;
  const topHeight = Math.max(0, 59 - surface);
  const pileHeight = 46 * p;
  const pileTop = 113 - pileHeight;
  const pouring = p > 0.002 && p < 0.998;

  return (
    <svg viewBox={SVG} className={props.className} fill="none" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-top`}>
          <path d="M15 11 L85 11 L50 59 Z" />
        </clipPath>
        <clipPath id={`${id}-bottom`}>
          <path d="M50 65 L85 113 L15 113 Z" />
        </clipPath>
      </defs>

      <rect
        x="0"
        width="100"
        y={surface}
        height={topHeight}
        clipPath={`url(#${id}-top)`}
        fill="currentColor"
      />
      <rect
        x="0"
        width="100"
        y={pileTop}
        height={pileHeight}
        clipPath={`url(#${id}-bottom)`}
        fill="currentColor"
      />
      {pouring ? (
        <rect
          x="49.3"
          y="57"
          width="1.4"
          height={Math.max(0, pileTop - 57)}
          fill="currentColor"
          opacity="0.75"
        />
      ) : null}

      <path
        d="M15 11 L85 11 L50 59 Z M50 65 L85 113 L15 113 Z"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M12 8 H88 M12 116 H88"
        stroke="currentColor"
        strokeOpacity="0.55"
        strokeWidth="2.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A gauge emptying. The most literal face, and the easiest to read at a glance. */
function Column(props: FaceProps): JSX.Element {
  const id = useId();
  const p = clamp01(props.progress);
  const full = 98;
  const height = full * (1 - p);

  return (
    <svg viewBox={SVG} className={props.className} fill="none" aria-hidden="true">
      <defs>
        <clipPath id={`${id}-tube`}>
          <rect x="36" y="12" width="28" height={full} rx="14" />
        </clipPath>
      </defs>

      <rect x="36" y="12" width="28" height={full} rx="14" fill="currentColor" opacity="0.08" />
      <rect
        x="36"
        y={12 + full - height}
        width="28"
        height={height}
        clipPath={`url(#${id}-tube)`}
        fill="currentColor"
      />
      <rect
        x="36"
        y="12"
        width="28"
        height={full}
        rx="14"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="1.4"
      />

      {props.preview
        ? null
        : [0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <path
              key={tick}
              d={`M24 ${12 + full * tick} H31`}
              stroke="currentColor"
              strokeOpacity="0.35"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          ))}
    </svg>
  );
}

const GRID_COLUMNS = 6;
const GRID_ROWS = 7;
const GRID_CELLS = GRID_COLUMNS * GRID_ROWS;

/** Cells go out one by one. Discrete time — you can count what is left. */
function Grid(props: FaceProps): JSX.Element {
  const p = clamp01(props.progress);
  const lit = Math.ceil((1 - p) * GRID_CELLS);

  return (
    <svg viewBox={SVG} className={props.className} fill="none" aria-hidden="true">
      {Array.from({ length: GRID_CELLS }, (_, index) => {
        const column = index % GRID_COLUMNS;
        const row = Math.floor(index / GRID_COLUMNS);
        // Cells burn down from the last one, so the lit block stays contiguous.
        const on = GRID_CELLS - index <= lit;
        return (
          <rect
            key={index}
            x={9 + column * 14}
            y={13 + row * 14}
            width="11"
            height="11"
            rx="2"
            fill="currentColor"
            opacity={on ? 1 : 0.1}
          />
        );
      })}
    </svg>
  );
}

/** A disc swallowed by the dark. No scale, no numbers — just less light. */
function Eclipse(props: FaceProps): JSX.Element {
  const p = clamp01(props.progress);
  const radius = 39;
  const occluder = 50 - 2 * radius + 2 * radius * p;

  return (
    <svg viewBox={SVG} className={props.className} fill="none" aria-hidden="true">
      <circle cx="50" cy="62" r={radius} fill="currentColor" />
      <circle cx={occluder} cy="62" r={radius} fill="var(--ground)" />
      <circle
        cx="50"
        cy="62"
        r={radius}
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="1.4"
      />
    </svg>
  );
}

/** No object at all: the room simply dims as the session is spent. */
function Field(props: FaceProps): JSX.Element {
  const id = useId();
  const p = clamp01(props.progress);

  return (
    <svg
      viewBox={SVG}
      className={props.className}
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={id} cx="50%" cy="50%" r="52%">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.42" />
          <stop offset="55%" stopColor="currentColor" stopOpacity="0.14" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="124" fill={`url(#${id})`} opacity={1 - p} />
    </svg>
  );
}

/** The plain one. Still the fastest way to answer "how long have I got". */
function Readout(props: FaceProps): JSX.Element {
  return (
    <div className={cn("flex items-center justify-center", props.className)}>
      <p
        className={cn(
          "fp-readout text-[color:var(--phase)]",
          props.preview ? "text-[27px]" : "fp-lock-readout",
        )}
      >
        {formatReadout(props.remainingSec)}
      </p>
    </div>
  );
}

export const FACES: readonly FaceDef[] = [
  {
    id: "hourglass",
    label: "Hourglass",
    blurb: "Sand leaves the top and piles up in the bottom. No numbers to watch.",
    Face: Hourglass,
  },
  {
    id: "column",
    label: "Column",
    blurb: "A gauge emptying. Readable from across the room in one glance.",
    Face: Column,
  },
  {
    id: "grid",
    label: "Grid",
    blurb: "Cells go out one at a time. Time you can count instead of read.",
    Face: Grid,
  },
  {
    id: "eclipse",
    label: "Eclipse",
    blurb: "A disc swallowed by the dark. The quietest of the six.",
    Face: Eclipse,
  },
  {
    id: "field",
    label: "Field",
    blurb: "No object at all — the whole room dims as the session is spent.",
    Face: Field,
    ambient: true,
  },
  {
    id: "readout",
    label: "Readout",
    blurb: "The plain clock. Still the fastest answer to how long you have left.",
    Face: Readout,
  },
];

export const DEFAULT_FACE: FaceId = "hourglass";

export function faceDef(id: FaceId): FaceDef {
  return FACES.find((face) => face.id === id) ?? FACES[0]!;
}

export function isFaceId(value: unknown): value is FaceId {
  return typeof value === "string" && FACES.some((face) => face.id === value);
}
