/**
 * Seeded `DeskCorrectionsState`s for `preview:renderer`, `mockApi` and the
 * stills script.
 *
 * They are built here rather than imported from main because nothing under
 * `src/main/**` may reach a browser preview, and because the states worth
 * photographing are exactly the ones that are awkward to reach by hand: the
 * paused screen with chips up, a review list with photographs in it, and the
 * three head-status variants — including the one where the refit was
 * DISCARDED, which is the state this feature is most likely to be in and the
 * one a screenshot is most likely to omit.
 *
 * The scene names live here rather than in `lib/urlScene.ts` because they are
 * this feature's own vocabulary, exactly as the plan scenes are.
 */

import {
  CORRECTION_ANSWER_WINDOW_MS,
  CORRECTION_CAP_GROUPS,
  CORRECTION_REFIT_MIN_GROUPS,
} from "@shared/correction/constants";
import { excludedBecause } from "@shared/correction/meaning";
import type {
  CorrectionListItem,
  CorrectionVerdict,
  DeskCorrectionsState,
  PendingCorrection,
  RefitReport,
  RefitScores,
  SliceScore,
} from "@shared/correction/types";
import type { PauseKind } from "@shared/nudge";

export const CORRECTION_SCENES = [
  "correction-phone",
  "correction-away",
  "correction-capped",
  "corrections-empty",
  "corrections-list",
  "corrections-personal",
  "corrections-failed",
] as const;

export type CorrectionScene = (typeof CORRECTION_SCENES)[number];

function readParam(search: string, hash: string, name: string): string | null {
  const query = new URLSearchParams(search);
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return query.get(name) ?? new URLSearchParams(hashQuery).get(name);
}

export function readCorrectionScene(search: string, hash: string): CorrectionScene | null {
  const raw = readParam(search, hash, "scene");
  return CORRECTION_SCENES.find((scene) => scene === raw) ?? null;
}

/**
 * A 48x36 grey-gradient JPEG, as a data URL, standing in for a thumbnail.
 *
 * The review list's whole point is that the student sees their OWN
 * photographs, so a scene that faked a recognisable room would be dishonest
 * about what is on their disk. A flat gradient says "a thumbnail goes here"
 * and nothing more. It is a real JPEG rather than a placeholder box because a
 * still of a broken-image icon would prove nothing about the screen that
 * matters most in this feature.
 */
const SWATCH =
  "data:image/jpeg;base64," +
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wCEABsSFBcUERsXFhceHBsgKEIrKCUlKFE6PTBCYFVlZF" +
  "9VXVtqeJmBanGQc1tdhbWGkJ6jq62rZ4C8ybqmx5moq6QBHB4eKCMoTisrTqRuXW6kpKSkpKSk" +
  "pKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpKSkpP/AABEIACQAMAMBEQ" +
  "ACEQEDEQH/xAGiAAABBQEBAQEBAQAAAAAAAAAAAQIDBAUGBwgJCgsQAAIBAwMCBAMFBQQEAAAB" +
  "fQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nz" +
  "g5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Sl" +
  "pqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+gEAAw" +
  "EBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoLEQACAQIEBAMEBwUEBAABAncAAQIDEQQFITEGEkFR" +
  "B2FxEyIygQgUQpGhscEJIzNS8BVictEKFiQ04SXxFxgZGiYnKCkqNTY3ODk6Q0RFRkdISUpTVF" +
  "VWV1hZWmNkZWZnaGlqc3R1dnd4eXqCg4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4" +
  "ubrCw8TFxsfIycrS09TV1tfY2dri4+Tl5ufo6ery8/T19vf4+fr/2gAMAwEAAhEDEQA/AMGmAt" +
  "AC0AFAC0ALQAygBaACgBaAFoAKAG0AFAC0ALQAUALQAygBaAFoAWgAoAWgBlAC0AFAC0ALQAtA" +
  "H//Z";

