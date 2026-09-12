import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import { normalizeSettings } from "./appStore.ts";

describe("normalizeSettings forecast keys", () => {
  test("falls back to defaults when keys are missing or the wrong type", () => {
    const settings = normalizeSettings({});
    assert.equal(settings.forecastEnabled, DEFAULT_SETTINGS.forecastEnabled);
    assert.equal(settings.forecastPrearmEnabled, DEFAULT_SETTINGS.forecastPrearmEnabled);
    assert.equal(settings.forecastNudgeRisk, DEFAULT_SETTINGS.forecastNudgeRisk);
    assert.equal(settings.forecastPrearmRisk, DEFAULT_SETTINGS.forecastPrearmRisk);
    assert.equal(settings.forecastPrearmFuseSec, DEFAULT_SETTINGS.forecastPrearmFuseSec);

    const junk = normalizeSettings({
      forecastEnabled: "yes",
      forecastPrearmEnabled: 1,
      forecastNudgeRisk: Number.NaN,
      forecastPrearmRisk: Number.POSITIVE_INFINITY,
      forecastPrearmFuseSec: "5",
    } as never);
    assert.equal(junk.forecastEnabled, DEFAULT_SETTINGS.forecastEnabled);
    assert.equal(junk.forecastPrearmEnabled, DEFAULT_SETTINGS.forecastPrearmEnabled);
    assert.equal(junk.forecastNudgeRisk, DEFAULT_SETTINGS.forecastNudgeRisk);
    assert.equal(junk.forecastPrearmRisk, DEFAULT_SETTINGS.forecastPrearmRisk);
    assert.equal(junk.forecastPrearmFuseSec, DEFAULT_SETTINGS.forecastPrearmFuseSec);
  });

  test("keeps explicit false toggles", () => {
    const settings = normalizeSettings({
      forecastEnabled: false,
      forecastPrearmEnabled: false,
    });
    assert.equal(settings.forecastEnabled, false);
    assert.equal(settings.forecastPrearmEnabled, false);
  });

  test("clamps forecastNudgeRisk to [0.05, 0.90]", () => {
    assert.equal(normalizeSettings({ forecastNudgeRisk: -1 }).forecastNudgeRisk, 0.05);
    assert.equal(normalizeSettings({ forecastNudgeRisk: 0.4 }).forecastNudgeRisk, 0.4);
    assert.equal(normalizeSettings({ forecastNudgeRisk: 2 }).forecastNudgeRisk, 0.9);
  });

  test("clamps forecastPrearmRisk to [0.10, 0.95] then raises it above nudge", () => {
    // 0 clamps to 0.10, then rises to the default nudge (0.55) + 0.05.
    assert.equal(normalizeSettings({ forecastPrearmRisk: 0 }).forecastPrearmRisk, 0.55 + 0.05);
    assert.equal(normalizeSettings({ forecastPrearmRisk: 2 }).forecastPrearmRisk, 0.95);
    // Raised to nudge + 0.05 whenever the gap collapses.
    const collapsed = normalizeSettings({ forecastNudgeRisk: 0.7, forecastPrearmRisk: 0.7 });
    assert.equal(collapsed.forecastPrearmRisk, 0.7 + 0.05);
    const inverted = normalizeSettings({ forecastNudgeRisk: 0.9, forecastPrearmRisk: 0.1 });
    assert.equal(inverted.forecastPrearmRisk, 0.9 + 0.05);
    // A healthy gap is left alone.
    const healthy = normalizeSettings({ forecastNudgeRisk: 0.3, forecastPrearmRisk: 0.8 });
    assert.equal(healthy.forecastPrearmRisk, 0.8);
  });

  test("rounds and clamps forecastPrearmFuseSec to [3, 600]", () => {
    assert.equal(normalizeSettings({ forecastPrearmFuseSec: 0 }).forecastPrearmFuseSec, 3);
    assert.equal(normalizeSettings({ forecastPrearmFuseSec: 4.6 }).forecastPrearmFuseSec, 5);
    assert.equal(normalizeSettings({ forecastPrearmFuseSec: 9999 }).forecastPrearmFuseSec, 600);
  });
});
