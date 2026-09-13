import { deskPresence, focusKind } from "../policy";
import type { DeskPresence, FocusKind } from "../policy";
import type { Decision, DeskSnapshot, FocusSnapshot } from "../types";
import { titleHash } from "./hash";

/**
 * Session telemetry ring — the forecast's only memory. Preallocated, O(1)
 * writes, ~45 KB total. Three stores:
 *
 * 1. Frame ring: one coalesced `TelemetryFrame` per wall second (last-writer-
 *    wins across the 4 Hz snapshots), capacity 600 (10 min).
 * 2. Transition list: the last 128 focus transitions — exact switch/churn
 *    counts, because 1 Hz frames under-count fast alt-tabbing. `"title"`
 *    entries are same-process title-hash changes; the title string itself is
 *    never stored.
 * 3. Scalar session state: session start, last block-focus sighting, drift
 *    onsets so far, current allow-streak start, current-window dwell start.
 *
 * The ring is pure bookkeeping: no clock of its own (all time comes from
 * snapshot `ts` values), no I/O, no policy re-derivation — `focusKind` /
 * `deskPresence` come from `@shared/policy` so the forecast sees the world
 * exactly as policy does. `reset()` on session start; the ring is empty
 * between sessions (monitors do not run then).
 */

export const FRAME_CAPACITY = 600;
export const TRANSITION_CAPACITY = 128;

export interface TelemetryFrame {
  ts: number;
  focusKind: FocusKind;
  /** Raw process key — memory only, never persisted (recorder hashes it). */
  processKey: string;
  titleHash: number;
  deskPresence: DeskPresence;
  deskConfidence: number;
  webcamEnabled: boolean;
}

export type TransitionKind = "proc" | "title";

export interface Transition {
  ts: number;
  kind: TransitionKind;
  /** Process keys for `"proc"`, decimal title hashes for `"title"`. */
  fromKey: string;
  toKey: string;
  toFocusKind: FocusKind;
}

function normalizeProcessKey(processName: string): string {
  return processName.trim().toLowerCase();
}

function isDrifted(decision: Decision): boolean {
  return decision === "DISTRACTED" || decision === "AWAY";
}

export class TelemetryRing {
  private readonly frameSlots: Array<TelemetryFrame | null> = new Array(FRAME_CAPACITY).fill(null);
  private frameHead = 0; // next write slot
  private frameSize = 0;
  private lastCommitTs: number | null = null;

  private readonly transitionSlots: Array<Transition | null> =
    new Array(TRANSITION_CAPACITY).fill(null);
  private transitionHead = 0;
  private transitionSize = 0;

  // Pending 4 Hz state, coalesced into one frame per commit (last-writer-wins).
  private pendingFocusKind: FocusKind = "none";
  private pendingProcessKey = "";
  private pendingTitleHash = 0;
  private pendingDeskPresence: DeskPresence = "uncertain";
  private pendingDeskConfidence = 0;
  private pendingWebcamEnabled = false;
  private hasFocus = false;

  // Scalar session state.
  private startTs = 0;
  private blockFocusTs: number | null = null;
  private drifts = 0;
  private streakTs: number | null = null;
  private dwellTs: number | null = null;
  private wasDrifted = false;

  constructor(sessionStartTs = 0) {
    this.startTs = sessionStartTs;
  }

  /** Clears everything — called when a session starts. */
  reset(sessionStartTs: number): void {
    this.frameSlots.fill(null);
    this.frameHead = 0;
    this.frameSize = 0;
    this.lastCommitTs = null;
    this.transitionSlots.fill(null);
    this.transitionHead = 0;
    this.transitionSize = 0;
    this.pendingFocusKind = "none";
    this.pendingProcessKey = "";
    this.pendingTitleHash = 0;
    this.pendingDeskPresence = "uncertain";
    this.pendingDeskConfidence = 0;
    this.pendingWebcamEnabled = false;
    this.hasFocus = false;
    this.startTs = sessionStartTs;
    this.blockFocusTs = null;
    this.drifts = 0;
    this.streakTs = null;
    this.dwellTs = null;
    this.wasDrifted = false;
  }

  /** Latest focus snapshot — records exact proc/title transitions. */
  noteFocus(snap: FocusSnapshot): void {
    if (!Number.isFinite(snap.ts)) {
      return;
    }
    const kind = focusKind(snap);
    const key = normalizeProcessKey(snap.processName);
    const hash = titleHash(snap.windowTitle);
    if (!this.hasFocus) {
      // First focus of the session sets the current window — not a switch.
      this.hasFocus = true;
      this.dwellTs = snap.ts;
    } else if (key !== this.pendingProcessKey) {
      this.pushTransition({
        ts: snap.ts,
        kind: "proc",
        fromKey: this.pendingProcessKey,
        toKey: key,
        toFocusKind: kind,
      });
      this.dwellTs = snap.ts;
    } else if (hash !== this.pendingTitleHash) {
      this.pushTransition({
        ts: snap.ts,
        kind: "title",
        fromKey: String(this.pendingTitleHash),
        toKey: String(hash),
        toFocusKind: kind,
      });
    }
    this.pendingFocusKind = kind;
    this.pendingProcessKey = key;
    this.pendingTitleHash = hash;
    if (kind === "block") {
      this.blockFocusTs = snap.ts;
    }
    if (kind === "allow") {
      if (this.streakTs === null) {
        this.streakTs = snap.ts;
      }
    } else {
      this.streakTs = null;
    }
  }