export function pendingCorrection(
  kind: PauseKind,
  nowMs: number,
  options?: { capped?: boolean },
): PendingCorrection {
  const capped = options?.capped === true;
  return {
    id: `dc-${kind === "phone" ? "0041" : "0042"}`,
    at: nowMs - 4_000,
    kind,
    modelLabel: kind === "phone" ? "phone" : "away",
    modelConfidence: kind === "phone" ? 0.94 : 0.88,
    frames: capped ? 0 : 3,
    expiresAt: nowMs - 4_000 + CORRECTION_ANSWER_WINDOW_MS,
    capped,
  };
}

function listItem(
  index: number,
  kind: PauseKind,
  verdict: CorrectionVerdict,
  nowMs: number,
): CorrectionListItem {
  const confidence = kind === "phone" ? 0.94 - index * 0.01 : 0.88;
  return {
    id: `dc-${String(index).padStart(4, "0")}`,
    at: nowMs - index * 33 * 60_000,
    day: "2026-03-12",
    kind,
    verdict,
    modelLabel: kind === "phone" ? "phone" : "away",
    modelConfidence: confidence,
    label: kind === "phone" ? (verdict === "wrong" ? "focused" : "phone") : (verdict === "wrong" ? "at_desk" : "away"),
    head: kind === "phone" ? "attention" : "presence",
    frames: 3,
    bytes: 98_000 + index * 2_000,
    capped: false,
    thumbnail: SWATCH,
    excludedBecause: excludedBecause(kind, verdict),
  };
}

/** Fourteen corrections: twelve phone (the refit pool) and two away. */
function items(count: number, nowMs: number): CorrectionListItem[] {
  return Array.from({ length: count }, (_unused, i) => {
    const index = i + 1;
    const kind: PauseKind = index % 7 === 0 ? "away" : "phone";
    const verdict: CorrectionVerdict = index % 3 === 0 ? "right" : "wrong";
    return listItem(index, kind, verdict, nowMs);
  });
}

function slice(images: number, groups: number, balanced: number): SliceScore {
  return {
    images,
    groups,
    accuracy: balanced + 0.01,
    balanced,
    presentLabels: ["focused", "phone", "unfocused"],
    phone: { precision: 0.58, recall: 0.61, f1: 0.59, support: 74 },
  };
}

function scores(pooled: number, personalCorrect: number | null): RefitScores {
  return {
    pooled: slice(286, 286, pooled),
    adaption: slice(200, 200, pooled + 0.01),
    proxy: slice(86, 86, pooled - 0.02),
    personalHoldout: personalCorrect === null ? null : slice(18, 6, 0.62),
    personalHoldoutGroupsCorrect: personalCorrect ?? 0,
  };
}

