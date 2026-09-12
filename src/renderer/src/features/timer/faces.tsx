import { useId, useMemo, type JSX } from "react";
import { cn } from "../../lib/cn";
import { Globe } from "./flight/Globe";
import { formatKm, routeForMinutes } from "./flight/route";
import { formatReadout } from "./plan";

/**
 * Seven ways to watch the same session run out.
 *
 * Faces carry their own palette rather than inheriting the room's, because a
 * night globe and a pile of sand do not want the same colours. They all take
 * the same handful of numbers and nothing else, which is what lets the picker
 * render live previews of all seven side by side off one clock.
 */

export type FaceId =
  | "flight"
  | "hourglass"
  | "column"
  | "grid"
  | "eclipse"
  | "field"
  | "readout";

export interface FaceProps {
  /** 0..1 through the current phase. 1 means spent. */
  progress: number;
  remainingSec: number;
  /** Length of the whole phase, which is what the flight route is chosen from. */
  totalSec: number;
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

/**
 * Your session as a real flight. The route is the pair of airports whose block
 * time sits closest to the length you set, so a fifty-minute session is a
 * genuine fifty-minute hop and the plane lands when you are done.
 */
function Flight(props: FaceProps): JSX.Element {
  const minutes = Math.max(1, Math.round(props.totalSec / 60));
  const route = useMemo(() => routeForMinutes(minutes), [minutes]);
  const p = clamp01(props.progress);

  if (props.preview) {
    return (
      <div className={cn("flex h-full w-full items-center justify-center", props.className)}>
        <Globe route={route} progress={p} compact className="aspect-square h-full" />
      </div>
    );
  }

  return (
    <div className={cn("flex h-full flex-col items-center gap-4", props.className)}>
      <Globe route={route} progress={p} className="aspect-square min-h-0 w-auto flex-1" />

      <div className="flex shrink-0 items-center gap-4">
        <Endpoint iata={route.from.iata} city={route.from.city} />
        <div className="flex flex-col items-center gap-1">
          <div className="relative h-px w-28 bg-white/20">
            <span
              className="absolute inset-y-0 left-0 bg-[#8fe0ff]"
              style={{ width: `${p * 100}%` }}
            />
          </div>
          <span className="font-mono text-[10px] tracking-wider text-[#8fe0ff]/80 tabular">
            {formatKm(route.km)}
          </span>
        </div>
        <Endpoint iata={route.to.iata} city={route.to.city} align="right" />
      </div>
    </div>
  );
}

function Endpoint(props: { iata: string; city: string; align?: "right" }): JSX.Element {
  return (
    <div className={cn("min-w-[68px]", props.align === "right" ? "text-right" : "text-left")}>
      <p className="fp-display text-[19px] font-semibold leading-none text-[#dff3ff]">
        {props.iata}
      </p>
      <p className="mt-1 text-[11px] leading-none text-[#8fe0ff]/60">{props.city}</p>
    </div>
  );
}

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
        <linearGradient id={`${id}-sand`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f6e7bd" />
          <stop offset="100%" stopColor="#d8bd84" />
        </linearGradient>
        <clipPath id={`${id}-top`}>
          <path d="M15 11 L85 11 L50 59 Z" />
        </clipPath>
        <clipPath id={`${id}-bottom`}>
          <path d="M50 65 L85 113 L15 113 Z" />
        </clipPath>
      </defs>

      <path d="M15 11 L85 11 L50 59 Z M50 65 L85 113 L15 113 Z" fill="#9fb6cc" opacity="0.09" />
      <rect
        x="0"
        width="100"
        y={surface}
        height={topHeight}
        clipPath={`url(#${id}-top)`}
        fill={`url(#${id}-sand)`}
      />
      <rect
        x="0"
        width="100"
        y={pileTop}
        height={pileHeight}
        clipPath={`url(#${id}-bottom)`}
        fill={`url(#${id}-sand)`}
      />
      {pouring ? (
        <rect
          x="49.3"
          y="57"
          width="1.4"
          height={Math.max(0, pileTop - 57)}
          fill="#f6e7bd"
          opacity="0.8"
        />
      ) : null}

      <path
        d="M15 11 L85 11 L50 59 Z M50 65 L85 113 L15 113 Z"
        stroke="#9fc2d8"
        strokeOpacity="0.5"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path
        d="M12 8 H88 M12 116 H88"
        stroke="#c9d8e6"
        strokeOpacity="0.75"
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
        <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#a5ecff" />
          <stop offset="100%" stopColor="#2f6fd0" />
        </linearGradient>
        <clipPath id={`${id}-tube`}>
          <rect x="36" y="12" width="28" height={full} rx="14" />
        </clipPath>
      </defs>

      <rect x="36" y="12" width="28" height={full} rx="14" fill="#7fb2d8" opacity="0.1" />
      <rect
        x="36"
        y={12 + full - height}
        width="28"
        height={height}
        clipPath={`url(#${id}-tube)`}
        fill={`url(#${id}-fill)`}
      />
      <rect
        x="36"
        y="12"
        width="28"
        height={full}
        rx="14"
        stroke="#9fc2d8"
        strokeOpacity="0.5"
        strokeWidth="1.4"
      />

      {props.preview
        ? null
        : [0, 0.25, 0.5, 0.75, 1].map((tick) => (
            <path
              key={tick}
              d={`M24 ${12 + full * tick} H31`}
              stroke="#9fc2d8"
              strokeOpacity="0.45"
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
            fill={on ? "#8fe0ff" : "#7fb2d8"}
            opacity={on ? 1 - row * 0.035 : 0.12}
          />
        );
      })}
    </svg>
  );
}

