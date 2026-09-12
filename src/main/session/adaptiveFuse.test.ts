import { describe, expect, it } from "vitest";
import { EXPLORE_RATE, MAX_FUSE_SEC } from "../../shared/adapt/fuse.ts";
import type { DeskSnapshot, FocusSnapshot } from "../../shared/types.ts";
import { AdaptiveFuse } from "./adaptiveFuse.ts";

const T0 = Date.UTC(2026, 8, 12, 14, 0, 0);

function blocked(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "discord.exe",
    windowTitle: "Discord",
    matchedAllow: false,
    matchedBlock: true,
  };
}

function onTask(ts: number): FocusSnapshot {
  return {
    ts,
    processName: "code.exe",
    windowTitle: "VS Code",
    matchedAllow: true,
    matchedBlock: false,
  };
}

function atDesk(ts: number): DeskSnapshot {
  return { ts, label: "at_desk", confidence: 0.9, webcamEnabled: true };
}

/** Never explores: `1` is above any rate, so the greedy fuse always wins. */
const NEVER = (): number => 1;
/** Always explores: `0` is below every rate. */
const ALWAYS = (): number => 0;

describe("AdaptiveFuse", () => {
  it("hands back the Settings value on a cold install", () => {
    const fuse = new AdaptiveFuse({ random: NEVER });
    fuse.startSession(T0);
    fuse.noteFocus(blocked(T0));
    // Trust is zero with no drifts, so the greedy blend is exactly the base.
    expect(fuse.fuseFor({ focus: blocked(T0), desk: atDesk(T0) }, 10, T0)).toBe(10);
  });

  it("leaves the base alone when nothing is wrong", () => {
    const fuse = new AdaptiveFuse({ random: ALWAYS });
    fuse.startSession(T0);
    expect(fuse.fuseFor({ focus: onTask(T0), desk: atDesk(T0) }, 10, T0)).toBe(10);
  });

  it("probes with a generous fuse while it is still learning", () => {
    const fuse = new AdaptiveFuse({ random: ALWAYS });
    fuse.startSession(T0);
    fuse.noteFocus(blocked(T0));
    expect(fuse.fuseFor({ focus: blocked(T0), desk: atDesk(T0) }, 10, T0)).toBe(MAX_FUSE_SEC);
    // Sanity: the rate this relies on is a real probe rate, not a certainty.
    expect(EXPLORE_RATE).toBeGreaterThan(0);
    expect(EXPLORE_RATE).toBeLessThan(1);
  });

  it("learns a recovery, and records how long it took", () => {
    const fuse = new AdaptiveFuse({ random: NEVER });
    fuse.startSession(T0);
    fuse.noteFocus(blocked(T0));
    fuse.fuseFor({ focus: blocked(T0), desk: atDesk(T0) }, 10, T0);
    fuse.armed(10, T0);
    fuse.recovered(T0 + 6000);

    const model = fuse.snapshot();
    expect(model.drifts).toBe(1);
    expect(model.recoveries).toBe(1);
    expect(model.samples).toBeGreaterThan(0);
  });

  it("learns a kill as a drift with no recovery", () => {
    const fuse = new AdaptiveFuse({ random: NEVER });
    fuse.startSession(T0);
    fuse.noteFocus(blocked(T0));
    fuse.fuseFor({ focus: blocked(T0), desk: atDesk(T0) }, 10, T0);
    fuse.armed(10, T0);
    fuse.killed();

    const model = fuse.snapshot();
    expect(model.drifts).toBe(1);
    expect(model.recoveries).toBe(0);
  });

  it("does not learn anything from a countdown that was never armed", () => {
    const fuse = new AdaptiveFuse({ random: NEVER });
    fuse.startSession(T0);
    fuse.recovered(T0 + 5000);
    fuse.killed();
    expect(fuse.snapshot().drifts).toBe(0);
  });

  it("treats stopping mid-countdown as no evidence either way", () => {
    const fuse = new AdaptiveFuse({ random: NEVER });
    fuse.startSession(T0);
    fuse.noteFocus(blocked(T0));
    fuse.fuseFor({ focus: blocked(T0), desk: atDesk(T0) }, 10, T0);
    fuse.armed(10, T0);
    fuse.stopSession();
    fuse.recovered(T0 + 9000);

    // Stopping a session is not the user fixing their own drift.
    expect(fuse.snapshot().drifts).toBe(0);
  });

  it("comes back with what it learned last time", () => {
    let saved: unknown = null;
    const store = {
      loadAdaptiveModel: (): unknown => saved,
      saveAdaptiveModel: (value: unknown): void => {
        saved = JSON.parse(JSON.stringify(value)) as unknown;
      },
    };

    const first = new AdaptiveFuse({ store, random: NEVER });
    first.startSession(T0);
    first.noteFocus(blocked(T0));
    first.fuseFor({ focus: blocked(T0), desk: atDesk(T0) }, 10, T0);
    first.armed(10, T0);
    first.recovered(T0 + 4000);
    const before = first.snapshot();

    const second = new AdaptiveFuse({ store, random: NEVER });
    expect(second.snapshot().drifts).toBe(before.drifts);
    expect(second.snapshot().weights).toEqual(before.weights);
  });

  it("starts clean when the stored model is corrupt", () => {
    const store = {
      loadAdaptiveModel: (): unknown => ({ weights: "not a model" }),
      saveAdaptiveModel: (): void => undefined,
    };
    expect(new AdaptiveFuse({ store, random: NEVER }).snapshot().drifts).toBe(0);
  });

  it("counts drifts within a session so later ones read as a worse night", () => {
    const fuse = new AdaptiveFuse({ random: NEVER });
    fuse.startSession(T0);
    fuse.noteFocus(blocked(T0));
    fuse.fuseFor({ focus: blocked(T0), desk: atDesk(T0) }, 10, T0);
    fuse.armed(10, T0);
    fuse.killed();

    fuse.fuseFor({ focus: blocked(T0 + 60_000), desk: atDesk(T0 + 60_000) }, 10, T0 + 60_000);
    const choice = fuse.armed(10, T0 + 60_000);
    expect(choice).not.toBeNull();
    expect(fuse.snapshot().drifts).toBe(1);
  });
});
