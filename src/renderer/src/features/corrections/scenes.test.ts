import { describe, expect, it } from "vitest";
import {
  CORRECTION_CAP_GROUPS,
  CORRECTION_REFIT_MIN_GROUPS,
} from "@shared/correction/constants";
import { excludedBecause } from "@shared/correction/meaning";
import {
  CORRECTION_SCENES,
  correctionSceneState,
  pendingCorrection,
  readCorrectionScene,
  refitReport,
} from "./scenes";
import { correctionsCardView, headStatusView } from "./model";

const NOW = 1_800_000_000_000;

describe("readCorrectionScene", () => {
  it("reads the scene from the query string and from the hash", () => {
    expect(readCorrectionScene("?scene=corrections-list", "")).toBe("corrections-list");
    expect(readCorrectionScene("", "#/settings?scene=correction-phone")).toBe("correction-phone");
  });

  it("ignores anything that is not a correction scene", () => {
    expect(readCorrectionScene("?scene=plan-measured", "")).toBeNull();
    expect(readCorrectionScene("", "")).toBeNull();
    expect(readCorrectionScene("?scene=corrections-list-and-more", "")).toBeNull();
  });
});

describe("every scene renders", () => {
  it.each(CORRECTION_SCENES)("%s produces a state the card can draw", (scene) => {
    const state = correctionSceneState(scene, NOW);
    expect(state).not.toBeNull();
    const view = correctionsCardView(state!, NOW);
    expect(view.hidden).toBe(false);
    expect(view.privacy.length).toBeGreaterThan(0);
    expect(view.summary).toMatch(/correction/);
    // Every row is drawable: no NaNs, no empty labels.
    for (const row of view.rows) {
      expect(row.when).not.toContain("NaN");
      expect(row.said).toMatch(/^the model said/);
      expect(row.size.length).toBeGreaterThan(0);
    }
    expect(headStatusView(state!).body.length).toBeGreaterThan(0);
  });

  it("is not a plan scene, and a plan scene is not one of these", () => {
    expect(correctionSceneState(null, NOW)).toBeNull();
  });
});

describe("the scenes are the states worth photographing", () => {
  it("correction-phone puts a live capture in front of a phone pause", () => {
    const state = correctionSceneState("correction-phone", NOW)!;
    expect(state.pending?.kind).toBe("phone");
    expect(state.pending?.frames).toBe(3);
    expect(state.pending?.expiresAt).toBeGreaterThan(NOW);
  });

  it("correction-away is the one that can retract a drift", () => {
    expect(correctionSceneState("correction-away", NOW)!.pending?.kind).toBe("away");
  });

  it("correction-capped keeps no frames and says the cap out loud", () => {
    const state = correctionSceneState("correction-capped", NOW)!;
    expect(state.capped).toBe(true);
    expect(state.pending?.capped).toBe(true);
    expect(state.pending?.frames).toBe(0);
    expect(state.lifetimeCorrections).toBe(CORRECTION_CAP_GROUPS);
    expect(correctionsCardView(state, NOW).capNotice).not.toBeNull();
  });

  it("corrections-empty is the honest default: nothing captured, nothing stored", () => {
    const state = correctionSceneState("corrections-empty", NOW)!;
    expect(state.items).toEqual([]);
    expect(state.bytes).toBe(0);
    expect(state.pending).toBeNull();
    expect(state.activeHead).toBe("shipped");
    expect(state.refitReady).toBe(false);
  });

  it("corrections-list carries both kinds, so the reconciliation is visible", () => {
    const state = correctionSceneState("corrections-list", NOW)!;
    const away = state.items.filter((item) => item.kind === "away");
    const phone = state.items.filter((item) => item.kind === "phone");
    expect(away.length).toBeGreaterThan(0);
    expect(phone.length).toBeGreaterThan(0);
    for (const item of state.items) {
      expect(item.excludedBecause).toBe(excludedBecause(item.kind, item.verdict));
    }
  });

  it("corrections-personal is installed and corrections-failed is not", () => {
    const good = correctionSceneState("corrections-personal", NOW)!;
    expect(good.activeHead).toBe("personal");
    expect(good.lastRefit?.installed).toBe(true);
    expect(good.lastRefit?.blockedBy).toBeNull();

    const bad = correctionSceneState("corrections-failed", NOW)!;
    // A refit that failed leaves the SHIPPED head running. There is no file
    // for a bug to load by accident, and the card must not imply there is.
    expect(bad.activeHead).toBe("shipped");
    expect(bad.lastRefit?.installed).toBe(false);
    expect(bad.lastRefit?.blockedBy).toBe("regressed-pooled");
  });

  it("only counts phone corrections toward the refit pool", () => {
    const state = correctionSceneState("corrections-list", NOW)!;
    const pool = state.items.filter((item) => item.excludedBecause === null).length;
    expect(state.refitNeeded).toBe(Math.max(0, CORRECTION_REFIT_MIN_GROUPS - pool));
    expect(state.refitReady).toBe(pool >= CORRECTION_REFIT_MIN_GROUPS);
    // The pool is smaller than the list, which is the whole reason the list
    // has to say why on the rows it excludes.
    expect(pool).toBeLessThan(state.items.length);
  });
});

describe("the seeded refit report is internally honest", () => {
  it("a failing report is worse on the pooled anchors and names the gate", () => {
    const report = refitReport(false, NOW);
    expect(report.personal.pooled.balanced).toBeLessThan(report.shipped.pooled.balanced);
    expect(report.installed).toBe(false);
    expect(report.blockedBy).toBe("regressed-pooled");
    // A discarded refit has no interval to print beside a gate it did not pass.
    expect(report.pooledMarginCi95).toBeNull();
  });

  it("a passing report is not worse, and reports its interval beside the gate", () => {
    const report = refitReport(true, NOW);
    expect(report.personal.pooled.balanced).toBeGreaterThanOrEqual(
      report.shipped.pooled.balanced,
    );
    expect(report.installed).toBe(true);
    expect(report.gateEnforced).toBe(true);
    expect(report.pooledMarginCi95?.draws).toBe(2000);
    // The interval crosses zero, which is the honest reading of seven points
    // of a percent on 286 images — and the copy has to be able to say so.
    expect(report.pooledMarginCi95!.lo).toBeLessThan(0);
  });

  it("every gate the report lists has a detail rendered verbatim", () => {
    for (const installed of [true, false]) {
      for (const gate of refitReport(installed, NOW).gates) {
        expect(gate.detail.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("counts corrections in the census, never frames", () => {
    const report = refitReport(true, NOW);
    expect(report.corrections.trainGroups + report.corrections.evalGroups).toBe(
      report.corrections.total - 1,
    );
    expect(report.corrections.frames).toBeGreaterThan(report.corrections.total);
  });
});

describe("pendingCorrection", () => {
  it("expires in the future and carries the model's own call", () => {
    const pending = pendingCorrection("phone", NOW);
    expect(pending.expiresAt).toBeGreaterThan(NOW);
    expect(pending.modelLabel).toBe("phone");
    expect(pending.modelConfidence).toBeGreaterThan(0.5);
  });

  it("holds no frames at the cap", () => {
    expect(pendingCorrection("away", NOW, { capped: true }).frames).toBe(0);
  });
});
