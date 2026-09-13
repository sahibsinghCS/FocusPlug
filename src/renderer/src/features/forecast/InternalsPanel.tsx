import type { JSX } from "react";
import type { ForecastEvent, ForecastSnapshot } from "@shared/ipc";
import { cn } from "../../lib/cn";
import {
  calibrationLine,
  featureBars,
  hiddenCells,
  modelCard,
  receiptLine,
  whyNowRows,
} from "./model";

/**
 * Watch-it-think: top-5 attribution drivers in plain language, the full
 * per-feature occlusion strip (N bars, read off `snapshot.features` — never a
 * hardcoded count), the printed logit → Platt → risk line, the
 * per-feature term-group activations, the hit/miss/stood-down receipt, and the
 * model card fed from the committed weights + eval artifacts.
 */
export function InternalsPanel(props: {
  snapshot: ForecastSnapshot;
  events: readonly ForecastEvent[];
  greyApp?: string;
}): JSX.Element {
  const { snapshot } = props;
  const ctx = { greyApp: props.greyApp };
  const why = whyNowRows(snapshot.features, ctx);
  const bars = featureBars(snapshot.features, ctx);
  const cells = hiddenCells(snapshot.hidden);
  const receipt = receiptLine(props.events);
  const card = modelCard();

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {/* Why now — the top drivers, live. */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
          Why now
          <span
            className="ml-2 normal-case tracking-normal font-normal text-fp-faint/80"
            title="Occlusion deltas on calibrated risk — contribution estimates; they do not sum to the logit."
          >
            contribution estimate
          </span>
        </p>
        {!snapshot.ready ? (
          <p className="mt-1.5 text-[12px] text-fp-mute">
            Collecting telemetry — attributions unlock with the first read at 15 s.
          </p>
        ) : (
        <ul className="mt-1.5 space-y-1">
          {why.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              <span
                className={cn(
                  "w-14 shrink-0 text-right font-mono text-[11px] tabular",
                  row.negligible ? "text-fp-faint" : row.positive ? "text-fp-red" : "text-fp-blue",
                )}
              >
                {row.arrow} {row.delta}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-fp-ink" title={row.phrase}>
                {row.phrase}
              </span>
              <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-white/5">
                <span
                  className={cn(
                    "fp-forecast-bar block h-full rounded-full",
                    row.positive ? "bg-fp-red" : "bg-fp-blue",
                  )}
                  style={{ width: `${Math.round(row.magnitude * 100)}%` }}
                />
              </span>
            </li>
          ))}
        </ul>
        )}
      </div>

      {/* Every feature — signed occlusion bars around a center axis. The count
          comes from the snapshot array, so growing FORECAST_FEATURE_KEYS grows
          the strip with no edit here. */}
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
          Feature attributions · {bars.length} inputs
        </p>
        <div className="mt-1.5 grid grid-cols-1 gap-x-5 gap-y-[3px] min-[700px]:grid-cols-2">
          {bars.map((bar) => (
            <div
              key={bar.key}
              className="flex items-center gap-2"
              title={`${bar.phrase} · attribution ${bar.attribution >= 0 ? "+" : ""}${bar.attribution.toFixed(3)}`}
            >
              <span className="w-[100px] shrink-0 truncate font-mono text-[9px] uppercase tracking-[0.02em] text-fp-faint">
                {bar.label}
              </span>
              <span className="relative h-[7px] min-w-0 flex-1 overflow-hidden rounded-sm bg-white/[0.04]">
                <span className="absolute inset-y-0 left-1/2 w-px bg-fp-line-strong" />
                <span
                  className={cn(
                    "fp-forecast-bar absolute inset-y-[1px] rounded-sm",
                    bar.positive ? "left-1/2 bg-fp-red/80" : "right-1/2 bg-fp-blue/80",
                  )}
                  style={{ width: `${Math.round(bar.magnitude * 50)}%` }}
                />
              </span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-fp-faint">
          <span className="text-fp-red">■ pushes risk up</span>
          <span className="ml-3 text-fp-blue">■ holds risk down</span>
          <span className="ml-3">
            occluded to training mean · exact {bars.length + 1}-term delta per feature
          </span>
        </p>
      </div>

      {/* Calibration readout + term-group activations — the model, visibly. */}
      <div className="grid gap-2 min-[700px]:grid-cols-[minmax(0,1fr)_auto]">
        <div className="rounded-md border border-fp-line bg-fp-elev/60 px-2.5 py-1.5">
          <p className="text-[9px] font-semibold uppercase tracking-[0.18em] text-fp-faint">
            Calibration
          </p>
          <p className="mt-0.5 truncate font-mono text-[11px] text-fp-ink tabular" title={calibrationLine(snapshot)}>
            {calibrationLine(snapshot)}
          </p>
        </div>
        <div className="rounded-md border border-fp-line bg-fp-elev/60 px-2.5 py-1.5">
          <p
            className="text-[9px] font-semibold uppercase tracking-[0.18em] text-fp-faint"
            title="tanh of each feature's summed basis-term contribution. Product terms count toward both of their features, so these do not sum to the logit."
          >
            Term groups · tanh
          </p>
          <div className="mt-1 flex flex-wrap gap-[3px]" aria-hidden="true">
            {cells.map((cell, index) => (
              <span
                key={cell.key ?? index}
                className="fp-forecast-hidden-cell h-4 w-4 rounded-[3px] border border-fp-line"
                title={`${cell.label}: ${cell.value.toFixed(2)}`}
                style={{
                  backgroundColor: cell.positive
                    ? `rgba(255, 45, 85, ${(0.08 + cell.intensity * 0.7).toFixed(2)})`
                    : `rgba(122, 162, 255, ${(0.08 + cell.intensity * 0.7).toFixed(2)})`,
                }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* The receipt — hits, misses and stood-down alarms, equally loud. */}
      {receipt ? (
        <p
          className={cn(
            "font-mono text-[12px]",
            receipt.tone === "lime"
              ? "text-fp-lime"
              : receipt.tone === "red"
                ? "text-fp-red"
                : "text-fp-amber",
          )}
          role="status"
        >
          {receipt.icon} {receipt.text}
        </p>
      ) : null}

      {/* Model card — claims come from the committed artifacts, not copy. */}
      <div className="border-t border-fp-line pt-2">
        <p className="font-mono text-[10px] leading-4 text-fp-faint">
          {card.spec}
          <span className="mx-1.5 text-fp-line-strong">·</span>
          {card.evalLine}
          <br />
          {card.dataLine}
        </p>
      </div>
    </div>
  );
}
