import type {
  CorrectionCase,
  CorrectionMeaning,
  CorrectionVerdict,
} from "./types";
import type { PauseKind } from "../nudge";

/**
 * The `kind x verdict` table — the whole meaning of a correction, in ONE
 * place, so main and the renderer cannot disagree about it.
 *
 * Four rows and no fifth: `PauseKind` has two members and a verdict has two
 * answers. `person` / `workspace` / `phoneCell` / `gaze` are DERIVED from the
 * verdict rather than observed, exactly as `buildCaptureRow` derives them for
 * a self-labelled clip, and the CSV `note` says so on every exported row.
 *
 * `docs/CORRECTION-LOOP.md § 1.2`.
 */
export const CORRECTION_MEANING: Readonly<Record<CorrectionCase, CorrectionMeaning>> = {
  "phone:wrong": {
    label: "focused", head: "attention",
    attention: "focused", packLabel: "focused",
    person: "face_or_body", workspace: "True", phoneCell: "none", gaze: "work",
    trainsPersonalHead: true, armsCooldown: true, retractsDrift: false,
  },
  "phone:right": {
    label: "phone", head: "attention",
    attention: "phone", packLabel: "phone",
    person: "face_or_body", workspace: "True", phoneCell: "in_use", gaze: "phone",
    trainsPersonalHead: true, armsCooldown: false, retractsDrift: false,
  },
  "away:wrong": {
    label: "at_desk", head: "presence",
    attention: "", packLabel: "at_desk",
    person: "face_or_body", workspace: "True", phoneCell: "none", gaze: "work",
    trainsPersonalHead: false, armsCooldown: true, retractsDrift: true,
  },
  "away:right": {
    label: "away", head: "presence",
    attention: "", packLabel: "away",
    person: "none", workspace: "True", phoneCell: "none", gaze: "elsewhere",
    trainsPersonalHead: false, armsCooldown: false, retractsDrift: false,
  },
};

export function correctionCase(kind: PauseKind, verdict: CorrectionVerdict): CorrectionCase {
  return `${kind}:${verdict}`;
}

/** Total over the product type: every `kind x verdict` has a row. */
export function correctionMeaning(
  kind: PauseKind,
  verdict: CorrectionVerdict,
): CorrectionMeaning {
  return CORRECTION_MEANING[correctionCase(kind, verdict)];
}

/**
 * `null` exactly when this correction enters the personal attention pool.
 * An `away` correction is presence evidence and is deliberately not refit
 * from — see `docs/CORRECTION-LOOP.md § 1.3` — and the review list says so on
 * the row rather than leaving the count on the refit button unexplained.
 */
export function excludedBecause(kind: PauseKind, verdict: CorrectionVerdict): string | null {
  return correctionMeaning(kind, verdict).trainsPersonalHead
    ? null
    : "presence evidence — not used to retrain";
}

/** Odd correction number trains, even evaluates — exactly `clipSplit`. */
export function correctionSplit(index: number): "train" | "eval" {
  return index % 2 === 1 ? "train" : "eval";
}
