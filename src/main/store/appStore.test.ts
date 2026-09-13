import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { DEFAULT_SETTINGS } from "../../shared/defaults.ts";
import { normalizePlugs, normalizeSettings } from "./appStore.ts";

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
    // 0 clamps to 0.10, then rises to the shipped nudge default + 0.05. Read
    // the default rather than pinning it: the trainer re-derives the
    // thresholds each round, and a literal here goes stale silently.
    assert.equal(
      normalizeSettings({ forecastPrearmRisk: 0 }).forecastPrearmRisk,
      DEFAULT_SETTINGS.forecastNudgeRisk + 0.05,
    );
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

describe("normalizeSettings drift-pause keys", () => {
  test("falls back to defaults when keys are missing or the wrong type", () => {
    const settings = normalizeSettings({});
    assert.equal(settings.pauseOnAwayEnabled, DEFAULT_SETTINGS.pauseOnAwayEnabled);
    assert.equal(settings.pauseOnPhoneEnabled, DEFAULT_SETTINGS.pauseOnPhoneEnabled);
    assert.equal(settings.pauseAwayConfidence, DEFAULT_SETTINGS.pauseAwayConfidence);
    assert.equal(settings.pausePhoneConfidence, DEFAULT_SETTINGS.pausePhoneConfidence);

    const junk = normalizeSettings({
      pauseOnAwayEnabled: "yes",
      pauseOnPhoneEnabled: 1,
      pauseAwayConfidence: Number.NaN,
      pausePhoneConfidence: "0.9",
    } as never);
    assert.equal(junk.pauseOnAwayEnabled, DEFAULT_SETTINGS.pauseOnAwayEnabled);
    assert.equal(junk.pauseOnPhoneEnabled, DEFAULT_SETTINGS.pauseOnPhoneEnabled);
    assert.equal(junk.pauseAwayConfidence, DEFAULT_SETTINGS.pauseAwayConfidence);
    assert.equal(junk.pausePhoneConfidence, DEFAULT_SETTINGS.pausePhoneConfidence);
  });

  test("keeps the switches exactly as set, in both directions", () => {
    const on = normalizeSettings({ pauseOnAwayEnabled: true, pauseOnPhoneEnabled: true });
    assert.equal(on.pauseOnAwayEnabled, true);
    assert.equal(on.pauseOnPhoneEnabled, true);
    const off = normalizeSettings({ pauseOnAwayEnabled: false, pauseOnPhoneEnabled: false });
    assert.equal(off.pauseOnAwayEnabled, false);
    assert.equal(off.pauseOnPhoneEnabled, false);
  });

  test("clamps pauseAwayConfidence to [0.50, 0.95]", () => {
    assert.equal(normalizeSettings({ pauseAwayConfidence: 0 }).pauseAwayConfidence, 0.5);
    assert.equal(normalizeSettings({ pauseAwayConfidence: 0.8 }).pauseAwayConfidence, 0.8);
    assert.equal(normalizeSettings({ pauseAwayConfidence: 9 }).pauseAwayConfidence, 0.95);
  });

  test("the weaker head always needs more: phone is held above away", () => {
    // Not advice — structure. A hand-edited settings.json must not be able to
    // make a 50-69%-recall phone call stop the clock on weaker evidence than
    // the trained presence head (92.5% precision on `away`) needs.
    const collapsed = normalizeSettings({
      pauseAwayConfidence: 0.8,
      pausePhoneConfidence: 0.8,
    });
    // Same arithmetic as the clamp, so binary float does not decide the test.
    assert.equal(collapsed.pausePhoneConfidence, 0.8 + 0.05);
    const inverted = normalizeSettings({
      pauseAwayConfidence: 0.9,
      pausePhoneConfidence: 0.5,
    });
    assert.equal(inverted.pausePhoneConfidence, 0.9 + 0.05);
    assert.equal(normalizeSettings({ pausePhoneConfidence: 2 }).pausePhoneConfidence, 0.99);
    // A healthy gap is left alone.
    const healthy = normalizeSettings({
      pauseAwayConfidence: 0.7,
      pausePhoneConfidence: 0.95,
    });
    assert.equal(healthy.pausePhoneConfidence, 0.95);
  });
});

describe("normalizePlugs drops what the protect layer would refuse", () => {
  const lamp = {
    id: "lamp",
    name: "Desk lamp",
    protocol: "kasa" as const,
    address: "192.168.1.50",
    enabled: true,
    isStudyPc: false as const,
  };

  test("keeps a well-formed, controllable device", () => {
    assert.deepEqual(normalizePlugs([lamp]), [lamp]);
  });

  test("drops a hand-edited loopback plug instead of jamming every toggle", () => {
    // The write routes hard-deny these, so on-disk is the only way in. If the
    // loader kept it, the renderer's whole-array persistPlugs would throw on
    // the next enable/disable of ANY plug.
    for (const address of ["127.0.0.1", "localhost", "::1", "http://127.0.0.1/"]) {
      assert.deepEqual(normalizePlugs([{ ...lamp, address }]), []);
    }
    // A study-PC-named device is refused the same way.
    assert.deepEqual(normalizePlugs([{ ...lamp, name: "Study PC lamp" }]), []);
    // Surviving siblings are still loaded.
    assert.deepEqual(normalizePlugs([{ ...lamp, id: "bad", address: "::1" }, lamp]), [lamp]);
  });

  test("mock plugs may keep a loopback address", () => {
    const mock = { ...lamp, protocol: "mock" as const, address: "127.0.0.1" };
    assert.deepEqual(normalizePlugs([mock]), [mock]);
  });
});