  /** Latest desk snapshot, classified with policy's own presence rule. */
  noteDesk(snap: DeskSnapshot, deskThreshold: number): void {
    if (!Number.isFinite(snap.ts)) {
      return;
    }
    this.pendingDeskPresence = deskPresence(snap, deskThreshold);
    this.pendingDeskConfidence = Number.isFinite(snap.confidence) ? snap.confidence : 0;
    this.pendingWebcamEnabled = snap.webcamEnabled === true;
  }

  /** Authoritative decision from tapped `status` events — counts drift onsets. */
  noteStatus(decision: Decision): void {
    const drifted = isDrifted(decision);
    if (drifted && !this.wasDrifted) {
      this.drifts += 1;
    }
    this.wasDrifted = drifted;
  }

  /**
   * Closes the 1 Hz frame at `ts` from the coalesced pending state. Returns
   * the committed frame, or null when `ts` is not strictly after the last
   * committed frame (the monitor drives commits from the injected clock).
   */
  commit(ts: number): TelemetryFrame | null {
    if (!Number.isFinite(ts)) {
      return null;
    }
    if (this.lastCommitTs !== null && ts <= this.lastCommitTs) {
      return null;
    }
    const frame: TelemetryFrame = {
      ts,
      focusKind: this.pendingFocusKind,
      processKey: this.pendingProcessKey,
      titleHash: this.pendingTitleHash,
      deskPresence: this.pendingDeskPresence,
      deskConfidence: this.pendingDeskConfidence,
      webcamEnabled: this.pendingWebcamEnabled,
    };
    this.frameSlots[this.frameHead] = frame;
    this.frameHead = (this.frameHead + 1) % FRAME_CAPACITY;
    if (this.frameSize < FRAME_CAPACITY) {
      this.frameSize += 1;
    }
    this.lastCommitTs = ts;
    return frame;
  }

  /** Frames with `fromTs < frame.ts <= toTs`, oldest first. */
  framesInRange(fromTs: number, toTs: number): TelemetryFrame[] {
    const out: TelemetryFrame[] = [];
    const start = (this.frameHead - this.frameSize + FRAME_CAPACITY * 2) % FRAME_CAPACITY;
    for (let i = 0; i < this.frameSize; i += 1) {
      const frame = this.frameSlots[(start + i) % FRAME_CAPACITY];
      if (frame && frame.ts > fromTs && frame.ts <= toTs) {
        out.push(frame);
      }
    }
    return out;
  }

  /** Transitions with `fromTs < t.ts <= toTs`, oldest first, optionally by kind. */
  transitionsInRange(fromTs: number, toTs: number, kind?: TransitionKind): Transition[] {
    const out: Transition[] = [];
    const start =
      (this.transitionHead - this.transitionSize + TRANSITION_CAPACITY * 2) % TRANSITION_CAPACITY;
    for (let i = 0; i < this.transitionSize; i += 1) {
      const transition = this.transitionSlots[(start + i) % TRANSITION_CAPACITY];
      if (
        transition &&
        transition.ts > fromTs &&
        transition.ts <= toTs &&
        (kind === undefined || transition.kind === kind)
      ) {
        out.push(transition);
      }
    }
    return out;
  }

  get sessionStartTs(): number {
    return this.startTs;
  }

  get lastBlockFocusTs(): number | null {
    return this.blockFocusTs;
  }

  get driftCount(): number {
    return this.drifts;
  }

  get streakStartTs(): number | null {
    return this.streakTs;
  }

  /** When the current foreground window took focus (dwell anchor). */
  get currentProcSince(): number | null {
    return this.dwellTs;
  }

  get currentProcessKey(): string {
    return this.pendingProcessKey;
  }

  get currentFocusKind(): FocusKind {
    return this.pendingFocusKind;
  }

  get frameCount(): number {
    return this.frameSize;
  }

  get transitionCount(): number {
    return this.transitionSize;
  }

  private pushTransition(transition: Transition): void {
    this.transitionSlots[this.transitionHead] = transition;
    this.transitionHead = (this.transitionHead + 1) % TRANSITION_CAPACITY;
    if (this.transitionSize < TRANSITION_CAPACITY) {
      this.transitionSize += 1;
    }
  }
}
