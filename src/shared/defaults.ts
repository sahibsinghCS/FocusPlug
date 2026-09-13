import { DEFAULT_FACE_ID } from "./faces.ts";
import { DEFAULT_FLIGHT_ARR, DEFAULT_FLIGHT_DEP } from "./flightRoute.ts";
import type { AppSettings, SessionState } from "./ipc";
import type { AppEntry } from "./types";

export const DEFAULT_ALLOWLIST: AppEntry[] = [
  {
    id: "chrome",
    name: "Google Chrome",
    match: ["chrome", "chrome.exe", "google chrome"],
    enabled: true,
  },
  {
    id: "msedge",
    name: "Microsoft Edge",
    match: ["msedge", "msedge.exe", "microsoft edge"],
    enabled: true,
  },
  {
    id: "firefox",
    name: "Firefox",
    match: ["firefox", "firefox.exe"],
    enabled: true,
  },
  {
    id: "code",
    name: "Visual Studio Code",
    match: ["code", "code.exe", "visual studio code"],
    enabled: true,
  },
  {
    id: "notion",
    name: "Notion",
    match: ["notion", "notion.exe"],
    enabled: true,
  },
  {
    id: "winword",
    name: "Microsoft Word",
    match: ["winword", "winword.exe", "microsoft word"],
    enabled: true,
  },
  {
    id: "google-docs",
    name: "Google Docs",
    match: ["google docs", "docs.google.com"],
    enabled: true,
  },
];

export const DEFAULT_BLOCKLIST: AppEntry[] = [
  {
    id: "discord",
    name: "Discord",
    match: ["discord", "discord.exe"],
    enabled: true,
  },
  {
    id: "steam",
    name: "Steam",
    match: ["steam", "steam.exe", "steamwebhelper"],
    enabled: true,
  },
  {
    id: "epic",
    name: "Epic Games Launcher",
    match: ["epicgameslauncher", "epicgameslauncher.exe", "epic games"],
    enabled: true,
  },
  {
    id: "league",
    name: "League of Legends",
    match: ["leagueclient", "leagueclient.exe", "league of legends"],
    enabled: true,
  },
  {
    id: "valorant",
    name: "VALORANT",
    match: ["valorant", "valorant.exe"],
    enabled: true,
  },
  {
    id: "fortnite",
    name: "Fortnite",
    match: ["fortnite", "fortniteclient-win64-shipping.exe"],
    enabled: true,
  },
  {
    id: "cs2",
    name: "Counter-Strike 2",
    match: ["cs2", "cs2.exe", "csgo.exe"],
    enabled: true,
  },
  {
    id: "minecraft",
    name: "Minecraft",
    match: ["minecraft", "minecraftlauncher.exe"],
    enabled: true,
  },
  {
    id: "roblox",
    name: "Roblox",
    match: ["roblox", "robloxplayerbeta.exe"],
    enabled: true,
  },
];

export const DEFAULT_SETTINGS: AppSettings = {
  countdownSec: 10,
  deskThreshold: 0.6,
  strictMode: true,
  webcamEnabled: true,
  deskModelId: "blazeface",
  faceId: DEFAULT_FACE_ID,
  flightDep: DEFAULT_FLIGHT_DEP,
  flightArr: DEFAULT_FLIGHT_ARR,
  plugMode: "nudge",
  plugs: [],
  forecastEnabled: true,
  forecastPrearmEnabled: true,
  forecastNudgeRisk: 0.5,
  forecastPrearmRisk: 0.65,
  forecastPrearmFuseSec: 5,
  pauseOnAwayEnabled: true,
  pauseOnPhoneEnabled: false,
  pauseAwayConfidence: 0.75,
  pausePhoneConfidence: 0.9,
  focusPlanEnabled: true,
  focusPlanStretchEnabled: true,
};

export const DEFAULT_SESSION_STATE: SessionState = {
  sessionActive: false,
  focus: null,
  desk: null,
  decision: "IDLE",
  countdownSec: 0,
  detail: "Session off — observe only",
};
