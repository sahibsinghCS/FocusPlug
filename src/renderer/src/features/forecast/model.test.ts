import { describe, expect, it } from "vitest";
import { FORECAST_FEATURE_KEYS } from "@shared/forecast";
import type { ForecastEvent, ForecastSnapshot } from "@shared/ipc";
import {
  bandLabel,
  bandTone,
  calibrationLine,
  describeForecastEvent,
  featureBars,
  forecastSensorCard,
  formatAttribution,
  formatLeadSec,
  hiddenCells,
  meterView,
  modelCard,
  overlayLeadSec,
  prearmPlate,
  rankAttributions,
  receiptLine,
  riskAngle,
  riskPercent,
  sparklineView,
  topPositiveKeys,
  whyNowRows,
} from "./model";
import { featurePhrase, nudgeToastBody } from "./copy";
import {
  buildTimelinePreview,
  classifySessionEvent,
  isEnforcementEvent,
} from "../session/model";
import {
  REPLAY_BEATS,
  REPLAY_DURATION_SEC,
  buildForecastReplay,
  replayEvents,
  replayHistory,
} from "./replay";

function makeSnapshot(overrides: Partial<ForecastSnapshot> = {}): ForecastSnapshot {
  return {
    ts: 1_000_000,
    ready: true,
    warmupRemainingSec: 0,
    risk: 0.34,
    rawRisk: 0.36,
    logit: -0.48,
    band: "calm",
    horizonSec: 30,
    features: FORECAST_FEATURE_KEYS.map((key, index) => ({
      key,
      raw: index,
      value: index / 18,
      attribution: 0,
    })),
    hidden: new Array<number>(12).fill(0.2),
    prearmedAt: null,
    effectiveFuseSec: 10,
    baseFuseSec: 10,
    modelVersion: "ff-1",
    paramCount: 241,
    ...overrides,
  };
}

const replay = buildForecastReplay();
const allEvents = replayEvents(replay, replay.frames.length - 1);

describe("band mapping", () => {
  it("maps calm/elevated/prearm to ok/warn/danger tones", () => {
    expect(bandTone("calm")).toBe("lime");
    expect(bandTone("elevated")).toBe("amber");
    expect(bandTone("prearm")).toBe("red");
    expect(bandLabel("prearm")).toBe("Pre-armed");
  });

  it("formats risk percentages clamped to [0, 1]", () => {
    expect(riskPercent(0.34)).toBe("34%");
    expect(riskPercent(-2)).toBe("0%");
    expect(riskPercent(3)).toBe("100%");
  });
});

describe("forecast sensor card", () => {
  it("renders the off card when the feature is disabled", () => {
    const card = forecastSensorCard(null, { enabled: false, sessionActive: true });
    expect(card.id).toBe("forecast");
    expect(card.title).toBe("Off");
    expect(card.tone).toBe("mute");
    expect(card.meta).toContain("241-param");
  });

  it("renders standby outside a session and warm-up before ready", () => {
    const standby = forecastSensorCard(null, { enabled: true, sessionActive: false });
    expect(standby.title).toBe("Standby");
    const warming = forecastSensorCard(
      makeSnapshot({ ready: false, warmupRemainingSec: 7 }),
      { enabled: true, sessionActive: true },
    );
    expect(warming.title).toBe("Warming up");
    expect(warming.body).toContain("8/15 s");
  });

  it("renders live risk with the top driver sentence and band tone", () => {
    const snap = makeSnapshot({ band: "elevated", risk: 0.62 });
    snap.features[0] = { key: "switch15", raw: 6, value: 0.75, attribution: 0.21 };
    const card = forecastSensorCard(snap, { enabled: true, sessionActive: true });
    expect(card.title).toBe("risk 62%");
    expect(card.tone).toBe("amber");
    expect(card.body).toContain("Fast window switching (6 in 15 s)");
  });
});

