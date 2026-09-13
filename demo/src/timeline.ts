import type { ForecastEvent } from "@shared/ipc";
import { DemoPipeline, type DemoFrame } from "./pipeline";
import {
  DEMO_DURATION_SEC,
  DEMO_EPOCH,
  scriptDesk,
  scriptFocus,
} from "./script";

/**
 * Mode 1, precomputed. The whole arc is built once at mount by running the
 * scripted behavior stream through `DemoPipeline` — so scrubbing, pausing and
 * 2x playback are pure indexing into an array the model already produced.
 * Nothing is recomputed per animation frame, and every position on the scrub
 * bar shows exactly what the model said at that second.
 */

export interface DemoTimeline {
  frames: DemoFrame[];
  durationSec: number;
  startTs: number;
  /** Chapter markers, anchored on real emitted events where possible. */
  marks: TimelineMark[];
}

export interface TimelineMark {
  id: string;
  label: string;
  /** Seconds since session start (1-based, matches `DemoFrame.t`). */
  t: number;
  hint: string;
}

export function buildDemoTimeline(startTs: number = DEMO_EPOCH): DemoTimeline {
  const pipeline = new DemoPipeline();
  pipeline.reset(startTs);
  const frames: DemoFrame[] = [];
  for (let t = 0; t < DEMO_DURATION_SEC; t += 1) {
    const ts = startTs + (t + 1) * 1000;
    frames.push(
      pipeline.step({
        ts,
        focus: scriptFocus(t, startTs),
        desk: scriptDesk(t, ts),
      }),
    );
  }
  return {
    frames,
    durationSec: DEMO_DURATION_SEC,
    startTs,
    marks: buildMarks(frames),
  };
}

function firstT(
  frames: readonly DemoFrame[],
  match: (event: ForecastEvent) => boolean,
): number | null {
  for (const frame of frames) {
    if (frame.forecastEvents.some(match)) {
      return frame.t;
    }
  }
  return null;
}

function firstPolicyT(
  frames: readonly DemoFrame[],
  type: "start_countdown" | "kill" | "unlock",
): number | null {
  for (const frame of frames) {
    if (frame.policyEvents.some((event) => event.type === type)) {
      return frame.t;
    }
  }
  return null;
}

/**
 * Chapter marks read off the frames the model actually produced — if a beat
 * moves because the model changed its mind, the chip moves with it instead of
 * pointing at a second where nothing happens.
 */
function buildMarks(frames: readonly DemoFrame[]): TimelineMark[] {
  const nudge = firstT(frames, (event) => event.type === "forecast_nudge");
  const prearm = firstT(frames, (event) => event.type === "forecast_prearm");
  const receipt = firstT(
    frames,
    (event) => event.type === "forecast_hit" || event.type === "forecast_miss",
  );
  const kill = firstPolicyT(frames, "kill");
  const unlock = firstPolicyT(frames, "unlock");
  const last = frames[frames.length - 1]?.t ?? 0;

  const raw: Array<{ id: string; label: string; t: number | null; hint: string }> = [
    { id: "warmup", label: "warm-up", t: 6, hint: "Ring is empty at session start — 15 s before the model reads" },
    { id: "calm", label: "on task", t: 18, hint: "Writing in Docs. Desk presence and the on-task streak hold risk down" },
    { id: "rise", label: "risk rising", t: nudge === null ? 30 : Math.max(1, nudge - 4), hint: "Tab flicking and grey-app loiter push the attribution bars red" },
    { id: "nudge", label: "nudge", t: nudge, hint: "Sustained above the nudge threshold — a toast, zero enforcement" },
    { id: "comply", label: "complied", t: 47, hint: "Back on the assignment: risk decays with no kill, no countdown" },
    { id: "prearm", label: "pre-arm", t: prearm, hint: "Fuse shortened 10 s → 5 s before any violation exists" },
    { id: "fuse", label: "fuse", t: receipt === null ? null : receipt + 1, hint: "Discord in focus: the policy engine starts the pre-armed 5 s fuse" },
    { id: "kill", label: "kill", t: kill === null ? null : kill, hint: "Countdown elapsed — force-quit, with the lead-time receipt" },
    { id: "unlock", label: "unlocked", t: unlock === null ? null : Math.min(last, unlock + 2), hint: "Allowlisted window + at desk — the session unlocks itself" },
  ];

  return raw
    .filter((mark): mark is TimelineMark & { t: number } => mark.t !== null)
    .map((mark) => ({ ...mark, t: Math.min(mark.t, last) }));
}
