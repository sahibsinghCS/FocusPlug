import { describe, expect, it } from "vitest";

import { extractFeatures } from "./features";
import {
  momentToRow,
  parseCsv,
  parseJsonl,
  rowToMoment,
  splitCsvLine,
  summarise,
  toCsv,
  toJsonl,
  type DriftRow,
} from "./dataset";
import { fitPrior, printableWeights } from "./prior";
import { drawCovariates, momentFor, population, rng } from "./population";
import { FEATURE_NAMES } from "./features";
import { predictRecovery, PRIOR_WEIGHTS } from "./model";

function row(patch: Partial<DriftRow> = {}): DriftRow {
  return {
    driftId: "s0-d0",
    cohort: "sim:test",
    tsIso: "2026-09-01T21:30:00.000Z",
    elapsedMin: 12.5,
    plannedMin: 50,
    violation: "blocked",
    focusProcess: "discord",
    deskLabel: "at_desk",
    deskConfidence: 0.91,
    webcamEnabled: true,
    dwellMs: 4200,
    switchesLastTwoMin: 3,
    priorDrifts: 1,
    priorKills: 0,
    hour: 21,
    fuseSec: 10,
    recoveredAfterSec: 6.5,
    ...patch,
  };
}

describe("dataset round trip", () => {
  it("preserves every feature through CSV", () => {
    const original = row();
    const [restored] = parseCsv(toCsv([original]));
    expect(restored).toBeDefined();
    expect(extractFeatures(rowToMoment(restored!))).toEqual(
      extractFeatures(rowToMoment(original)),
    );
  });

  it("preserves every feature through JSONL", () => {
    const original = row({ deskLabel: "", webcamEnabled: false, deskConfidence: 0 });
    const [restored] = parseJsonl(toJsonl([original]));
    expect(extractFeatures(rowToMoment(restored!))).toEqual(
      extractFeatures(rowToMoment(original)),
    );
  });

  it("keeps a kill censored rather than turning it into a zero", () => {
    const [restored] = parseCsv(toCsv([row({ recoveredAfterSec: null })]));
    expect(restored!.recoveredAfterSec).toBeNull();
  });

  it("trusts recovered_after_sec over the derived recovered column", () => {
    // A tool that "filled in" the label column must not flip a censored row.
    const csv = [
      "drift_id,fuse_sec,recovered_after_sec,recovered",
      "a,10,,1",
      "b,10,4,0",
    ].join("\n");
    const rows = parseCsv(csv);
    expect(rows[0]!.recoveredAfterSec).toBeNull();
    expect(rows[1]!.recoveredAfterSec).toBe(4);
  });

  it("reads columns by name, not position", () => {
    const csv = ["recovered_after_sec,hour,fuse_sec", "7,23,14"].join("\n");
    const [restored] = parseCsv(csv);
    expect(restored!.fuseSec).toBe(14);
    expect(restored!.hour).toBe(23);
    expect(restored!.recoveredAfterSec).toBe(7);
  });

  it("refuses a file with no label column instead of inventing one", () => {
    expect(() => parseCsv("drift_id,hour\na,21")).toThrow(/fuse_sec and recovered_after_sec/);
  });

  it("survives commas and quotes inside cells", () => {
    const original = row({ focusProcess: 'rocket "league", demo', cohort: "sim:a,b" });
    const [restored] = parseCsv(toCsv([original]));
    expect(restored!.focusProcess).toBe('rocket "league", demo');
    expect(restored!.cohort).toBe("sim:a,b");
  });

  it("splits an empty trailing cell", () => {
    expect(splitCsvLine("a,b,")).toEqual(["a", "b", ""]);
  });
});

describe("summarise", () => {
  it("counts recoveries and censored rows separately", () => {
    const summary = summarise([row(), row({ driftId: "b", recoveredAfterSec: null })]);
    expect(summary.rows).toBe(2);
    expect(summary.recovered).toBe(1);
    expect(summary.killed).toBe(1);
    expect(summary.problems).toEqual([]);
  });

  it("flags a recovery that happened after its own fuse fired", () => {
    // The kill would have landed first, so this row cannot have been observed —
    // the signature of a tool that imputed a recovery time.
    const summary = summarise([row({ fuseSec: 5, recoveredAfterSec: 19 })]);
    expect(summary.problems).toHaveLength(1);
    expect(summary.problems[0]).toMatch(/recovered at 19s on a 5s fuse/);
  });

  it("reports the median of observed recoveries only", () => {
    const summary = summarise([
      row({ driftId: "a", recoveredAfterSec: 2 }),
      row({ driftId: "b", recoveredAfterSec: 8 }),
      row({ driftId: "c", recoveredAfterSec: 20, fuseSec: 30 }),
      row({ driftId: "d", recoveredAfterSec: null }),
    ]);
    expect(summary.medianRecoverySec).toBe(8);
  });
});

