import { describe, expect, it } from "vitest";
import type { DeskSnapshot, SessionState } from "@shared/ipc";
import { DEFAULT_SESSION_STATE } from "@shared/defaults";
import {
  deskChrome,
  formatHmClock,
  plugChrome,
  sessionChrome,
} from "./format";
import type { PlugView } from "./plugsUi";

const live: SessionState = {
  ...DEFAULT_SESSION_STATE,
  sessionActive: true,
  decision: "ON_TASK",
  detail: "Allowlisted focus · at desk",
};

const desk: DeskSnapshot = {
  ts: 1,
  label: "at_desk",
  confidence: 0.94,
  webcamEnabled: true,
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
  probed: true,
};

describe("chrome status labels", () => {
  it("labels a standby session", () => {
    expect(sessionChrome(DEFAULT_SESSION_STATE)).toEqual({
      label: "Session",
      detail: "Standby",
      tone: "mute",
      live: false,
    });
  });

  it("labels a live on-task session", () => {
    expect(sessionChrome(live)).toEqual({
      label: "Session",
      detail: "On task",
      tone: "lime",
      live: true,
    });
  });

  it("labels desk AI standby, live, and webcam-off", () => {
    expect(deskChrome(null).detail).toBe("Standby");
    expect(deskChrome(desk)).toEqual({
      label: "Desk AI",
      detail: "At desk 94%",
      tone: "lime",
      live: true,
    });
    expect(deskChrome({ ...desk, webcamEnabled: false })).toEqual({
      label: "Desk AI",
      detail: "Webcam off",
      tone: "mute",
      live: false,
    });
  });

  it("labels plug chrome for empty, idle, and armed", () => {
    expect(plugChrome([]).detail).toBe("None");
    expect(
      plugChrome([{ ...lamp, enabled: false }]),
    ).toMatchObject({ detail: "Idle", tone: "mute", live: false });
    expect(plugChrome([lamp])).toEqual({
      label: "Plugs",
      detail: "1 armed",
      tone: "lime",
      live: true,
    });
    expect(plugChrome([{ ...lamp, powerOn: false }]).tone).toBe("red");
  });

  it("formats an HH:MM clock", () => {
    expect(formatHmClock(1_700_000_000_000)).toMatch(/^\d{2}:\d{2}$/);
  });
});
