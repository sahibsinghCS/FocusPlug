import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@shared/ipc";
import type { PlugView } from "../../lib/plugsUi";
import {
  buildTimelinePreview,
  classifySessionEvent,
  decisionConsequence,
  decisionHeroCopy,
  deskSensor,
  elapsedSeconds,
  findSessionStartedAt,
  formatElapsed,
  latchSessionStartedAt,
  overlayConsequenceLines,
  plugsSensor,
  resolveAppName,
  sessionClockView,
  windowSensor,
} from "./model";

const lists = {
  allowlist: [{ name: "Google Chrome", match: ["chrome", "chrome.exe"] }],
  blocklist: [{ name: "Discord", match: ["discord", "discord.exe"] }],
};

const lamp: PlugView = {
  id: "lamp",
  name: "Desk lamp",
  protocol: "mock",
  address: "mock://lamp",
  enabled: true,
  isStudyPc: false,
  online: true,
  powerOn: true,
};

describe("decision hero", () => {
  it("renders unmistakable ON TASK / DISTRACTED / AWAY / IDLE copy from real detail", () => {
    expect(decisionHeroCopy("ON_TASK", "Allowlisted focus · at desk").headline).toBe("ON TASK");
    expect(decisionHeroCopy("DISTRACTED", "Distracted: Discord").headline).toBe("DISTRACTED");
    expect(decisionHeroCopy("AWAY", "Away · webcam covered").headline).toBe("AWAY");
    expect(decisionHeroCopy("IDLE", "Session off — observe only").headline).toBe("IDLE");
    expect(decisionHeroCopy("ON_TASK", "Allowlisted focus · at desk").explanation).toBe(
      "Allowlisted focus · at desk",
    );
    expect(decisionConsequence("DISTRACTED")).toMatch(/Force-quit blocked apps/);
    expect(decisionConsequence("DISTRACTED")).toMatch(/cut armed plugs/);
  });
});

describe("elapsed + fuse hierarchy", () => {
  it("formats compact Kizami-style clocks", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(94)).toBe("01:34");
    expect(formatElapsed(3723)).toBe("1:02:03");
  });

  it("keeps elapsed primary until the fuse is live", () => {
    const idle = sessionClockView({
      sessionActive: false,
      elapsedSec: null,
      countdownSec: 0,
      fuseSec: 10,
    });
    expect(idle.elapsedLabel).toBe("—");
    expect(idle.fuseLabel).toBe("10s armed");
    expect(idle.primary).toBe("elapsed");

    const live = sessionClockView({
      sessionActive: true,
      elapsedSec: 12,
      countdownSec: 0,
      fuseSec: 10,
    });
    expect(live.elapsedLabel).toBe("00:12");
    expect(live.primary).toBe("elapsed");

    const fuse = sessionClockView({
      sessionActive: true,
      elapsedSec: 40,
      countdownSec: 8,
      fuseSec: 10,
    });
    expect(fuse.fuseLive).toBe(true);
    expect(fuse.fuseLabel).toBe("08s");
    expect(fuse.primary).toBe("fuse");
  });

  it("reads session start from the newest real log event", () => {
    const log: SessionEvent[] = [
      { ts: 5000, kind: "decision", detail: "ON_TASK · at desk" },
      { ts: 4000, kind: "session", detail: "Session started" },
      { ts: 1000, kind: "session", detail: "Session started" },
    ];
    expect(findSessionStartedAt(log, true)).toBe(4000);
    expect(findSessionStartedAt(log, false)).toBeNull();
    expect(elapsedSeconds(4000, 9000)).toBe(5);
    expect(elapsedSeconds(null, 9000)).toBeNull();
  });

  it("keeps the latched start after the 400-event cap trims 'Session started'", () => {
    const startEvent: SessionEvent = { ts: 4000, kind: "session", detail: "Session started" };
    const noise: SessionEvent = { ts: 9000, kind: "decision", detail: "ON_TASK · at desk" };

    // Start observed via the log, latched at provider scope.
    const latched = latchSessionStartedAt(null, [noise, startEvent], true, 10_000);
    expect(latched).toBe(4000);

    // Cap trims the start event mid-session: the latch, not now, anchors Elapsed.
    expect(latchSessionStartedAt(latched, [noise], true, 99_000)).toBe(4000);

    // No log event yet (e.g. state arrived first): latch the observation time once.
    expect(latchSessionStartedAt(null, [noise], true, 12_000)).toBe(12_000);
    expect(latchSessionStartedAt(12_000, [noise], true, 50_000)).toBe(12_000);

    // Session over: clear so the next session re-latches.
    expect(latchSessionStartedAt(latched, [noise, startEvent], false, 99_000)).toBeNull();
  });
});

