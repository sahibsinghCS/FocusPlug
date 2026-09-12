import { describe, expect, it } from "vitest";
import {
  extractFeatures,
  FEATURE_COUNT,
  FEATURE_NAMES,
  withFuse,
  type DriftMoment,
} from "./features";
import {
  confidence,
  createModel,
  doneExploring,
  FEATURE_LAYOUT,
  learn,
  learnedShift,
  predictRecovery,
  reviveModel,
  sigmoid,
} from "./model";
import { chooseFuse, FUSE_CANDIDATES, MAX_FUSE_SEC, MIN_FUSE_SEC } from "./fuse";
import { examplesFor, observeDrift } from "./train";

const START = 1_757_000_000_000;

/** Probing is deliberately random; pin it off when asserting the greedy choice. */
const NEVER_PROBE = { random: (): number => 1 };
const ALWAYS_PROBE = { random: (): number => 0 };

/** A drift that was killed, as the policy would report it. */
function killed(fuseSec: number, probed = false) {
  return { recoveredAfterSec: null, fuseSec, probed };
}

/** A drift the student fixed themselves after `sec` seconds. */
function recovered(sec: number, fuseSec: number, probed = false) {
  return { recoveredAfterSec: sec, fuseSec, probed };
}

function moment(patch: Partial<DriftMoment> = {}): DriftMoment {
  return {
    ts: START + 10 * 60_000,
    sessionStartedAt: START,
    sessionEndsAt: START + 50 * 60_000,
    focus: {
      ts: START + 10 * 60_000,
      processName: "discord",
      windowTitle: "Discord",
      matchedAllow: false,
      matchedBlock: true,
    },
    desk: {
      ts: START + 10 * 60_000,
      label: "at_desk",
      confidence: 0.94,
      webcamEnabled: true,
    },
    violation: "blocked",
    dwellMs: 4_000,
    switchesLastTwoMin: 3,
    priorDrifts: 0,
    priorKills: 0,
    fuseSec: 10,
    hour: 21,
    ...patch,
  };
}

