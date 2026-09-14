import { useState, type JSX } from "react";
import type { DeskCorrectionsState } from "@shared/correction/types";
import { cn } from "../../lib/cn";
import { gateRows, headStatusView, refitSummary } from "./model";
import "./corrections.css";

/**
 * Which attention head is running, what it scores, and what the shipped head
 * scores beside it.
 *
 * Both numbers, every time. A personal head that beat the gate is still a head
 * fitted from a dozen photographs of one room, and the honest way to say that
 * is to print the number it beat rather than to print one number and let the
 * reader assume it means something.
 *
 * The refit button lives here and nowhere else. One click never retrains: the
 * verdict chips write JPEGs and a JSON record and have no path to any fitting
 * code, and this is the separate, explicit action — disabled until the floors
 * are met, and refused outright by main while a session is running.
 */
export function HeadStatus(props: {
  state: DeskCorrectionsState;
  busy: boolean;
  onRefit: () => void;
  personalEnabled: boolean;
  onTogglePersonal: (next: boolean) => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const view = headStatusView(props.state);
  const rows = gateRows(props.state.lastRefit);
  const tone = view.variant === "personal" ? "focus" : view.variant === "failed" ? "warn" : "mute";
  // The revert switch renders off "a head exists", never off "a head is
  // running" — otherwise turning it off would hide the control that turns it
  // back on, and the preference would be one-way.
  const revertable = view.hasPersonalHead;

  return (
    <div className="border-t border-fp-line pt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13px] font-medium">{view.title}</p>
        <span
          className={cn(
            "font-mono text-[11px]",
            tone === "focus" ? "text-fp-focus" : tone === "warn" ? "text-fp-warn" : "text-fp-faint",
          )}
        >
          {view.variant === "personal" ? "personal head active" : "shipped head active"}
        </span>
      </div>

      <p className="mt-1 text-[12px] leading-snug text-fp-mute">{view.body}</p>
      {view.needLine === null ? null : (
        <p className="mt-1 text-[12px] leading-snug text-fp-faint">{view.needLine}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!view.refitReady || props.busy}
          onClick={props.onRefit}
          className="fp-btn h-9 rounded-[var(--radius-fp)] border border-fp-line px-3 text-[12px] font-medium hover:border-white/25 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {props.busy ? "Fitting…" : view.refitLabel}
        </button>
        {rows.length === 0 ? null : (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
            className="fp-btn h-9 rounded-[var(--radius-fp)] px-2 text-[12px] font-medium text-fp-faint hover:text-fp-ink"
          >
            {open ? "Hide the gates" : "Why this?"}
          </button>
        )}
        {revertable ? (
          <label className="ml-auto flex items-center gap-2 text-[12px] text-fp-mute">
            <input
              type="checkbox"
              checked={props.personalEnabled}
              onChange={(event) => props.onTogglePersonal(event.target.checked)}
              className="accent-fp-lime"
            />
            {/* A preference, not a capability: it can only ever turn OFF a head
                the gate already let in. */}
            Use the personal head
          </label>
        ) : null}
      </div>

      {open ? (
        <div className="mt-3 border-t border-fp-line pt-3">
          <p className="fp-section-label">Every gate, in order</p>
          <ul className="mt-2">
            {rows.map((row) => (
              <li
                key={row.id}
                className={cn(
                  "fp-refit-gate-row border-b border-fp-line py-1.5 text-[12px] last:border-b-0",
                  row.passed ? "text-fp-mute" : row.blocking ? "text-fp-warn" : "text-fp-faint",
                )}
              >
                <span aria-hidden="true">{row.passed ? "✓" : row.blocking ? "×" : "·"}</span>
                <span className="font-mono text-[11px]">{row.id}</span>
                <span className="min-w-0">{row.detail}</span>
              </li>
            ))}
          </ul>
          {props.state.lastRefit === null ? null : (
            <p className="mt-2 text-[11px] leading-4 text-fp-faint">
              {refitSummary(props.state.lastRefit)} λ {props.state.lastRefit.lambda}, {" "}
              {props.state.lastRefit.epochs} epochs, {props.state.lastRefit.corrections.trainGroups}{" "}
              train and {props.state.lastRefit.corrections.evalGroups} held-out corrections. The
              interval beside the pooled number is reported, never used as the gate.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
