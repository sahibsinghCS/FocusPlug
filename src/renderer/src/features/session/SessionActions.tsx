import type { JSX } from "react";
import { IconBolt } from "../../lib/icons";
import { cn } from "../../lib/cn";

export function SessionActions(props: {
  sessionActive: boolean;
  busy?: boolean;
  killNote: string;
  onStart: () => void;
  onStop: () => void;
  onDemoKill: () => void;
}): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {props.sessionActive ? (
          <button
            type="button"
            onClick={props.onStop}
            disabled={props.busy}
            className="inline-flex h-11 min-w-[148px] items-center justify-center rounded-md border border-fp-line-strong bg-white/5 px-4 text-[14px] font-semibold text-fp-ink transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Stop session
          </button>
        ) : (
          <button
            type="button"
            onClick={props.onStart}
            disabled={props.busy}
            className="inline-flex h-11 min-w-[148px] items-center justify-center rounded-md bg-fp-lime px-4 text-[14px] font-semibold text-fp-bg transition hover:bg-[#e2ff6a] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Start session
          </button>
        )}
        <button
          type="button"
          onClick={props.onDemoKill}
          disabled={props.busy}
          className={cn(
            "inline-flex h-11 items-center justify-center gap-2 rounded-md border border-fp-red/50 bg-fp-red/10 px-4 text-[13px] font-semibold uppercase tracking-[0.12em] text-fp-red transition hover:bg-fp-red/20 disabled:cursor-not-allowed disabled:opacity-40",
          )}
        >
          <IconBolt className="h-4 w-4" />
          Demo Kill
        </button>
      </div>
      <p className="text-[12px] leading-5 text-fp-mute">
        <span className="font-medium text-zinc-300">Demo Kill</span> skips the fuse: force-quit
        blocklist apps and cut armed plugs. {props.killNote}
      </p>
    </div>
  );
}