export function refitReport(installed: boolean, nowMs: number): RefitReport {
  const shipped = scores(0.619, 2);
  const personal = installed ? scores(0.626, 5) : scores(0.601, 2);
  return {
    v: 1,
    at: nowMs - 2 * 60 * 60_000,
    baseHeadHash: "9f2c1ab4e7d05613",
    anchorsHash: "4c81d0f2ab993ee1",
    lambda: 0.05,
    epochs: 300,
    learningRate: 0.05,
    driftRatio: installed ? 0.21 : 0.44,
    corrections: {
      total: installed ? 14 : 13,
      trainGroups: 7,
      evalGroups: 6,
      frames: installed ? 42 : 39,
      byLabel: { focused: 9, phone: 5 },
      trainIds: ["dc-0001", "dc-0003"],
      evalIds: ["dc-0002", "dc-0004"],
    },
    shipped,
    personal,
    gates: [
      { id: "not-custom-model", passed: true, detail: "deskModelId is custom." },
      { id: "session-active", passed: true, detail: "No session is running." },
      {
        id: "too-few-corrections",
        passed: true,
        detail: `${installed ? 14 : 13} corrections, ${CORRECTION_REFIT_MIN_GROUPS} needed.`,
      },
      { id: "too-few-train-groups", passed: true, detail: "7 train groups, 6 needed." },
      { id: "too-few-eval-groups", passed: true, detail: "6 eval groups, 3 needed." },
      { id: "stale-base", passed: true, detail: "Base head hash matches the shipped head." },
      { id: "stale-anchors", passed: true, detail: "Anchors match the base head." },
      {
        id: "drifted-too-far",
        passed: true,
        detail: `Moved ${installed ? "0.21" : "0.44"} of the trust region's 0.50.`,
      },
      {
        id: "regressed-pooled",
        passed: installed,
        detail: installed
          ? "62.6% against 61.9% pooled — not beaten."
          : "60.1% against 61.9% pooled — 1.8 points worse, so it does not run.",
      },
      {
        id: "regressed-slice",
        passed: installed,
        detail: installed ? "No slice dropped more than 3 points." : "Not reached.",
      },
      {
        id: "no-personal-gain",
        passed: installed,
        detail: installed
          ? "Agrees with you on 5 held-out corrections against the shipped head's 2."
          : "Not reached.",
      },
    ],
    blockedBy: installed ? null : "regressed-pooled",
    pooledMarginCi95: installed ? { point: 0.7, lo: -1.1, hi: 2.4, draws: 2000 } : null,
    installed,
    gateEnforced: true,
  };
}

function baseState(): DeskCorrectionsState {
  return {
    v: 1,
    enabled: true,
    available: true,
    pending: null,
    items: [],
    lifetimeCorrections: 0,
    bytes: 0,
    capped: false,
    cooldowns: [],
    refitReady: false,
    refitTrainGroups: 0,
    refitEvalGroups: 0,
    refitNeeded: CORRECTION_REFIT_MIN_GROUPS,
    activeHead: "shipped",
    lastRefit: null,
  };
}

function stored(count: number, nowMs: number): Partial<DeskCorrectionsState> {
  const list = items(count, nowMs);
  const pool = list.filter((item) => item.excludedBecause === null).length;
  return {
    items: list,
    lifetimeCorrections: count,
    bytes: list.reduce((total, item) => total + item.bytes, 0),
    refitReady: pool >= CORRECTION_REFIT_MIN_GROUPS,
    refitTrainGroups: Math.ceil(pool / 2),
    refitEvalGroups: Math.floor(pool / 2),
    refitNeeded: Math.max(0, CORRECTION_REFIT_MIN_GROUPS - pool),
  };
}

/** The seeded state for a scene, or null when it is not a corrections scene. */
export function correctionSceneState(
  scene: CorrectionScene | null,
  nowMs: number,
): DeskCorrectionsState | null {
  const base = baseState();
  switch (scene) {
    case "correction-phone":
      return {
        ...base,
        ...stored(7, nowMs),
        pending: pendingCorrection("phone", nowMs),
      };
    case "correction-away":
      return {
        ...base,
        ...stored(7, nowMs),
        pending: pendingCorrection("away", nowMs),
      };
    // The cap is a real state with real copy, and it is the one a demo never
    // reaches by accident.
    case "correction-capped":
      return {
        ...base,
        ...stored(9, nowMs),
        lifetimeCorrections: CORRECTION_CAP_GROUPS,
        capped: true,
        pending: pendingCorrection("phone", nowMs, { capped: true }),
      };
    case "corrections-empty":
      return base;
    case "corrections-list":
      return {
        ...base,
        ...stored(14, nowMs),
        cooldowns: [
          { kind: "phone", until: nowMs + 18 * 60_000, correctionId: "dc-0001" },
        ],
      };
    case "corrections-personal":
      return {
        ...base,
        ...stored(14, nowMs),
        activeHead: "personal",
        lastRefit: refitReport(true, nowMs),
      };
    case "corrections-failed":
      return {
        ...base,
        ...stored(13, nowMs),
        activeHead: "shipped",
        lastRefit: refitReport(false, nowMs),
      };
    default:
      return null;
  }
}
