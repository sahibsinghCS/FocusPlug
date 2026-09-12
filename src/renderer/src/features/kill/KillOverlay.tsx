import { useRef, type JSX } from "react";
import type { SessionState } from "@shared/ipc";
import { IconBolt } from "../../lib/icons";
import {
  decisionLabel,
  deskPrimary,
  formatConfidence,
  padCountdown,
  windowPrimary,
} from "../../lib/format";
import { enabledPlugViews, type PlugView } from "../../lib/plugsUi";
import { overlayConsequenceLines } from "./consequence";
import { useOverlayFocus } from "./useOverlayFocus";

interface KillOverlayProps {
  seconds: number;
  total: number;
  reason: string;
  state: SessionState;
  plugs?: readonly PlugView[];
  onDemoKill: () => void;
}

/**
 * The interruption. Lock mode is quiet on purpose, so when the fuse lights
 * everything else goes: the room floods crimson, the count takes the screen,
 * and the two consequences are spelled out while there is still time to fix it.
 */
export function KillOverlay(props: KillOverlayProps): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  useOverlayFocus(rootRef, true);

  const total = Math.max(props.total, props.seconds, 1);
  const progress = props.seconds / total;
  const windowText = windowPrimary(props.state.focus);
  const deskText = props.state.desk
    ? `${deskPrimary(props.state.desk)} ${formatConfidence(props.state.desk.confidence)}`
    : "Desk AI standby";
  const plugs = props.plugs ?? [];
  const armed = enabledPlugViews(plugs);
  const consequence = overlayConsequenceLines(plugs);

  return (
    <div
      ref={rootRef}
      // The fuse owns its own register: focus rings go crimson, not tungsten.
      style={{ ["--phase" as string]: "var(--color-fp-red)" }}
      className="fixed inset-0 z-50 flex flex-col bg-[#0a0207] text-white"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="fp-overlay-title"
      aria-describedby="fp-overlay-consequence"
    >
      <div className="overlay-glow pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(255,59,88,0.42),transparent_60%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_bottom,rgba(0,0,0,0.6),transparent_18%,transparent_76%,rgba(0,0,0,0.72))]" />

      <div className="relative z-10 flex flex-wrap justify-center gap-2 px-6 pt-5">
        <HudChip k="Window" v={windowText} danger={Boolean(props.state.focus?.matchedBlock)} />
        <HudChip k="Desk AI" v={deskText} danger={props.state.desk?.label === "away"} />
        <HudChip
          k="Plugs"
          v={armed.length > 0 ? `${armed.length} armed · will cut` : "No plugs armed"}
          danger={armed.length > 0}
        />
        <HudChip k="Decision" v={decisionLabel(props.state.decision)} danger />
      </div>

      <div className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-6">
        <p id="fp-overlay-title" className="fp-stencil text-fp-red">
          Killing blocked apps in
        </p>

        <div className="relative mt-2 flex w-full max-w-[520px] flex-col items-center">
          <p
            key={props.seconds}
            className="fp-readout overlay-num text-[min(30vw,220px)] text-white drop-shadow-[0_0_60px_rgba(255,59,88,0.6)]"
            aria-live="assertive"
          >
            {padCountdown(props.seconds)}
          </p>
          <div
            className="mt-6 h-[6px] w-full overflow-hidden rounded-full bg-white/10"
            role="presentation"
          >
            <span
              className="block h-full rounded-full bg-fp-red transition-[width] duration-500 ease-linear"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>

        <p className="mt-5 max-w-xl text-center text-[19px] font-medium text-zinc-100">
          {props.reason}
        </p>

        <div
          id="fp-overlay-consequence"
          className="mt-5 grid w-full max-w-3xl gap-2 min-[720px]:grid-cols-2"
        >
          <ConsequenceCard kicker="App kill" title={consequence.apps} />
          <ConsequenceCard kicker="Plugs cut" title={consequence.plugs} />
        </div>
      </div>

      <div className="relative z-10 flex shrink-0 flex-col items-center gap-3 px-6 pb-7">
        <p className="font-mono text-[11.5px] uppercase tracking-[0.2em] text-zinc-400">
          Back to an allowlisted app, at your desk, and this cancels · Esc does not dismiss
        </p>
        <button
          type="button"
          onClick={props.onDemoKill}
          className="fp-btn inline-flex h-11 min-w-[260px] items-center justify-center gap-2 rounded-[var(--radius-fp)] bg-fp-red px-5 text-[13px] font-semibold uppercase tracking-[0.14em] text-white shadow-[0_0_32px_rgba(255,59,88,0.4)] hover:bg-[#ff5a72]"
        >
          <IconBolt className="h-4 w-4" />
          Demo Kill — skip wait
        </button>
      </div>
    </div>
  );
}

function HudChip(props: { k: string; v: string; danger?: boolean }): JSX.Element {
  return (
    <div
      className={`rounded-md border px-3 py-1.5 ${
        props.danger ? "border-fp-red/45 bg-fp-red/15" : "border-white/10 bg-black/45"
      }`}
    >
      <p className="fp-stencil text-[9px] text-zinc-400">{props.k}</p>
      <p className="max-w-[240px] truncate font-mono text-[12px] text-zinc-100">{props.v}</p>
    </div>
  );
}

function ConsequenceCard(props: { kicker: string; title: string }): JSX.Element {
  return (
    <div className="rounded-[var(--radius-fp)] border border-white/15 bg-black/50 px-4 py-3 text-left">
      <p className="fp-stencil text-fp-red">{props.kicker}</p>
      <p className="mt-1 text-[16px] font-semibold leading-5 text-white">{props.title}</p>
    </div>
  );
}
