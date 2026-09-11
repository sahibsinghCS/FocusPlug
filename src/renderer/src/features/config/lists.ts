import { DEFAULT_ALLOWLIST, DEFAULT_BLOCKLIST } from "@shared/defaults";
import type { AppEntry } from "@shared/types";

export type ListKind = "allow" | "block";

export type ListField = "name" | "match";

export interface ListFieldError {
  field: ListField;
  message: string;
}

export interface ListCopy {
  kicker: string;
  title: string;
  summary: string;
  defaults: string;
  matchHelp: string;
  namePlaceholder: string;
  tokenPlaceholder: string;
}

export function parseMatchTokens(raw: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const piece of raw.split(/[\n,]+/u)) {
    const token = piece.trim();
    if (token.length === 0) {
      continue;
    }
    const key = token.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    tokens.push(token);
  }
  return tokens;
}

export function commitTokenDraft(tokens: readonly string[], draft: string): string[] {
  return parseMatchTokens([...tokens, draft.trim()].filter((item) => item.length > 0).join(","));
}

export function validateListDraft(input: {
  name: string;
  match: readonly string[];
}): ListFieldError | null {
  if (input.name.trim().length === 0) {
    return { field: "name", message: "Name is required" };
  }
  if (input.match.length === 0) {
    return { field: "match", message: "Add at least one match token" };
  }
  return null;
}

export function shippedDefaults(kind: ListKind): readonly AppEntry[] {
  return kind === "allow" ? DEFAULT_ALLOWLIST : DEFAULT_BLOCKLIST;
}

export function isShippedDefault(kind: ListKind, id: string): boolean {
  return shippedDefaults(kind).some((entry) => entry.id === id);
}

export function countEnabled(entries: readonly AppEntry[]): number {
  return entries.filter((entry) => entry.enabled).length;
}

export function listCopy(kind: ListKind): ListCopy {
  if (kind === "allow") {
    return {
      kicker: "Study apps",
      title: "Allowlist",
      summary: "Foreground apps that count as on-task.",
      defaults:
        "Ships with Chrome, Edge, Firefox, VS Code, Notion, Word, and Google Docs titles — all enabled.",
      matchHelp:
        "Tokens match a process basename (chrome ↔ chrome.exe) or a window-title substring. Case-insensitive. Disable a row to ignore it without deleting.",
      namePlaceholder: "Obsidian",
      tokenPlaceholder: "obsidian, obsidian.exe",
    };
  }
  return {
    kicker: "Kill targets",
    title: "Blocklist",
    summary: "Processes FocusPlug force-quits after the countdown.",
    defaults: "Ships with Discord, Steam, Epic, and common game clients — all enabled.",
    matchHelp:
      "Tokens match a process basename or window-title substring. Case-insensitive. Disable a row to keep it listed without killing it.",
    namePlaceholder: "Spotify",
    tokenPlaceholder: "spotify, spotify.exe",
  };
}

export function listMeta(entries: readonly AppEntry[]): string {
  return `${countEnabled(entries)} enabled · ${entries.length} total`;
}

export function entryReturned(entries: readonly AppEntry[], id: string): boolean {
  return entries.some((entry) => entry.id === id);
}
