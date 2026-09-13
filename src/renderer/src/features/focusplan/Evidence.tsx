import type { JSX } from "react";
import { cn } from "../../lib/cn";
import type { EvidenceRowView } from "./model";
import "./plan.css";

/**
 * "Why this?" — one row per round in the window, ineligible rounds greyed with
 * the reason they do not count, and the method string printed verbatim
 * underneath.
 *
 * This is the feature's audit surface, not a nicety: a student who reads five
 * rounds in their history and three in the reasoning must be able to find the
 * other two, on screen, without opening a log.
 */
export function Evidence(props: {
  id: string;
  rows: readonly EvidenceRowView[];
  method: string;
  summary: string;
}): JSX.Element {
  return (
    <div id={props.id} className="mt-3 border-t border-fp-line pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="fp-section-label">Every round in the window</p>
        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-fp-faint">
          {props.summary}
        </p>
      </div>

      {props.rows.length === 0 ? (
        <p className="mt-2 text-[12px] text-fp-mute">
          Nothing recorded yet. The first round you run appears here, counted or not.
        </p>
      ) : (
        <ul className="mt-2">
          {props.rows.map((row) => (
            <li
              key={row.key}
              className={cn(
                "fp-plan-evidence-row border-b border-fp-line py-1.5 text-[12px] last:border-b-0",
                row.counted ? "text-fp-ink" : "text-fp-faint",
              )}
            >
              <span className="font-mono text-[11px] text-fp-faint tabular">{row.when}</span>
              <span className="font-mono text-[11px] text-fp-faint">{row.round}</span>
              <span className="truncate" title={row.planned}>
                {row.planned} · {row.outcome}
              </span>
              <span className="truncate text-fp-mute" title={row.note}>
                {row.note}
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] leading-4 text-fp-faint">{props.method}</p>
    </div>
  );
}
