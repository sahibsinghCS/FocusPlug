import { describe, expect, it } from "vitest";
import { FORECAST_WARMUP_SEC, PREARM_FUSE_FLOOR_SEC } from "@shared/forecast";
import { DEMO_SETTINGS } from "./pipeline";
import { DEMO_DURATION_SEC } from "./script";
import { buildDemoTimeline } from "./timeline";

/**
 * The demo's own contract. Everything asserted here is produced by the shipped
 * modules — the scripted behaviour stream is the only input — so if the model,
 * the escalation reducer or the policy engine changes its mind, this fails
 * instead of the judge discovering it live.
 */

const timeline = buildDemoTimeline();
const { frames } = timeline;

function firstForecast(type: string): number {
  return frames.findIndex((frame) =>
    frame.forecastEvents.some((event) => event.type === type),
  );
}

function firstPolicy(type: string): number {
  return frames.findIndex((frame) =>
    frame.policyEvents.some((event) => event.type === type),
  );
}

describe("scripted demo timeline", () => {
  it("fits inside the 90 s a judge will actually give it", () => {
    expect(DEMO_DURATION_SEC).toBeLessThanOrEqual(90);
    expect(frames).toHaveLength(DEMO_DURATION_SEC);
    expect(frames[frames.length - 1]?.t).toBe(DEMO_DURATION_SEC);
  });

  it("stays silent through the warm-up and then reads every second", () => {
    for (const frame of frames.slice(0, FORECAST_WARMUP_SEC - 1)) {
      expect(frame.snapshot.ready).toBe(false);
      expect(frame.forecastEvents).toHaveLength(0);
    }
    expect(frames[FORECAST_WARMUP_SEC - 1]?.snapshot.ready).toBe(true);
    for (const frame of frames) {
      expect(Number.isFinite(frame.snapshot.risk)).toBe(true);
      expect(frame.snapshot.risk).toBeGreaterThanOrEqual(0);
      expect(frame.snapshot.risk).toBeLessThanOrEqual(1);
    }
  });

  it("runs the arc in order: nudge, comply, pre-arm, drift, kill, unlock", () => {
    const nudge = firstForecast("forecast_nudge");
    const clear = firstForecast("forecast_clear");
    const prearm = firstForecast("forecast_prearm");
    const hit = firstForecast("forecast_hit");
    const countdown = firstPolicy("start_countdown");
    const kill = firstPolicy("kill");
    const unlock = firstPolicy("unlock");

    expect(nudge).toBeGreaterThan(0);
    expect(clear).toBeGreaterThan(nudge);
    expect(prearm).toBeGreaterThan(clear);
    expect(countdown).toBeGreaterThan(prearm);
    expect(hit).toBe(countdown);
    expect(kill).toBeGreaterThan(countdown);
    expect(unlock).toBeGreaterThan(kill);
    expect(frames[frames.length - 1]?.decision).toBe("ON_TASK");
  });

  it("nudges and pre-arms while nothing is yet a violation", () => {
    const countdown = firstPolicy("start_countdown");
    for (const frame of frames.slice(0, countdown)) {
      expect(frame.focus.matchedBlock).toBe(false);
      expect(frame.decision === "DISTRACTED" || frame.decision === "AWAY").toBe(false);
    }
    // …and the one frame that does start a fuse is a real blocked focus.
    expect(frames[countdown]?.focus.matchedBlock).toBe(true);
    expect(frames[countdown]?.decision).toBe("DISTRACTED");
  });

  it("really shortens the fuse: the countdown starts at 5 s, not 10 s", () => {
    const countdown = frames.find((frame) =>
      frame.policyEvents.some((event) => event.type === "start_countdown"),
    );
    const started = countdown?.policyEvents.find(
      (event) => event.type === "start_countdown",
    );
    expect(started?.type).toBe("start_countdown");
    if (started?.type !== "start_countdown") {
      throw new Error("no start_countdown");
    }
    expect(DEMO_SETTINGS.countdownSec).toBe(10);
    expect(started.seconds).toBe(DEMO_SETTINGS.forecastPrearmFuseSec);
    expect(started.seconds).toBeGreaterThanOrEqual(PREARM_FUSE_FLOOR_SEC);
    expect(started.seconds).toBeLessThan(DEMO_SETTINGS.countdownSec);

    // The kill lands exactly one shortened fuse later.
    const killIndex = firstPolicy("kill");
    const startIndex = firstPolicy("start_countdown");
    expect(killIndex - startIndex).toBe(started.seconds);
  });

  it("prints a receipt with real lead time", () => {
    const hit = frames
      .flatMap((frame) => frame.forecastEvents)
      .find((event) => event.type === "forecast_hit");
    expect(hit?.type).toBe("forecast_hit");
    if (hit?.type !== "forecast_hit") {
      throw new Error("no forecast_hit");
    }
    expect(hit.leadSec).toBeGreaterThan(5);
    expect(hit.leadSec).toBeLessThan(DEMO_DURATION_SEC);
    expect(frames.flatMap((frame) => frame.forecastEvents).filter(
      (event) => event.type === "forecast_miss",
    )).toHaveLength(0);
  });

  it("kills exactly once, and only after a countdown", () => {
    const kills = frames.flatMap((frame) =>
      frame.policyEvents.filter((event) => event.type === "kill"),
    );
    expect(kills).toHaveLength(1);
    const countdowns = frames.flatMap((frame) =>
      frame.policyEvents.filter((event) => event.type === "start_countdown"),
    );
    expect(countdowns).toHaveLength(1);
  });

  it("is deterministic — same epoch, same numbers", () => {
    const again = buildDemoTimeline(timeline.startTs);
    expect(again.frames.map((frame) => frame.snapshot.risk)).toEqual(
      frames.map((frame) => frame.snapshot.risk),
    );
    expect(again.marks).toEqual(timeline.marks);
  });

  it("anchors its chapter marks on frames that exist", () => {
    expect(timeline.marks.length).toBeGreaterThanOrEqual(7);
    for (const mark of timeline.marks) {
      expect(mark.t).toBeGreaterThanOrEqual(1);
      expect(mark.t).toBeLessThanOrEqual(DEMO_DURATION_SEC);
      expect(mark.hint.length).toBeGreaterThan(10);
    }
    const ids = timeline.marks.map((mark) => mark.id);
    expect(ids).toContain("nudge");
    expect(ids).toContain("prearm");
    expect(ids).toContain("kill");
  });
});
