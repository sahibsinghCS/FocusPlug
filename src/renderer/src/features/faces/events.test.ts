import { describe, expect, it } from "vitest";
import { goldenSessionEvents } from "../logs/fixtures";
import { faceEventFromLog, faceEventsFromLog, isBurstKind } from "./events";

describe("face event mapping from real session log kinds", () => {
  const start = 1_000_000;
  const duration = 50_000;

  it("maps countdown / kill / distracted-away to burst kinds with severity", () => {
    const countdown = faceEventFromLog(
      { ts: start + 10_000, kind: "countdown", detail: "start_countdown · blocked_focus · 10s" },
      start,
      duration,
    );
    expect(countdown?.kind).toBe("countdown");
    expect(countdown?.severity).toBe("medium");
    expect(countdown?.at).toBeCloseTo(0.2, 5);

    const kill = faceEventFromLog(
      { ts: start + 20_000, kind: "kill", detail: "blocked_focus · killed discord.exe" },
      start,
      duration,
    );
    expect(kill?.kind).toBe("kill");
    expect(kill?.severity).toBe("high");
    expect(kill?.sourceKind).toBe("kill");

    const demo = faceEventFromLog(
      { ts: start + 21_000, kind: "demo", detail: "Demo Kill · killed discord.exe" },
      start,
      duration,
    );
    expect(demo?.kind).toBe("kill");
    expect(demo?.severity).toBe("high");

    const drift = faceEventFromLog(
      { ts: start + 15_000, kind: "decision", detail: "DISTRACTED · Distracted: discord.exe" },
      start,
      duration,
    );
    expect(drift?.kind).toBe("drift");
    expect(drift?.severity).toBe("medium");

    const away = faceEventFromLog(
      { ts: start + 12_000, kind: "desk", detail: "away · 91%" },
      start,
      duration,
    );
    expect(away?.kind).toBe("drift");
  });

  it("hooks plug_off as a high-severity kill burst and unlock as recovery", () => {
    const off = faceEventFromLog(
      { ts: start + 22_000, kind: "plug_off", detail: "off · console-lamp" },
      start,
      duration,
    );
    expect(off?.kind).toBe("kill");
    expect(off?.sourceKind).toBe("plug_off");

    const unlock = faceEventFromLog(
      { ts: start + 30_000, kind: "unlock", detail: "Unlocked — back on task" },
      start,
      duration,
    );
    expect(unlock?.kind).toBe("unlock");
    expect(unlock?.severity).toBe("low");
  });

  it("ignores config noise and keeps golden-path bursts", () => {
    const events = faceEventsFromLog(goldenSessionEvents(start + 50_000), start, duration);
    expect(events.some((event) => event.sourceKind === "settings")).toBe(false);
    expect(events.some((event) => event.kind === "kill")).toBe(true);
    expect(events.some((event) => event.kind === "countdown")).toBe(true);
    expect(events.every((event) => event.kind !== "other" || event.sourceKind.length > 0)).toBe(true);
    expect(events.filter((event) => isBurstKind(event.kind)).length).toBeGreaterThan(1);
  });
});