describe("drift features", () => {
  it("emits one finite value per named feature, all in [0, 1]", () => {
    const vector = extractFeatures(moment());
    expect(vector).toHaveLength(FEATURE_COUNT);
    expect(vector).toHaveLength(FEATURE_NAMES.length);
    for (const value of vector) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("separates a blocked window from walking away", () => {
    const blocked = extractFeatures(moment({ violation: "blocked" }));
    const away = extractFeatures(
      moment({
        violation: "away",
        desk: { ts: START, label: "away", confidence: 0.88, webcamEnabled: true },
      }),
    );
    const blockedIndex = FEATURE_NAMES.indexOf("blockedWindow");
    const awayIndex = FEATURE_NAMES.indexOf("deskAway");
    expect(blocked[blockedIndex]).toBe(1);
    expect(blocked[awayIndex]).toBe(0);
    expect(away[blockedIndex]).toBe(0);
    expect(away[awayIndex]).toBe(1);
  });

  it("reads desk confidence as zero when the camera cannot say", () => {
    const index = FEATURE_NAMES.indexOf("deskConfidence");
    const off = extractFeatures(
      moment({ desk: { ts: START, label: "at_desk", confidence: 0.9, webcamEnabled: false } }),
    );
    const unsure = extractFeatures(
      moment({ desk: { ts: START, label: "uncertain", confidence: 0.9, webcamEnabled: true } }),
    );
    expect(off[index]).toBe(0);
    expect(unsure[index]).toBe(0);
    expect(extractFeatures(moment())[index]).toBeCloseTo(0.94, 5);
  });

  it("decays the just-switched signal as the window is held", () => {
    const index = FEATURE_NAMES.indexOf("freshSwitch");
    const fresh = extractFeatures(moment({ dwellMs: 1_000 }))[index]!;
    const settled = extractFeatures(moment({ dwellMs: 10 * 60_000 }))[index]!;
    expect(fresh).toBeGreaterThan(0.9);
    expect(settled).toBeLessThan(0.01);
  });

  it("carries the fuse it was given, because the fuse causes the outcome", () => {
    const index = FEATURE_NAMES.indexOf("fuseLength");
    expect(extractFeatures(withFuse(moment(), 3))[index]).toBeCloseTo(0.1, 5);
    expect(extractFeatures(withFuse(moment(), 30))[index]).toBe(1);
    expect(extractFeatures(withFuse(moment(), 120))[index]).toBe(1);
  });
});

describe("adaptive model", () => {
  it("starts on the prior with no experience", () => {
    const model = createModel();
    expect(model.samples).toBe(0);
    expect(confidence(model)).toBe(0);
    expect(model.weights).toEqual(model.prior);
    expect(learnedShift(model).every((entry) => entry.shift === 0)).toBe(true);
  });

  it("keeps sigmoid finite at the extremes", () => {
    expect(sigmoid(0)).toBeCloseTo(0.5, 6);
    expect(sigmoid(1000)).toBe(1);
    expect(sigmoid(-1000)).toBeCloseTo(0, 10);
    expect(Number.isFinite(sigmoid(-1000))).toBe(true);
  });

  it("believes a longer fuse gives a better chance of recovering", () => {
    const model = createModel();
    const short = predictRecovery(model, extractFeatures(withFuse(moment(), 3)));
    const long = predictRecovery(model, extractFeatures(withFuse(moment(), 30)));
    expect(long).toBeGreaterThan(short);
  });

  it("moves toward the label it is shown", () => {
    const features = extractFeatures(moment());
    const before = predictRecovery(createModel(), features);
    const afterRecovery = predictRecovery(learn(createModel(), features, true), features);
    const afterKill = predictRecovery(learn(createModel(), features, false), features);
    expect(afterRecovery).toBeGreaterThan(before);
    expect(afterKill).toBeLessThan(before);
  });

  it("learns a person who never comes back", () => {
    let model = createModel();
    const features = extractFeatures(moment());
    for (let i = 0; i < 40; i += 1) {
      model = learn(model, features, false);
    }
    expect(predictRecovery(model, features)).toBeLessThan(0.35);
    // Raw gradient steps are not observations: confidence tracks real drifts.
    expect(confidence(model)).toBe(0);
  });

  it("learns a person who always does", () => {
    let model = createModel();
    const features = extractFeatures(moment());
    for (let i = 0; i < 40; i += 1) {
      model = learn(model, features, true);
    }
    expect(predictRecovery(model, features)).toBeGreaterThan(0.8);
  });

  it("stays near the prior after a couple of real drifts", () => {
    let model = createModel();
    for (let i = 0; i < 2; i += 1) {
      model = observeDrift(model, moment(), killed(10));
    }
    const shift = Math.max(...learnedShift(model).map((entry) => Math.abs(entry.shift)));
    expect(shift).toBeLessThan(0.6);
    expect(model.drifts).toBe(2);
  });

  it("settles rather than oscillating on mixed evidence", () => {
    let model = createModel();
    const features = extractFeatures(moment());
    for (let i = 0; i < 60; i += 1) {
      model = learn(model, features, i % 2 === 0);
    }
    const probability = predictRecovery(model, features);
    expect(probability).toBeGreaterThan(0.3);
    expect(probability).toBeLessThan(0.7);
    expect(model.weights.every((weight) => Number.isFinite(weight))).toBe(true);
  });

  it("revives a stored model and discards anything it cannot trust", () => {
    const trained = learn(createModel(), extractFeatures(moment()), true);
    const round = reviveModel(JSON.parse(JSON.stringify(trained)));
    expect(round.weights).toEqual(trained.weights);
    expect(round.samples).toBe(1);

    expect(reviveModel(null).samples).toBe(0);
    expect(reviveModel({ ...trained, layout: FEATURE_LAYOUT + 1 }).samples).toBe(0);
    expect(reviveModel({ ...trained, weights: [1, 2] }).samples).toBe(0);
    expect(reviveModel({ ...trained, weights: [...trained.weights.slice(1), Number.NaN] }).samples)
      .toBe(0);
    expect(reviveModel({ ...trained, samples: -4 }).samples).toBe(0);
  });
});

describe("fuse choice", () => {
  it("uses the configured fuse exactly until it has learned something", () => {
    const choice = chooseFuse(createModel(), moment(), 10, NEVER_PROBE);
    expect(choice.seconds).toBe(10);
    expect(choice.trust).toBe(0);
    expect(choice.reason).toMatch(/no drifts learned from yet/);
  });

  it("shortens the fuse for someone who never self-corrects", () => {
    let model = createModel();
    for (let i = 0; i < 20; i += 1) {
      model = observeDrift(model, moment(), killed(MAX_FUSE_SEC, true));
    }
    const choice = chooseFuse(model, moment(), 10, NEVER_PROBE);
    expect(choice.seconds).toBe(MIN_FUSE_SEC);
    expect(choice.modelSeconds).toBeNull();
    expect(choice.reason).toMatch(/almost never/);
  });

  it("gives room to someone who reliably takes about twelve seconds", () => {
    let model = createModel();
    for (let i = 0; i < 20; i += 1) {
      model = observeDrift(model, moment(), recovered(12, 20, true));
    }
    const choice = chooseFuse(model, moment(), 10, NEVER_PROBE);
    expect(choice.modelSeconds).not.toBeNull();
    // It should not hand back a fuse that would have killed them every time.
    expect(choice.seconds).toBeGreaterThan(8);
  });

  it("never leaves the safe range, whatever it is handed", () => {
    const model = createModel();
    for (const base of [0, -50, 1, 10, 900, Number.NaN, Number.POSITIVE_INFINITY]) {
      const choice = chooseFuse(model, moment(), base);
      expect(choice.seconds).toBeGreaterThanOrEqual(MIN_FUSE_SEC);
      expect(choice.seconds).toBeLessThanOrEqual(MAX_FUSE_SEC);
      expect(Number.isInteger(choice.seconds)).toBe(true);
    }
  });

  it("starts at your setting and walks down to the floor for a confirmed quitter", () => {
    let model = createModel();
    const seen: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      model = observeDrift(model, moment(), killed(MAX_FUSE_SEC, true));
      seen.push(chooseFuse(model, moment(), 20, NEVER_PROBE).seconds);
    }
    // It leans on the user's 20s while it is still probing, then drops once
    // enough full-length probes have come back empty. The step down when that
    // conclusion lands is intended: it has stopped guessing.
    expect(seen[0]).toBe(20);
    expect(seen[seen.length - 1]).toBe(MIN_FUSE_SEC);
    for (let i = 1; i < seen.length; i += 1) {
      expect(seen[i]).toBeLessThanOrEqual(seen[i - 1]!);
    }
  });

  it("tells two different people apart from the same moment", () => {
    let quitter = createModel();
    let returner = createModel();
    for (let i = 0; i < 20; i += 1) {
      quitter = observeDrift(quitter, moment(), killed(MAX_FUSE_SEC, true));
      returner = observeDrift(returner, moment(), recovered(11, 20, true));
    }
    expect(chooseFuse(quitter, moment(), 10, NEVER_PROBE).seconds).toBeLessThan(
      chooseFuse(returner, moment(), 10, NEVER_PROBE).seconds,
    );
  });
});

describe("drift outcomes as training examples", () => {
  it("labels every candidate fuse when the recovery time is known", () => {
    const examples = examplesFor(moment(), recovered(9, 20));
    expect(examples).toHaveLength(FUSE_CANDIDATES.length);
    for (const example of examples) {
      expect(example.recovered).toBe(example.fuseSec >= 9);
    }
  });

  it("drops the fuses a kill cannot speak to, instead of guessing", () => {
    const examples = examplesFor(moment(), killed(10));
    // Everything up to the fuse we used is a known failure; past it is censored.
    expect(examples.every((example) => example.recovered === false)).toBe(true);
    expect(Math.max(...examples.map((example) => example.fuseSec))).toBe(10);
    expect(examples.length).toBeLessThan(FUSE_CANDIDATES.length);
  });

  it("counts one drift however many examples it yields", () => {
    const model = observeDrift(createModel(), moment(), recovered(6, 10));
    expect(model.drifts).toBe(1);
    expect(model.samples).toBe(FUSE_CANDIDATES.length);
  });

  it("hands out a full-length probe while it still needs to learn", () => {
    const choice = chooseFuse(createModel(), moment(), 10, ALWAYS_PROBE);
    expect(choice.exploring).toBe(true);
    expect(choice.seconds).toBe(MAX_FUSE_SEC);
    expect(choice.reason).toMatch(/benefit of the doubt/);
  });

  it("keeps probing occasionally even once it has made up its mind", () => {
    // A fuse at the floor kills everyone, and a model trained only on kills
    // concludes everyone deserves the floor. Without a probe floor that is an
    // absorbing state: one bad night and it never recovers.
    let model = createModel();
    for (let i = 0; i < 30; i += 1) {
      model = observeDrift(model, moment(), killed(MAX_FUSE_SEC, true));
    }
    expect(doneExploring(model)).toBe(true);
    expect(chooseFuse(model, moment(), 10, ALWAYS_PROBE).exploring).toBe(true);
  });

  it("climbs back out after a run of bad luck instead of sticking at the floor", () => {
    let model = createModel();
    for (let i = 0; i < 10; i += 1) {
      model = observeDrift(model, moment(), recovered(9, 25, true));
    }
    const settled = chooseFuse(model, moment(), 10, NEVER_PROBE).seconds;
    for (let i = 0; i < 6; i += 1) {
      model = observeDrift(model, moment(), killed(settled));
    }
    // The dip is allowed; permanently flooring on it is not.
    for (let i = 0; i < 6; i += 1) {
      model = observeDrift(model, moment(), recovered(9, MAX_FUSE_SEC, true));
    }
    expect(chooseFuse(model, moment(), 10, NEVER_PROBE).seconds).toBeGreaterThan(MIN_FUSE_SEC);
  });

  it("recovers the person's timing from their drifts", () => {
    // Someone who consistently comes back at twelve seconds should end up with
    // a model that puts the crossing point near twelve, not at the floor.
    let model = createModel();
    for (let i = 0; i < 25; i += 1) {
      model = observeDrift(model, moment(), recovered(12, 25, true));
    }
    const crossing = chooseFuse(model, moment(), 10, NEVER_PROBE).modelSeconds;
    expect(crossing).not.toBeNull();
    expect(crossing!).toBeGreaterThanOrEqual(8);
    expect(crossing!).toBeLessThanOrEqual(18);
  });
});