describe("sensors", () => {
  it("does not invent a foreground app", () => {
    const empty = windowSensor(null, lists);
    expect(empty.empty).toBe(true);
    expect(empty.title).toBe("Waiting");
    expect(empty.href).toBe("#/allowlist");
    expect(resolveAppName("Discord", lists)).toBe("Discord");
    expect(resolveAppName("chrome", lists)).toBe("Google Chrome");
  });

  it("shows Desk AI label, confidence, and model from snapshots", () => {
    const empty = deskSensor(null, "blazeface");
    expect(empty.empty).toBe(true);
    expect(empty.meta).toBe("BlazeFace");
    expect(empty.href).toBe("#/settings");

    const live = deskSensor(
      { ts: 1, label: "at_desk", confidence: 0.94, webcamEnabled: true },
      "blazeface",
    );
    expect(live.title).toBe("At desk");
    expect(live.body).toContain("94%");
    expect(live.meta).toBe("BlazeFace");
    expect(live.tone).toBe("lime");
  });

  it("reports enabled plug state without fabricating outlets", () => {
    const none = plugsSensor([]);
    expect(none.empty).toBe(true);
    expect(none.title).toBe("None configured");
    expect(none.href).toBe("#/plugs");

    const armed = plugsSensor([lamp]);
    expect(armed.empty).toBe(false);
    expect(armed.body).toContain("Desk lamp");
    expect(armed.body).toContain("never the study PC");
    expect(armed.tone).toBe("lime");
  });
});

describe("timeline preview", () => {
  it("maps golden-path kinds onto cause → countdown → consequence → recovery", () => {
    expect(classifySessionEvent({ ts: 1, kind: "focus", detail: "Discord — #general" })).toBe(
      "cause",
    );
    expect(
      classifySessionEvent({
        ts: 2,
        kind: "countdown",
        detail: "start_countdown · Distracted: Discord · 10s",
      }),
    ).toBe("countdown");
    expect(classifySessionEvent({ ts: 3, kind: "kill", detail: "discord.exe" })).toBe(
      "consequence",
    );
    expect(classifySessionEvent({ ts: 4, kind: "plug_off", detail: "off · lamp" })).toBe(
      "consequence",
    );
    expect(classifySessionEvent({ ts: 5, kind: "unlock", detail: "Unlocked — back on task" })).toBe(
      "recovery",
    );
    expect(classifySessionEvent({ ts: 6, kind: "countdown", detail: "cancel_countdown" })).toBe(
      "recovery",
    );
  });

  it("builds a preview from real events and ignores list-editor noise", () => {
    const log: SessionEvent[] = [
      { ts: 9, kind: "unlock", detail: "Unlocked — back on task" },
      { ts: 8, kind: "plug_on", detail: "on · lamp" },
      { ts: 7, kind: "kill", detail: "Force-quit Discord" },
      { ts: 6, kind: "plug_off", detail: "off · lamp" },
      { ts: 5, kind: "countdown", detail: "start_countdown · Distracted: Discord · 10s" },
      { ts: 4, kind: "decision", detail: "DISTRACTED · Discord" },
      { ts: 3, kind: "lists", detail: "Allowlist updated (7 apps)" },
      { ts: 2, kind: "session", detail: "Session started" },
    ];
    const preview = buildTimelinePreview(log);
    expect(preview.empty).toBe(false);
    expect(preview.reached).toEqual({
      cause: true,
      countdown: true,
      consequence: true,
      recovery: true,
    });
    expect(preview.events.some((event) => event.kind === "lists")).toBe(false);
    expect(preview.events[0]?.stage).toBe("recovery");
  });

  it("treats the opening ON_TASK as cause, not recovery", () => {
    const opening = buildTimelinePreview([
      { ts: 2, kind: "decision", detail: "ON_TASK · Allowlisted focus · at desk" },
      { ts: 1, kind: "session", detail: "Session started" },
    ]);
    expect(opening.reached.cause).toBe(true);
    expect(opening.reached.recovery).toBe(false);
    expect(opening.events.every((event) => event.stage === "cause")).toBe(true);
  });
});

describe("overlay consequence", () => {
  it("names app kill and plug cut explicitly", () => {
    const armed = overlayConsequenceLines([lamp]);
    expect(armed.apps).toBe("Blocked apps will be force-quit");
    expect(armed.plugs).toContain("Desk lamp");
    const none = overlayConsequenceLines([]);
    expect(none.plugs).toMatch(/No plugs armed/);
    expect(none.plugs).toMatch(/study PC is never cut/);
  });
});