/** A moon swallowed by the dark. No scale, no numbers — just less light. */
function Eclipse(props: FaceProps): JSX.Element {
  const id = useId();
  const p = clamp01(props.progress);
  const radius = 39;
  const occluder = 50 - 2 * radius + 2 * radius * p;

  return (
    <svg viewBox={SVG} className={props.className} fill="none" aria-hidden="true">
      <defs>
        <radialGradient id={`${id}-moon`} cx="38%" cy="34%" r="72%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="60%" stopColor="#dfeaf6" />
          <stop offset="100%" stopColor="#9db4cc" />
        </radialGradient>
        <radialGradient id={`${id}-corona`} cx="50%" cy="50%" r="50%">
          <stop offset="72%" stopColor="rgba(143, 224, 255, 0)" />
          <stop offset="88%" stopColor="rgba(143, 224, 255, 0.35)" />
          <stop offset="100%" stopColor="rgba(143, 224, 255, 0)" />
        </radialGradient>
      </defs>

      <rect x="0" y="0" width="100" height="124" fill={`url(#${id}-corona)`} />
      <circle cx="50" cy="62" r={radius} fill={`url(#${id}-moon)`} />
      <circle cx={occluder} cy="62" r={radius} fill="#0a0f18" />
      <circle cx="50" cy="62" r={radius} stroke="#8fe0ff" strokeOpacity="0.35" strokeWidth="1.2" />
    </svg>
  );
}

/** No object at all: the room cools from daylight to deep night as time goes. */
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
        <radialGradient id={id} cx="50%" cy="46%" r="62%">
          <stop offset="0%" stopColor="#7fd4ff" stopOpacity={0.5 - p * 0.28} />
          <stop offset="45%" stopColor="#3f6fc8" stopOpacity={0.3 - p * 0.2} />
          <stop offset="100%" stopColor="#120f2c" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="100" height="124" fill={`url(#${id})`} />
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
    id: "flight",
    label: "Flight",
    blurb:
      "Your session as a real flight. The route is the one whose block time matches the length you set, and the plane lands when you are done.",
    Face: Flight,
  },
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
    blurb: "A moon swallowed by the dark. The quietest of the seven.",
    Face: Eclipse,
  },
  {
    id: "field",
    label: "Field",
    blurb: "No object at all — the room cools from daylight to deep night.",
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

export const DEFAULT_FACE: FaceId = "flight";

export function faceDef(id: FaceId): FaceDef {
  return FACES.find((face) => face.id === id) ?? FACES[0]!;
}

export function isFaceId(value: unknown): value is FaceId {
  return typeof value === "string" && FACES.some((face) => face.id === value);
}