describe("attribution ranking + copy", () => {
  it("ranks by |attribution| and picks positive keys for the toast", () => {
    const snap = makeSnapshot();
    snap.features[0] = { key: "switch15", raw: 6, value: 0.75, attribution: 0.2 };
    snap.features[10] = { key: "deskPresent30", raw: 0.96, value: 0.96, attribution: -0.3 };
    snap.features[16] = { key: "titleChurn30", raw: 9, value: 0.75, attribution: 0.1 };
    const ranked = rankAttributions(snap.features, 2);
    expect(ranked.map((f) => f.key)).toEqual(["deskPresent30", "switch15"]);
    expect(topPositiveKeys(snap.features, 3)).toEqual(["switch15", "titleChurn30"]);
    const rows = whyNowRows(snap.features, {}, 3);
    expect(rows[0]?.arrow).toBe("▼");
    expect(rows[0]?.phrase).toContain("Solid desk presence (96%)");
    expect(rows[1]?.arrow).toBe("▲");
  });

  it("formats attributions honestly at every scale", () => {
    expect(formatAttribution(0.21)).toBe("+0.21");
    expect(formatAttribution(-0.0042)).toBe("−0.004");
    expect(formatAttribution(0.0001)).toBe("0");
    const quiet = whyNowRows(
      FORECAST_FEATURE_KEYS.map((key) => ({ key, raw: 0, value: 0, attribution: 0 })),
      {},
      2,
    );
    expect(quiet[0]?.arrow).toBe("·");
    expect(quiet[0]?.negligible).toBe(true);
  });

  it("phrases every feature key without leaking tensor names", () => {
    for (const key of FORECAST_FEATURE_KEYS) {
      const phrase = featurePhrase(key, 3, { greyApp: "Spotify" });
      expect(phrase.length).toBeGreaterThan(4);
      expect(phrase).not.toContain("undefined");
    }
    expect(featurePhrase("otherDwell30", 18, { greyApp: "Spotify" })).toBe(
      "Loitering on Spotify (18 s of 30)",
    );
    expect(nudgeToastBody("Fast window switching (6 in 15 s)")).toContain(
      "pre-tab-out pattern. Fast window switching",
    );
  });

  it("builds all 18 feature bars in key order with normalized magnitudes", () => {
    const snap = makeSnapshot();
    snap.features[3] = { key: "dwellCur", raw: 11, value: 0.4, attribution: 0.5 };
    const bars = featureBars(snap.features);
    expect(bars).toHaveLength(18);
    expect(bars.map((bar) => bar.key)).toEqual([...FORECAST_FEATURE_KEYS]);
    expect(bars[3]?.magnitude).toBe(1);
    expect(bars[3]?.positive).toBe(true);
  });
});

describe("calibration + model card", () => {
  it("prints the logit → Platt → risk line with the shipped (a, b)", () => {
    const line = calibrationLine(makeSnapshot({ logit: 0.48, rawRisk: 0.62 }));
    expect(line).toMatch(/^logit \+0\.48 → σ\(a·z\+b\) a=-?\d+\.\d{2} b=[+−]\d+\.\d{2} → risk 0\.62$/);
  });

  it("feeds the model card from the committed artifacts", () => {
    const card = modelCard();
    expect(card.spec).toContain("TinyMLP 18→12→1");
    expect(card.spec).toContain("241 params");
    expect(card.spec).toContain("v ff-1");
    expect(card.evalLine).toMatch(/held-out AUC 0\.\d{2}/);
    expect(card.dataLine).toContain("Adaption:");
  });
});

describe("receipts", () => {
  const hit: ForecastEvent = { type: "forecast_hit", ts: 3_000, leadSec: 17.96 };
  const miss: ForecastEvent = { type: "forecast_miss", ts: 2_000 };
  const stood: ForecastEvent = { type: "forecast_clear", ts: 4_000, risk: 0.3, wasPrearmed: true };
  const plainClear: ForecastEvent = {
    type: "forecast_clear",
    ts: 9_000,
    risk: 0.3,
    wasPrearmed: false,
  };

  it("renders the newest of hit / miss / stood-down, ignoring plain clears", () => {
    expect(receiptLine([])).toBeNull();
    expect(receiptLine([miss, hit])?.text).toBe("called it 18 s early");
    expect(receiptLine([hit, miss, stood, plainClear])?.text).toBe(
      "pre-arm stood down · unconfirmed",
    );
    expect(receiptLine([miss])?.tone).toBe("red");
  });

  it("formats lead seconds to at most one decimal", () => {
    expect(formatLeadSec(12)).toBe("12");
    expect(formatLeadSec(17.96)).toBe("18");
    expect(formatLeadSec(9.44)).toBe("9.4");
  });

  it("finds the overlay lead only for a fresh hit", () => {
    expect(overlayLeadSec([hit], 10_000)).toBe(17.96);
    expect(overlayLeadSec([hit], 3_000 + 121_000)).toBeNull();
    expect(overlayLeadSec([miss], 10_000)).toBeNull();
  });
});

