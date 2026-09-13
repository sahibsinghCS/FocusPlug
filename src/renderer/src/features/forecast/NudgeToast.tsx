import { useEffect, useState, type JSX } from "react";
import type { ForecastSnapshot } from "@shared/ipc";
import type { ForecastFeatureKey } from "@shared/forecast/types";
import { featurePhrase, nudgeToastBody } from "./copy";
import { riskPercent } from "./model";
import "./forecast.css";

const TOAST_LIFETIME_MS = 8_000;

export interface NudgeToastEvent {
  ts: number;
  risk: number;
  topFeatures: ForecastFeatureKey[];
}

/**
 * The nudge — the zero-enforcement intervention. Auto-dismisses after 8 s and
 * sits BELOW the KillOverlay (z-40 vs z-50): the kill overlay is never
 * obstructed by a suggestion.
 */
export function NudgeToast(props: {
  event: NudgeToastEvent | null;
  snapshot: ForecastSnapshot | null;
  greyApp?: string;
  /** Replay/scrub mode: the caller decides visibility, no wall-clock expiry. */
  frozen?: boolean;
}): JSX.Element | null {
  const { event, frozen } = props;
  const [dismissedTs, setDismissedTs] = useState<number | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!event || frozen) {
      return;
    }
    setExpired(false);
    const remaining = Math.max(500, TOAST_LIFETIME_MS - (Date.now() - event.ts));
    const timer = setTimeout(() => {
      setExpired(true);
    }, remaining);
    return () => clearTimeout(timer);
  }, [event, frozen]);

  if (!event || (expired && !frozen) || dismissedTs === event.ts) {
    return null;
  }

  const topKey = event.topFeatures[0];
  const raw = topKey
    ? props.snapshot?.features.find((feature) => feature.key === topKey)?.raw
    : undefined;
  const phrase =
    topKey !== undefined && raw !== undefined
      ? featurePhrase(topKey, raw, { greyApp: props.greyApp })
      : null;

  return (
    <div
      className="fp-forecast-toast fixed bottom-5 right-5 z-40 w-[min(360px,calc(100vw-40px))] rounded-lg border border-fp-amber/40 bg-fp-elev/95 px-4 py-3 shadow-fp-pop backdrop-blur"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-fp-amber shadow-[0_0_8px_rgba(255,176,32,0.85)]" />
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-fp-amber">
          Focus Forecast · nudge
        </p>
        <p className="ml-auto font-mono text-[11px] text-fp-amber tabular">
          risk {riskPercent(event.risk)}
        </p>
        <button
          type="button"
          onClick={() => setDismissedTs(event.ts)}
          aria-label="Dismiss nudge"
          className="fp-btn -mr-1 inline-flex h-5 w-5 items-center justify-center rounded text-fp-faint hover:bg-fp-hover hover:text-fp-ink"
        >
          ×
        </button>
      </div>
      <p className="mt-1.5 text-[13px] leading-5 text-fp-ink">{nudgeToastBody(phrase)}</p>
      <p className="mt-1 text-[11px] text-fp-mute">
        Stay on the assignment and the needle falls. No enforcement yet.
      </p>
    </div>
  );
}
