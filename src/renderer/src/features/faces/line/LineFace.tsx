import { useMemo, type JSX } from "react";
import type { FaceProps } from "../instrument";
import { formatRemain } from "../derive";
import {
  nextStation,
  passedStations,
  pointAtProgress,
  resolveStations,
  segmentKindAt,
  segmentMetrics,
  transitPolyline,
  type Station,
} from "./math";

const FOCUS = "#0053D6";
const BREAK = "#F05A10";
const INK = "#16181d";
const PAPER = "#f3eee1";

export function LineFace(props: FaceProps): JSX.Element {
  const path = useMemo(() => transitPolyline(), []);
  const stations = useMemo(() => resolveStations(props), [props]);
  const { total, lengths } = useMemo(() => segmentMetrics(path), [path]);
  const train = pointAtProgress(path, props.progress);
  const passed = passedStations(stations, props.progress);
  const upcoming = nextStation(stations, props.progress);
  const pulse = props.freeze ? 0.7 : 0.55 + 0.45 * Math.abs(Math.sin(props.nowMs / 280));

  const mapped = path.map((pt) => toView(pt.x, pt.y));
  const d = mapped
    .map((pt, index) => `${index === 0 ? "M" : "L"} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
    .join(" ");

  const segments = segmentPaths(path, lengths, total, props);

  return (
    <div className="fp-face fp-face-line" style={{ background: PAPER }}>
      <svg
        viewBox="0 0 1280 800"
        width="100%"
        height="100%"
        role="img"
        aria-label="Transit map of the session"
      >
        <rect width="1280" height="800" fill={PAPER} />
        <PaperGrain />
        <text
          x="72"
          y="86"
          fill={INK}
          fontFamily="Geist, sans-serif"
          fontSize="42"
          fontWeight="650"
          letterSpacing="-0.04em"
        >
          FOCUS  LINE
        </text>
        <text
          x="72"
          y="118"
          fill="rgba(22,24,29,0.5)"
          fontFamily="IBM Plex Mono, monospace"
          fontSize="16"
        >
          {stationLegend(stations, props)} · {formatRemain(props.remainingMs)} remain
        </text>

        <g fill="none" strokeLinecap="square" strokeLinejoin="miter">
          <path d={d} stroke="rgba(22,24,29,0.08)" strokeWidth="28" />
          {segments.map((seg) => (
            <path
              key={seg.id}
              d={seg.d}
              stroke={seg.kind === "break" ? BREAK : FOCUS}
              strokeWidth="18"
            />
          ))}
        </g>

        {stations.map((station) => (
          <StationMark
            key={station.id}
            station={station}
            filled={passed.has(station.id)}
            pulse={upcoming?.id === station.id ? pulse : 0}
            path={path}
          />
        ))}

        <Train x={train.x} y={train.y} angle={train.angle} phase={props.phase} />

        <Legend />
      </svg>
    </div>
  );
}

function stationLegend(stations: readonly Station[], props: FaceProps): string {
  if (props.rounds && props.rounds.length > 0) {
    return `${stations.length} stations · rounds + breaks`;
  }
  if (stations.length === 2) {
    return "One line · two stops";
  }
  return "Milestones at thirds";
}

function toView(x: number, y: number): { x: number; y: number } {
  return { x: x * 1280, y: y * 800 };
}

function segmentPaths(
  path: ReturnType<typeof transitPolyline>,
  lengths: number[],
  total: number,
  props: FaceProps,
): Array<{ id: string; d: string; kind: "focus" | "break" }> {
  const out: Array<{ id: string; d: string; kind: "focus" | "break" }> = [];
  let traveled = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    const len = lengths[i - 1] ?? 0;
    if (!a || !b || len <= 0) {
      continue;
    }
    const mid = (traveled + len / 2) / total;
    const pa = toView(a.x, a.y);
    const pb = toView(b.x, b.y);
    out.push({
      id: `seg-${i}`,
      d: `M ${pa.x} ${pa.y} L ${pb.x} ${pb.y}`,
      kind: segmentKindAt(props.rounds, mid, props.phase),
    });
    traveled += len;
  }
  return out;
}

function StationMark(props: {
  station: Station;
  filled: boolean;
  pulse: number;
  path: ReturnType<typeof transitPolyline>;
}): JSX.Element {
  const sample = pointAtProgress(props.path, props.station.at);
  const { x, y } = toView(sample.x, sample.y);
  const color = props.station.kind === "break" ? BREAK : FOCUS;
  const labelSide = sample.y > 0.55 ? -1 : 1;
  return (
    <g>
      {props.pulse > 0 ? (
        <circle
          cx={x}
          cy={y}
          r={16 + props.pulse * 8}
          fill="none"
          stroke={color}
          strokeWidth="3"
          opacity={0.35 + props.pulse * 0.4}
        />
      ) : null}
      <circle
        cx={x}
        cy={y}
        r="13"
        fill={props.filled ? color : PAPER}
        stroke={INK}
        strokeWidth="4"
      />
      <text
        x={x}
        y={y + labelSide * 32}
        textAnchor="middle"
        fill={INK}
        fontFamily="Geist, sans-serif"
        fontSize="18"
        fontWeight="650"
      >
        {props.station.label}
      </text>
    </g>
  );
}

function Train(props: { x: number; y: number; angle: number; phase: FaceProps["phase"] }): JSX.Element {
  const { x, y } = toView(props.x, props.y);
  const color = props.phase === "break" ? BREAK : FOCUS;
  return (
    <g transform={`translate(${x} ${y}) rotate(${(props.angle * 180) / Math.PI})`}>
      <rect x="-26" y="-12" width="52" height="24" rx="6" fill={INK} />
      <rect x="-20" y="-7" width="14" height="10" rx="2" fill="#d9e7ff" />
      <rect x="-2" y="-7" width="14" height="10" rx="2" fill="#d9e7ff" />
      <rect x="16" y="-5" width="10" height="10" rx="2" fill={color} />
    </g>
  );
}

function Legend(): JSX.Element {
  return (
    <g fontFamily="Geist, sans-serif" fontSize="15" fontWeight="600">
      <rect x="72" y="700" width="18" height="8" fill={FOCUS} />
      <text x="100" y="709" fill={INK}>
        Focus
      </text>
      <rect x="180" y="700" width="18" height="8" fill={BREAK} />
      <text x="208" y="709" fill={INK}>
        Break
      </text>
      <circle cx="300" cy="704" r="7" fill={FOCUS} stroke={INK} strokeWidth="2.5" />
      <text x="316" y="709" fill={INK}>
        Passed
      </text>
      <circle cx="410" cy="704" r="7" fill={PAPER} stroke={INK} strokeWidth="2.5" />
      <text x="426" y="709" fill={INK}>
        Next
      </text>
    </g>
  );
}

function PaperGrain(): JSX.Element {
  return (
    <g opacity="0.14" stroke="rgba(80,60,30,0.35)" strokeWidth="1">
      <path d="M0 220 H1280" />
      <path d="M0 400 H1280" />
      <path d="M0 580 H1280" />
      <path d="M260 0 V800" />
      <path d="M640 0 V800" />
      <path d="M1020 0 V800" />
    </g>
  );
}
