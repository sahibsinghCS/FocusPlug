import type { ForecastFeatureKey } from "@shared/forecast/types";

/**
 * Key→phrase map for the model internals. The attribution bars must read as
 * plain language ("Fast window switching (6 in 15 s)"), not tensor indices —
 * this file is the only place feature keys become English. Copy may use the
 * live in-memory process name; nothing hashed is ever shown on screen.
 */

export interface FeatureCopyCtx {
  /** Foreground process to name in grey-app phrases (live, unhashed). */
  greyApp?: string;
}

/** Short technical labels for the full 18-bar grid (fit a 112px lane). */
export const FEATURE_SHORT_LABELS: Record<ForecastFeatureKey, string> = {
  switch15: "switches 15s",
  switch60: "switches 60s",
  switchAccel: "switch accel",
  dwellCur: "current dwell",
  fracAllow60: "allow share 60s",
  fracOther60: "grey share 60s",
  otherDwell30: "grey dwell 30s",
  distinct60: "distinct apps",
  sinceBlock: "since block",
  streak: "on-task streak",
  deskPresent30: "desk presence",
  deskConfMean30: "desk confidence",
  deskConfStd30: "conf wobble",
  deskFlicker60: "desk flicker",
  sessionMin: "minutes in",
  priorDrifts: "prior drifts",
  titleChurn30: "tab flips 30s",
  titleChurn60: "tab flips 60s",
};

function pct(x: number): string {
  return `${Math.round(Math.min(1, Math.max(0, x)) * 100)}%`;
}

function secs(x: number): string {
  const s = Math.max(0, Math.round(x));
  if (s >= 90) {
    return `${Math.round(s / 60)} min`;
  }
  return `${s} s`;
}

/**
 * Plain-language phrase for one feature at its current raw (human-unit)
 * value. The sign/arrow is rendered separately by the caller — the phrase
 * only names what the sensor saw.
 */
export function featurePhrase(
  key: ForecastFeatureKey,
  raw: number,
  ctx: FeatureCopyCtx = {},
): string {
  const grey = ctx.greyApp && ctx.greyApp.trim().length > 0 ? ctx.greyApp.trim() : null;
  switch (key) {
    case "switch15":
      if (raw >= 4) return `Fast window switching (${Math.round(raw)} in 15 s)`;
      if (raw >= 1) return `Window switching (${Math.round(raw)} in 15 s)`;
      return "No window switching (15 s)";
    case "switch60":
      if (raw >= 10) return `Heavy switching (${Math.round(raw)} in 60 s)`;
      return `Window switches (${Math.round(raw)} in 60 s)`;
    case "switchAccel":
      return raw >= 1.5
        ? `Switching speeding up (×${raw.toFixed(1)})`
        : `Switching steady (×${raw.toFixed(1)})`;
    case "dwellCur":
      return raw >= 120
        ? `Settled on current window (${secs(raw)})`
        : `Only ${secs(raw)} on current window`;
    case "fracAllow60":
      return raw >= 0.7
        ? `Mostly allowlisted focus (${pct(raw)})`
        : `Allowlisted focus slipping (${pct(raw)})`;
    case "fracOther60":
      return `Grey-app time (${pct(raw)} of last 60 s)`;
    case "otherDwell30":
      return grey
        ? `Loitering on ${grey} (${secs(raw)} of 30)`
        : `Loitering off-list (${secs(raw)} of 30)`;
    case "distinct60":
      return `${Math.round(raw)} distinct apps in 60 s`;
    case "sinceBlock":
      return raw >= 600
        ? "No blocked app seen"
        : `Blocked app ${secs(raw)} ago`;
    case "streak":
      return `On-task streak (${secs(raw)})`;
    case "deskPresent30":
      if (raw >= 0.9) return `Solid desk presence (${pct(raw)})`;
      if (raw >= 0.5) return `Patchy desk presence (${pct(raw)})`;
      return `Desk mostly empty (${pct(raw)})`;
    case "deskConfMean30":
      return `Desk confidence ${pct(raw)}`;
    case "deskConfStd30":
      return raw >= 0.08
        ? "Fidgety presence signal"
        : "Steady presence signal";
    case "deskFlicker60":
      return raw >= 1
        ? `Presence flickering (${Math.round(raw)} in 60 s)`
        : "No presence flicker";
    case "sessionMin":
      return `${Math.round(raw)} min into session`;
    case "priorDrifts":
      return raw >= 1
        ? `${Math.round(raw)} drift${Math.round(raw) === 1 ? "" : "s"} already this session`
        : "No drifts yet this session";
    case "titleChurn30":
      return raw >= 1
        ? `Tab flicking (${Math.round(raw)} flips in 30 s)`
        : "No tab flicking (30 s)";
    case "titleChurn60":
      return raw >= 1
        ? `Tab flicking (${Math.round(raw)} flips in 60 s)`
        : "No tab flicking (60 s)";
    default: {
      const _exhaustive: never = key;
      void _exhaustive;
      return String(key);
    }
  }
}

/** One-line toast body: headline pattern claim + the strongest live driver. */
export function nudgeToastBody(
  topPhrase: string | null,
): string {
  const driver = topPhrase ? ` ${topPhrase}.` : "";
  return `Heads up — this matches your pre-tab-out pattern.${driver}`;
}
