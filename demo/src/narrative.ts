import { FORECAST_WARMUP_SEC } from "@shared/forecast";
import type { ForecastEvent } from "@shared/ipc";
import type { Tone } from "@renderer/lib/format";
import { riskPercent } from "@renderer/features/forecast/model";
import type { DemoFrame } from "./pipeline";

/**
 * "What you are looking at, right now" — one line, derived from the frame the
 * model produced rather than from the clock, so it stays correct when the
 * judge scrubs, pauses, or runs the live webcam mode instead.
 */

export interface StageNote {
  kicker: string;
  line: string;
  tone: Tone;
}

function prearmed(frame: DemoFrame): boolean {
  return frame.snapshot.ready && frame.snapshot.prearmedAt !== null;
}

export function stageNote(
  frame: DemoFrame,
  events: readonly ForecastEvent[],
): StageNote {
  if (!frame.snapshot.ready) {
    const seen = FORECAST_WARMUP_SEC - frame.snapshot.warmupRemainingSec;
    return {
      kicker: "Warm-up",
      tone: "mute",
      line: `The telemetry ring is empty at session start, so the model stays quiet for its first ${FORECAST_WARMUP_SEC} s (${seen}/${FORECAST_WARMUP_SEC}). Decision is already live — enforcement never waits on the forecast.`,
    };
  }

  if (frame.countdownSec > 0) {
    return {
      kicker: "Fuse burning",
      tone: "red",
      line: prearmed(frame)
        ? `The policy engine started a ${frame.fuseTotalSec} s countdown — half the armed fuse, because the forecast pre-armed it before Discord was ever in focus. A burning fuse never changes length again.`
        : `The policy engine started the full ${frame.fuseTotalSec} s countdown. Only a real classified violation can do this; the forecast cannot start one.`,
    };
  }

  const hit = [...events]
    .reverse()
    .find((event) => event.type === "forecast_hit" || event.type === "forecast_miss");
  if (frame.killed && frame.decision !== "ON_TASK") {
    return {
      kicker: "Consequence",
      tone: "red",
      line:
        hit?.type === "forecast_hit"
          ? `Kill signal sent for the blocked app, with the receipt attached: the forecast called it ${Math.round(hit.leadSec)} s early. Misses print just as loudly.`
          : "Kill signal sent for the blocked app. The forecast had no warning out — that prints as a miss.",
    };
  }
  if (frame.killed && frame.decision === "ON_TASK") {
    return {
      kicker: "Recovery",
      tone: "lime",
      line: "Allowlisted window plus desk presence — the session unlocked itself. No dialog, no override, no streak to rebuild.",
    };
  }

  if (frame.snapshot.band === "prearm") {
    return {
      kicker: "Pre-armed",
      tone: "red",
      line: `Risk ${riskPercent(frame.snapshot.risk)} held above the pre-arm threshold. The one thing the forecast is allowed to touch just moved: the fuse is ${frame.snapshot.baseFuseSec} s → ${frame.snapshot.effectiveFuseSec} s. Nothing has been killed and nothing has been classified as a violation.`,
    };
  }
  if (frame.snapshot.band === "elevated") {
    return {
      kicker: "Elevated",
      tone: "amber",
      line: `Risk ${riskPercent(frame.snapshot.risk)}. The nudge is the zero-enforcement intervention — read the attribution bars to see which signals bought it.`,
    };
  }
  if (frame.snapshot.risk >= 0.2) {
    return {
      kicker: "Risk rising",
      tone: "amber",
      line: "Tab flicking and grey-app loiter are pushing the bars red. Discord has not happened — this is the pattern that precedes it.",
    };
  }
  return {
    kicker: "On task",
    tone: "lime",
    line: "Steady dwell on the assignment, desk presence solid. The blue bars are the signals actively holding risk down.",
  };
}

/** Log-style label for one forecast event, matching the console's timeline. */
export function eventTone(event: ForecastEvent): Tone {
  if (event.type === "forecast_hit") return "lime";
  if (event.type === "forecast_miss" || event.type === "forecast_prearm") return "red";
  if (event.type === "forecast_nudge") return "amber";
  return "mute";
}
