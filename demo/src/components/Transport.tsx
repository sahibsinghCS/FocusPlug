import type { JSX } from "react";
import { cn } from "@renderer/lib/cn";
import type { TimelineMark } from "../timeline";

/**
 * Transport for the scripted run: play/pause, restart, a 2x toggle for judges
 * who have already seen the beat once, and chapter chips that jump straight
 * to the second a real event landed.
 */
export function Transport(props: {
  playing: boolean;
  onTogglePlay: () => void;
  onRestart: () => void;
  speed: 1 | 2;
  onToggleSpeed: () => void;
  index: number;
  maxIndex: number;
  onSeek: (index: number) => void;
  marks: readonly TimelineMark[];
  t: number;
  durationSec: number;
  finished: boolean;
}): JSX.Element {
  const progress = props.maxIndex > 0 ? (props.index / props.maxIndex) * 100 : 0;
  return (
    <section className="fp-card px-4 py-2.5" aria-label="Replay transport">
      <div className="flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={props.onTogglePlay}
          aria-label={props.playing ? "Pause" : "Play"}
          className="fp-btn inline-flex h-8 w-[84px] items-center justify-center gap-1.5 rounded-md bg-fp-lime text-[12px] font-semibold uppercase tracking-[0.12em] text-fp-mark-ink shadow-fp-lime hover:bg-[#e2ff6a]"
        >
          {props.playing ? <PauseGlyph /> : <PlayGlyph />}
          {props.playing ? "Pause" : props.finished ? "Replay" : "Play"}
        </button>
        <button
          type="button"
          onClick={props.onRestart}
          className="fp-btn inline-flex h-8 items-center justify-center rounded-md border border-fp-line-strong px-3 text-[12px] font-medium text-fp-ink hover:bg-fp-hover"
        >
          Restart
        </button>
        <button
          type="button"
          onClick={props.onToggleSpeed}
          aria-pressed={props.speed === 2}
          aria-label="Playback speed"
          className={cn(
            "fp-btn inline-flex h-8 w-12 items-center justify-center rounded-md border text-[12px] font-semibold tabular",
            props.speed === 2
              ? "border-fp-lime/40 bg-fp-lime/10 text-fp-lime"
              : "border-fp-line-strong text-fp-mute hover:bg-fp-hover hover:text-fp-ink",
          )}
        >
          {props.speed}×
        </button>

        <input
          type="range"
          min={0}
          max={props.maxIndex}
          step={1}
          value={props.index}
          aria-label="Scrub the session"
          onChange={(event) => props.onSeek(Number(event.target.value))}
          className="fp-demo-scrub h-1 min-w-[180px] flex-1"
          style={{ ["--fp-demo-progress" as string]: `${progress}%` }}
        />

        <p className="shrink-0 font-mono text-[12px] text-fp-mute tabular">
          <span className="text-fp-ink">+{String(props.t).padStart(2, "0")}s</span>
          <span className="text-fp-faint"> / {props.durationSec}s</span>
        </p>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {props.marks.map((mark) => {
          const active = props.t >= mark.t && props.t < mark.t + 4;
          return (
            <button
              key={mark.id}
              type="button"
              title={mark.hint}
              data-active={active}
              onClick={() => props.onSeek(Math.max(0, mark.t - 1))}
              className="fp-btn fp-demo-mark rounded-full border border-fp-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.08em] text-fp-mute hover:bg-fp-hover hover:text-fp-ink"
            >
              {mark.label}
              <span className="ml-1.5 text-fp-faint tabular">{mark.t}s</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PlayGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="currentColor">
      <path d="M3 1.6 10 6l-7 4.4z" />
    </svg>
  );
}

function PauseGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" className="h-3 w-3" aria-hidden="true" fill="currentColor">
      <rect x="2.5" y="1.8" width="2.6" height="8.4" rx="0.6" />
      <rect x="6.9" y="1.8" width="2.6" height="8.4" rx="0.6" />
    </svg>
  );
}