describe("momentToRow", () => {
  it("is the inverse of rowToMoment for the recorded fields", () => {
    const original = row();
    const restored = momentToRow(
      rowToMoment(original),
      { recoveredAfterSec: original.recoveredAfterSec },
      { driftId: original.driftId, cohort: original.cohort },
    );
    expect(restored.hour).toBe(original.hour);
    expect(restored.fuseSec).toBe(original.fuseSec);
    expect(restored.violation).toBe(original.violation);
    expect(restored.elapsedMin).toBeCloseTo(original.elapsedMin, 6);
    expect(restored.plannedMin).toBeCloseTo(original.plannedMin, 6);
  });
});

describe("population", () => {
  it("draws the same people every run", () => {
    const first = population({ students: 5, driftsEach: 4 });
    const second = population({ students: 5, driftsEach: 4 });
    expect(second).toEqual(first);
  });

  it("varies the situation between drifts", () => {
    // A dataset where every row has identical features teaches the model
    // nothing except the fuse term.
    const [student] = population({ students: 1, driftsEach: 40 });
    const hours = new Set(student!.drifts.map((drift) => drift.covariates.hour));
    const apps = new Set(student!.drifts.map((drift) => drift.covariates.focusProcess));
    expect(hours.size).toBeGreaterThan(3);
    expect(apps.size).toBeGreaterThan(2);
  });

  it("puts the desk reading in a state consistent with the webcam", () => {
    const random = rng(99);
    for (let index = 0; index < 200; index += 1) {
      const covariates = drawCovariates(random);
      if (!covariates.webcamEnabled) {
        expect(covariates.deskLabel).toBe("");
        expect(covariates.deskConfidence).toBe(0);
      } else {
        expect(covariates.deskLabel).not.toBe("");
      }
    }
  });

  it("carries the session history into the moment", () => {
    const [student] = population({ students: 1, driftsEach: 1 });
    const moment = momentFor(student!.drifts[0]!, Date.now(), 10, {
      priorDrifts: 3,
      priorKills: 2,
    });
    expect(moment.priorDrifts).toBe(3);
    expect(moment.priorKills).toBe(2);
  });
});

describe("fitPrior", () => {
  /** A population whose only rule is: they come back at 9s, never sooner. */
  function syntheticRows(count: number): DriftRow[] {
    const random = rng(4242);
    const rows: DriftRow[] = [];
    for (let index = 0; index < count; index += 1) {
      const fuseSec = 3 + Math.floor(random() * 28);
      const recovers = fuseSec >= 9;
      rows.push(
        row({
          driftId: `syn-${index}`,
          fuseSec,
          recoveredAfterSec: recovers ? 9 : null,
          hour: 15,
          switchesLastTwoMin: 0,
          elapsedMin: 10,
        }),
      );
    }
    return rows;
  }

  it("learns where a recovery threshold sits", () => {
    const { weights } = fitPrior(syntheticRows(600), { epochs: 6, seed: 1 });
    const model = {
      weights: FEATURE_NAMES.map((name) => weights[name]),
      prior: FEATURE_NAMES.map(() => 0),
      samples: 0,
      drifts: 0,
      recoveries: 0,
      probes: 0,
      layout: 0,
    };
    const at = (fuseSec: number): number =>
      predictRecovery(model, extractFeatures(rowToMoment(row({ fuseSec }))));

    expect(at(4)).toBeLessThan(0.5);
    expect(at(20)).toBeGreaterThan(0.5);
    expect(at(20)).toBeGreaterThan(at(4));
  });

  it("splits by drift and holds some back", () => {
    const report = fitPrior(syntheticRows(400), { epochs: 1, holdout: 0.25 });
    expect(report.holdoutDrifts).toBeGreaterThan(50);
    expect(report.trainDrifts + report.holdoutDrifts).toBe(400);
    expect(report.holdoutExamples).toBeGreaterThan(report.holdoutDrifts);
  });

  it("splits the same way every run, so a refit is comparable", () => {
    const rows = syntheticRows(300);
    const first = fitPrior(rows, { epochs: 1, seed: 3 });
    const second = fitPrior(rows, { epochs: 1, seed: 3 });
    expect(second.holdoutDrifts).toBe(first.holdoutDrifts);
    expect(second.fittedLogLoss).toBeCloseTo(first.fittedLogLoss, 12);
  });

  it("scores the shipped prior on the same held-out examples", () => {
    const report = fitPrior(syntheticRows(400), { epochs: 2 });
    expect(report.shippedLogLoss).toBeGreaterThan(0);
    // The hand-set prior knows nothing about a 9-second threshold, so a fit
    // that cannot beat it on data this clean is broken.
    expect(report.fittedLogLoss).toBeLessThan(report.shippedLogLoss);
  });

  it("prints a block with every feature, ready to paste", () => {
    const { weights } = fitPrior(syntheticRows(200), { epochs: 1 });
    const block = printableWeights(weights);
    for (const name of FEATURE_NAMES) {
      expect(block).toContain(`${name}:`);
    }
    expect(block).toContain("PRIOR_WEIGHTS");
    expect(Object.keys(weights)).toHaveLength(Object.keys(PRIOR_WEIGHTS).length);
  });
});