describe("meter + sparkline geometry", () => {
  it("maps risk to a −90…+90 needle and ghosts the warm-up", () => {
    expect(riskAngle(0)).toBe(-90);
    expect(riskAngle(0.5)).toBe(0);
    expect(riskAngle(1)).toBe(90);
    const warm = meterView(makeSnapshot({ ready: false, warmupRemainingSec: 7 }), {
      nudgeRisk: 0.55,
      prearmRisk: 0.8,
    });
    expect(warm.ready).toBe(false);
    expect(warm.warmupLabel).toBe("warming up · 8/15 s");
    expect(warm.percentLabel).toBe("—");
    const live = meterView(makeSnapshot({ risk: 0.62, band: "elevated" }), {
      nudgeRisk: 0.55,
      prearmRisk: 0.8,
    });
    expect(live.percentLabel).toBe("62%");
    expect(live.ticks.map((tick) => tick.label)).toEqual(["nudge", "pre-arm"]);
  });

  it("plots history in the window and marks nudge/prearm/drift events", () => {
    const nowTs = 100_000;
    const history = [
      { ts: nowTs - 60_000, risk: 0 },
      { ts: nowTs - 30_000, risk: 0.5 },
      { ts: nowTs, risk: 1 },
    ];
    const events: ForecastEvent[] = [
      { type: "forecast_nudge", ts: nowTs - 30_000, risk: 0.5, topFeatures: [] },
      { type: "forecast_prearm", ts: nowTs - 10_000, risk: 0.9, fuseSec: 5 },
      { type: "forecast_hit", ts: nowTs, leadSec: 10 },
      { type: "forecast_miss", ts: nowTs - 90_000 },
    ];
    const spark = sparklineView(history, events, {
      nowTs,
      width: 220,
      height: 44,
      nudgeRisk: 0.55,
      prearmRisk: 0.8,
    });
    expect(spark.empty).toBe(false);
    expect(spark.path.startsWith("M0.0 44.0")).toBe(true);
    expect(spark.path.endsWith("L220.0 0.0")).toBe(true);
    expect(spark.markers.map((marker) => marker.kind)).toEqual(["nudge", "prearm", "drift"]);
    expect(spark.markers[0]?.x).toBeCloseTo(110, 1);
    expect(spark.nudgeY).toBeCloseTo(44 * 0.45, 3);
  });
});

describe("pre-arm plate + event copy", () => {
  it("shows the fuse chip only while pre-armed and ready", () => {
    expect(prearmPlate(null)).toBeNull();
    expect(prearmPlate(makeSnapshot())).toBeNull();
    expect(
      prearmPlate(makeSnapshot({ ready: false, prearmedAt: 5 })),
    ).toBeNull();
    const plate = prearmPlate(
      makeSnapshot({ prearmedAt: 5, effectiveFuseSec: 5, baseFuseSec: 10, band: "prearm" }),
    );
    expect(plate?.chip).toBe("10s → 5s");
    expect(plate?.label).toBe("pre-armed · forecast");
  });

  it("describes forecast events the way the monitor logs them", () => {
    expect(
      describeForecastEvent({
        type: "forecast_nudge",
        ts: 0,
        risk: 0.62,
        topFeatures: ["switch15", "titleChurn30"],
      }),
    ).toBe("nudge · risk 62% · switch15, titleChurn30");
    expect(
      describeForecastEvent({ type: "forecast_prearm", ts: 0, risk: 0.83, fuseSec: 5 }),
    ).toBe("pre-arm · risk 83% · fuse 5s");
    expect(
      describeForecastEvent({ type: "forecast_clear", ts: 0, risk: 0.3, wasPrearmed: true }),
    ).toBe("pre-arm stood down · unconfirmed · risk 30%");
    expect(describeForecastEvent({ type: "forecast_hit", ts: 0, leadSec: 12 })).toBe(
      "hit · called 12s early",
    );
    expect(describeForecastEvent({ type: "forecast_miss", ts: 0 })).toBe("miss — no warning");
  });

  it("threads forecast log rows into the timeline as cause entries", () => {
    const event = { ts: 1_000, kind: "forecast", detail: "pre-arm · risk 83% · fuse 5s" };
    expect(classifySessionEvent(event)).toBe("cause");
    expect(isEnforcementEvent(event)).toBe(true);
    const preview = buildTimelinePreview([event]);
    expect(preview.events[0]?.stage).toBe("cause");
    expect(preview.reached.cause).toBe(true);
  });

  it("tints hidden cells by |tanh| with sign", () => {
    const cells = hiddenCells([0.8, -0.4, 0]);
    expect(cells[0]).toEqual({ value: 0.8, intensity: 0.8, positive: true });
    expect(cells[1]?.positive).toBe(false);
  });
});

