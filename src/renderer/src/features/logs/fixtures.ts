import type { SessionEvent } from "@shared/ipc";

/** Backend-shaped events: same kinds/details as session controller + golden-path.json. */
export function goldenSessionEvents(now: number): SessionEvent[] {
  if (!Number.isFinite(now)) {
    return [];
  }
  return [
    { ts: now, kind: "demo", detail: "Demo Kill · killed discord.exe (pid 99)" },
    { ts: now - 200, kind: "plug_off", detail: "off · console-lamp, tv-outlet" },
    { ts: now - 18_000, kind: "decision", detail: "ON_TASK · On task: chrome.exe" },
    { ts: now - 18_200, kind: "plug_on", detail: "on · console-lamp, tv-outlet" },
    { ts: now - 18_400, kind: "unlock", detail: "Unlocked — back on task" },
    { ts: now - 28_000, kind: "plug_off", detail: "off · console-lamp, tv-outlet" },
    {
      ts: now - 28_200,
      kind: "kill",
      detail: "blocked_focus · killed discord.exe (pid 44552)",
    },
    { ts: now - 38_400, kind: "decision", detail: "DISTRACTED · Distracted: discord.exe" },
    { ts: now - 38_400, kind: "countdown", detail: "start_countdown · blocked_focus · 10s" },
    { ts: now - 39_000, kind: "focus", detail: "Discord — #general" },
    { ts: now - 48_000, kind: "decision", detail: "ON_TASK · On task: chrome.exe" },
    { ts: now - 48_500, kind: "desk", detail: "at_desk · 94%" },
    { ts: now - 49_000, kind: "focus", detail: "chrome — Essay draft — Google Docs" },
    { ts: now - 50_000, kind: "session", detail: "Session started" },
    { ts: now - 50_200, kind: "decision", detail: "IDLE · Idle — no focused window" },
    { ts: now - 62_000, kind: "desk", detail: "Webcam enabled" },
    {
      ts: now - 70_000,
      kind: "settings",
      detail:
        "countdown=10s · strict=true · deskThreshold=0.6 · webcam=true · deskModel=blazeface · plugs=2",
    },
    { ts: now - 80_000, kind: "plugs", detail: "Added Console lamp (mock)" },
  ];
}

export const ERROR_COUNTDOWN_CANCEL: SessionEvent = {
  ts: 1_700_000,
  kind: "countdown",
  detail: "cancel_countdown",
};

export const ERROR_PLUG_OFF: SessionEvent = {
  ts: 1_700_500,
  kind: "plug_off",
  detail: "off · desk-lamp; errors: timeout",
};

export const ERROR_KILL: SessionEvent = {
  ts: 1_701_000,
  kind: "kill",
  detail: "desk_away · killed nothing; errors: access denied",
};
