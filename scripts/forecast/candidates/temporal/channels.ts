import { logCompress } from "../../../../src/shared/forecast/features";
import { titleHash } from "../../../../src/shared/forecast/hash";
import { deskPresence, focusKind, type DeskPresence, type FocusKind } from "../../../../src/shared/policy";
import type { RawSession, ReplayFrame } from "../../lib";

/**
 * Per-second RAW telemetry channels — the contender's whole point.
 *
 * The shipped model eats 18 pre-digested window aggregates (switches/15 s,
 * grey dwell/30 s, desk-confidence mean/std over 30 s, …): the window sizes,
 * the shapes and the "which statistic" choices are all hand-picked priors.
 * This builder instead emits the untouched 1 Hz signal itself — what the
 * classifier saw each second — and lets a strided convolution learn its own
 * windows, its own ramps and its own crescendos.
 *
 * Causality: second `t` is built from events with `ts <= t*1000` ONLY, the
 * same rule `replaySession`/`extractFeatures` obey, so a window ending at `t`
 * contains nothing the runtime would not have at `t`.
 *
 * Transition bookkeeping (first focus is not a switch; process-key change
 * beats title-hash change; keys normalized lower-case) mirrors
 * `TelemetryRing.noteFocus` exactly — the runtime ring already holds
 * everything these channels need (600 × 1 Hz frames + 128 transitions).
 */

export const TEMPORAL_CHANNEL_KEYS = [
  "focusNone", // no focus snapshot yet this second
  "focusAllow", // allowlisted window in the foreground
  "focusBlock", // blocklisted window in the foreground
  "focusOther", // grey (neither list)
  "procSwitch", // process switches closed in this second, min(n,3)/3
  "titleChange", // same-process title-hash changes in this second, min(n,3)/3
  "dwell", // log-compressed seconds on the current window
  "webcamOn", // desk sensor live
  "deskPresent", // policy's own presence verdict: at desk
  "deskAway", // policy's own presence verdict: away
  "deskConf", // desk confidence (0 when the webcam is off)
  "drifted", // policy decision was DISTRACTED/AWAY this second (past drifts)
] as const;

export type TemporalChannelKey = (typeof TEMPORAL_CHANNEL_KEYS)[number];
export const CHANNEL_COUNT = TEMPORAL_CHANNEL_KEYS.length;

/** Session-scale context the sequence window structurally cannot contain. */
export const CONTEXT_KEYS = ["sinceBlock", "streak", "sessionMin", "priorDrifts"] as const;
/** Indices of CONTEXT_KEYS inside FORECAST_FEATURE_KEYS (encoded feature vector). */
export const CONTEXT_FEATURE_INDEX = [8, 9, 14, 15];

const DESK_THRESHOLD = 0.6; // REPLAY_DESK_THRESHOLD — the shipped default

function focusOneHot(kind: FocusKind, out: Float64Array, at: number): void {
  out[at] = kind === "none" ? 1 : 0;
  out[at + 1] = kind === "allow" ? 1 : 0;
  out[at + 2] = kind === "block" ? 1 : 0;
  out[at + 3] = kind === "other" ? 1 : 0;
}

/**
 * Builds `[pad + durationSec] × CHANNEL_COUNT` row-major channels for one
 * session. The first `pad` rows are all-zero left padding so that the window
 * of the last `seqLen` seconds ending at second `t` is the contiguous slice
 * starting at `(t - 1) * CHANNEL_COUNT` when `pad === seqLen - 1`.
 *
 * `frames` is `replaySession(session)` output — used only for the `drifted`
 * channel, so the channel agrees with the policy decision the labeler used.
 */
export function buildChannels(
  session: RawSession,
  frames: readonly ReplayFrame[],
  pad: number,
): Float64Array {
  const duration = session.durationSec;
  const out = new Float64Array((pad + duration) * CHANNEL_COUNT);

  let focusIndex = 0;
  let deskIndex = 0;
  let hasFocus = false;
  let currentKey = "";
  let currentHash = 0;
  let currentKind: FocusKind = "none";
  let dwellStart = 0;
  let webcamOn = false;
  let confidence = 0;
  let presence: DeskPresence = "uncertain";

  for (let t = 1; t <= duration; t += 1) {
    const ts = t * 1000;
    let switches = 0;
    let titleChanges = 0;
    while (focusIndex < session.focus.length && (session.focus[focusIndex]?.ts ?? Infinity) <= ts) {
      const event = session.focus[focusIndex];
      focusIndex += 1;
      if (!event) {
        continue;
      }
      const kind = focusKind({
        ts: event.ts,
        processName: event.proc,
        windowTitle: event.title,
        matchedAllow: event.allow,
        matchedBlock: event.block,
      });
      const key = event.proc.trim().toLowerCase();
      const hash = titleHash(event.title);
      if (!hasFocus) {
        hasFocus = true;
        dwellStart = event.ts;
      } else if (key !== currentKey) {
        switches += 1;
        dwellStart = event.ts;
      } else if (hash !== currentHash) {
        titleChanges += 1;
      }
      currentKey = key;
      currentHash = hash;
      currentKind = kind;
    }
    while (deskIndex < session.desk.length && (session.desk[deskIndex]?.ts ?? Infinity) <= ts) {
      const event = session.desk[deskIndex];
      deskIndex += 1;
      if (!event) {
        continue;
      }
      webcamOn = event.on;
      confidence = Number.isFinite(event.conf) ? event.conf : 0;
      presence = deskPresence(
        { ts: event.ts, label: event.label, confidence: event.conf, webcamEnabled: event.on },
        DESK_THRESHOLD,
      );
    }

    const at = (pad + t - 1) * CHANNEL_COUNT;
    focusOneHot(currentKind, out, at);
    out[at + 4] = Math.min(switches, 3) / 3;
    out[at + 5] = Math.min(titleChanges, 3) / 3;
    out[at + 6] = hasFocus ? logCompress(Math.max(0, (ts - dwellStart) / 1000), 600) : 0;
    out[at + 7] = webcamOn ? 1 : 0;
    out[at + 8] = presence === "present" ? 1 : 0;
    out[at + 9] = presence === "away" ? 1 : 0;
    out[at + 10] = webcamOn ? Math.min(1, Math.max(0, confidence)) : 0;
    const frame = frames[t - 1];
    out[at + 11] =
      frame !== undefined && (frame.decision === "DISTRACTED" || frame.decision === "AWAY") ? 1 : 0;
  }
  return out;
}