describe("scripted replay (real shared core)", () => {
  it("is deterministic frame-for-frame", () => {
    const again = buildForecastReplay();
    expect(again.frames).toHaveLength(replay.frames.length);
    expect(JSON.stringify(again.frames[44])).toBe(JSON.stringify(replay.frames[44]));
    expect(JSON.stringify(again.frames[112])).toBe(JSON.stringify(replay.frames[112]));
    expect(JSON.stringify(replayEvents(again, again.frames.length - 1))).toBe(
      JSON.stringify(allEvents),
    );
  });

  it("warms up for exactly 15 s and always ships 18 features", () => {
    expect(replay.frames).toHaveLength(REPLAY_DURATION_SEC);
    for (const frame of replay.frames) {
      expect(frame.snapshot.ready).toBe(frame.t >= 15);
      expect(frame.snapshot.features.map((feature) => feature.key)).toEqual([
        ...FORECAST_FEATURE_KEYS,
      ]);
      expect(frame.snapshot.hidden).toHaveLength(12);
      expect(frame.snapshot.risk).toBeGreaterThanOrEqual(0);
      expect(frame.snapshot.risk).toBeLessThanOrEqual(1);
      expect(frame.events.length === 0 || frame.snapshot.ready).toBe(true);
    }
  });

  it("plays the demo beat: nudge → clear → pre-arm → hit with real lead", () => {
    const types = allEvents.map((event) => event.type);
    expect(types).toContain("forecast_nudge");
    expect(types).toContain("forecast_prearm");
    expect(types).toContain("forecast_hit");
    const prearmIndex = types.indexOf("forecast_prearm");
    const hitIndex = types.indexOf("forecast_hit");
    expect(prearmIndex).toBeGreaterThanOrEqual(0);
    expect(prearmIndex).toBeLessThan(hitIndex);
    const hit = allEvents[hitIndex];
    if (hit?.type !== "forecast_hit") {
      throw new Error("expected a forecast_hit");
    }
    expect(hit.leadSec).toBeGreaterThanOrEqual(5);
    expect(hit.leadSec).toBeLessThanOrEqual(60);
    // A stood-down pre-arm after the kill — false alarms stay visible.
    expect(
      allEvents.some((event) => event.type === "forecast_clear" && event.wasPrearmed),
    ).toBe(true);
  });

  it("pre-arms the real fuse: countdown starts at 5 s and stays latched", () => {
    const burnFrames = replay.frames.filter((frame) => frame.countdownSec > 0);
    expect(burnFrames.length).toBeGreaterThan(0);
    expect(burnFrames[0]?.countdownSec).toBe(5);
    for (const frame of burnFrames) {
      expect(frame.snapshot.effectiveFuseSec).toBe(5);
      expect(frame.decision).toBe("DISTRACTED");
    }
    // Fuse counts down monotonically to the kill.
    const seconds = burnFrames.map((frame) => frame.countdownSec);
    expect(seconds).toEqual([...seconds].sort((a, b) => b - a));
    // After the unlock the fuse returns to the base 10 s.
    const last = replay.frames[replay.frames.length - 1];
    expect(last?.snapshot.effectiveFuseSec).toBe(10);
    expect(last?.snapshot.band).toBe("calm");
  });

  it("keeps history/event slices consistent with the frame index", () => {
    const index = REPLAY_BEATS.drift + 2;
    const history = replayHistory(replay, index);
    expect(history).toHaveLength(index + 1);
    expect(history[history.length - 1]?.ts).toBe(replay.frames[index]?.snapshot.ts);
    const events = replayEvents(replay, index);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThanOrEqual(allEvents.length);
  });
});
