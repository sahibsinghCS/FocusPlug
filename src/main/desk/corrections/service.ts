import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CORRECTION_REFIT_MIN_EVAL_GROUPS,
  CORRECTION_REFIT_MIN_GROUPS,
  CORRECTION_REFIT_MIN_TRAIN_GROUPS,
} from "@shared/correction/constants";
import { liveCooldowns, silencedKinds, silencedUntil } from "@shared/correction/cooldown";
import { correctionMeaning } from "@shared/correction/meaning";
import {
  ATTENTION_HIDDEN_DIM,
  ATTENTION_LABELS,
  personalHeadFits,
} from "@shared/correction/refit";
import type {
  ActiveAttentionHead,
  CorrectionCooldown,
  DeskCorrectionsState,
  PlanRetraction,
  RecordCorrectionRequest,
  RecordCorrectionResult,
  RefitReport,
} from "@shared/correction/types";
import type { AppSettings } from "@shared/ipc";
import type { PauseKind } from "@shared/nudge";
import type { DeskModelId } from "@shared/types";
import { deskRoot } from "../assets";
import type { RetainedFrame } from "../frameRing";
import { PendingCaptureHolder } from "./capture";
import {
  ATTENTION_FEATURE_VERSION,
  ATTENTION_HEAD_FILE,
  personalAttentionHeadPath,
  refitReportPath,
} from "./paths";
import { CorrectionsStore, type CorrectionsFs } from "./store";

/**
 * The main-process owner of the correction loop's capture-and-store half.
 *
 * It is the only thing in the app that can create a file under
 * `desk-corrections/`, and every one of its methods is guarded: a correction
 * that fails costs the correction and NEVER the session. A pause is
 * enforcement; a correction is a convenience attached to it, and the two are
 * ordered accordingly at every seam.
 *
 * `docs/CORRECTION-LOOP.md § 2 – § 4`.
 */

export interface DeskCorrectionsOptions {
  userDataDir: string;
  loadSettings: () => AppSettings;
  /** One `correction · …` line per verdict, delete, clear and failure. */
  appendLog?: (detail: string) => void;
  /** CORRECTIONS_STATE fan-out. Absent in tests and headless runs. */
  push?: (state: DeskCorrectionsState) => void;
  now?: () => number;
  fs?: CorrectionsFs;
  /**
   * Focus Plan's retraction command, injected rather than imported: the desk
   * stack gains no seam into the coaching layer, exactly as the controller
   * gains none. Absent ⇒ no retraction is attempted and the record says so.
   */
  retractDrift?: (correctionId: string) => PlanRetraction | null;
  /**
   * The refit, injected rather than imported: `src/main/desk/corrections/
   * refit.ts` pulls in the desk model and TensorFlow, and the store must be
   * able to write a JPEG without any of that. Absent ⇒ the button refuses
   * with a sentence instead of throwing a stack trace.
   */
  refit?: (options?: { gate?: "off" }) => Promise<RefitReport>;
  /** Test seam for the shipped attention head whose hash a record stamps. */
  attentionHeadFile?: string;
  /**
   * Tell the desk model where the personal head is, or `null` for "run the
   * shipped one". Injected because pointing the model at a file means
   * importing the model, and the model imports TensorFlow — which the store
   * that writes a JPEG must never have to load.
   *
   * `force` means "the file at that path changed, not the path" — the model
   * must drop whatever it has cached even though the pointer did not move.
   */
  applyPersonalHead?: (file: string | null, options?: { force?: boolean }) => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : String(error);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * The student's own calendar day, stamped in MAIN — the pure core never
 * imports `Date`, which is what keeps it environment-agnostic.
 */
export function localDay(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export interface OpenPauseCapture {
  kind: PauseKind;
  at: number;
  frames: readonly RetainedFrame[];
  deskModelId: DeskModelId;
}

export class DeskCorrections {
  private readonly storeRef: CorrectionsStore;
  private readonly pending = new PendingCaptureHolder();
  private readonly loadSettings: () => AppSettings;
  private readonly appendLog: (detail: string) => void;
  private readonly push: ((state: DeskCorrectionsState) => void) | undefined;
  private readonly now: () => number;
  private readonly retractDrift: ((correctionId: string) => PlanRetraction | null) | undefined;
  private readonly refitFn: ((options?: { gate?: "off" }) => Promise<RefitReport>) | undefined;
  private readonly attentionHeadFile: string;
  private readonly applyPersonalHead:
    | ((file: string | null, options?: { force?: boolean }) => void)
    | undefined;
  private readonly userDataDir: string;
  /** First write failure ⇒ capture is off for the process. Reads and DELETE
   *  keep working: a student must always be able to erase their photographs,
   *  whatever went wrong while storing them. */
  private off = false;
  private headHash: string | null = null;

  constructor(options: DeskCorrectionsOptions) {
    this.userDataDir = options.userDataDir;
    this.storeRef = new CorrectionsStore({ userDataDir: options.userDataDir, fs: options.fs });
    this.loadSettings = options.loadSettings;
    this.appendLog = options.appendLog ?? (() => undefined);
    this.push = options.push;
    this.now = options.now ?? Date.now;
    this.retractDrift = options.retractDrift;
    this.refitFn = options.refit;
    this.attentionHeadFile = options.attentionHeadFile ?? join(deskRoot(), ATTENTION_HEAD_FILE);
    this.applyPersonalHead = options.applyPersonalHead;
    this.syncPersonalHead();
  }

  /** The student's 51 numbers, wherever this install keeps them. */
  personalHeadFile(): string {
    return personalAttentionHeadPath(this.userDataDir);
  }

  /** The store, for the refit — the ONLY caller, and it is handed one on
   *  purpose rather than opening `corrections.json` a second time. */
  store(): CorrectionsStore {
    return this.storeRef;
  }

  /**
   * Point the desk model at the personal head, or take it away.
   *
   * Called from the constructor, from the controller whenever settings move,
   * and after a refit. `personalAttentionHeadEnabled: false` passes `null`,
   * which is the whole of what that preference can do — a preference can
   * silence a head, and only the gate can install one.
   *
   * `force` is for the caller that changed the FILE and not the path — only
   * `clear()`. The ordinary settings sync must stay cheap: it runs on every
   * save and on every desk enable/disable, and a cache drop there would make
   * the next reading re-read weights for nothing.
   */
  syncPersonalHead(options?: { force?: boolean }): void {
    if (this.applyPersonalHead === undefined) {
      return;
    }
    let enabled = true;
    try {
      enabled = this.loadSettings().personalAttentionHeadEnabled !== false;
    } catch {
      // A settings read that failed must not silently switch a head on. The
      // shipped head is the safe answer to every question here.
      enabled = false;
    }
    try {
      this.applyPersonalHead(enabled ? this.personalHeadFile() : null, options);
    } catch (error) {
      this.safeLog(`could not switch the attention head · ${errorMessage(error)}`);
    }
  }

  /* ── the ring's switch ───────────────────────────────────────────────── */

  /**
   * Should the desk monitor retain frames at all?
   *
   * Three things, ANDed, and the last of them is why a default install never
   * captures anything: only `deskModelId: "custom"` can pause, and only a
   * pause can produce a correction. A `blazeface` install never holds a frame,
   * never writes a file and never shows a chip.
   */
  shouldCapture(settings: AppSettings = this.loadSettings()): boolean {
    if (this.off || settings.deskCorrectionsEnabled === false) {
      return false;
    }
    if (settings.deskModelId !== "custom") {
      return false;
    }
    return settings.pauseOnAwayEnabled === true || settings.pauseOnPhoneEnabled === true;
  }

  /* ── capture ─────────────────────────────────────────────────────────── */

  /**
   * A pause was raised: hold its frames and hand back the `correctionId` the
   * nudge carries, or `null` when there is nothing to offer a verdict about.
   *
   * Called BEFORE the pause reaches the renderer, which is the only ordering
   * that works — the renderer's pause stops the session, and a stopped session
   * tears the camera down.
   */
  openPause(input: OpenPauseCapture): string | null {
    if (this.off) {
      return null;
    }
    try {
      // Inside the guard: `loadSettings` reads a file, and a settings read
      // that fails must cost the correction rather than the pause.
      if (!this.shouldCapture()) {
        return null;
      }
      const held = this.pending.open({
        id: this.storeRef.nextId(),
        at: input.at,
        kind: input.kind,
        deskModelId: input.deskModelId,
        capped: this.storeRef.atCap(),
        frames: input.frames,
      });
      if (held === null) {
        return null;
      }
      this.publish();
      return held.id;
    } catch (error) {
      // Holding frames is not a write, so it does not latch: a settings read
      // that failed once must not cost every future correction. The pause this
      // one belonged to simply offers no verdict row.
      this.safeLog(`capture skipped · ${errorMessage(error)}`);
      this.pending.drop("stopped");
      return null;
    }
  }

  /**
   * Free the held bytes.
   *
   * NOT called when the session stops. The pause is what stops the session —
   * the renderer pauses, `Shell` calls `stopSession()`, the camera is released
   * — and dropping the capture there would destroy the correction on the very
   * event that created it, since "I was working" resumes the clock in the same
   * tap. What ends an unanswered offer is the answer window
   * (`CORRECTION_ANSWER_WINDOW_MS`), a newer pause, switching capture off, or
   * quitting. Nothing is ever written along the way.
   */
  dropPending(): void {
    this.pending.drop("stopped");
  }

  /* ── the immediate half ──────────────────────────────────────────────── */

  /**
   * The kinds `NudgeTracker` must treat as unsure right now — derived from the
   * records, so the resume that armed the cooldown cannot cancel it.
   */
  silencedKinds(now: number = this.now()): PauseKind[] {
    try {
      return silencedKinds(this.storeRef.corrections(), now);
    } catch {
      // A cooldown that cannot be computed is no cooldown: the app keeps
      // pausing, which is the pre-correction behaviour and is safe.
      return [];
    }
  }

  cooldowns(now: number = this.now()): CorrectionCooldown[] {
    try {
      return liveCooldowns(this.storeRef.corrections(), now);
    } catch {
      return [];
    }
  }

  /* ── the verdict ─────────────────────────────────────────────────────── */

  /**
   * Record a correction: the JPEGs, one JSON record, the cooldown it arms and
   * the Focus Plan retraction it asks for. It touches no weights.
   */
  record(request: RecordCorrectionRequest): RecordCorrectionResult {
    const now = this.now();
    // Built on demand rather than up front: `getState()` reads a thumbnail per
    // stored correction, and the happy path does not need a second copy of it.
    const refuse = (retraction: PlanRetraction | null = null): RecordCorrectionResult => ({
      recorded: false,
      correctionId: request?.correctionId ?? "",
      cooldown: null,
      retraction,
      state: this.getState(),
    });
    if (this.off) {
      return refuse();
    }
    const verdict = request?.verdict;
    if (verdict !== "wrong" && verdict !== "right") {
      return refuse();
    }
    const held = this.pending.take(request.correctionId, now);
    if (held === null) {
      // The offer lapsed, or this is a verdict about a pause that is no longer
      // on screen. Nothing is written, and the caller's resume is unaffected.
      return refuse();
    }
    const meaning = correctionMeaning(held.kind, verdict);
    const retraction = meaning.retractsDrift ? this.attemptRetraction(held.id) : null;
    try {
      const correction = this.storeRef.record({
        capture: held,
        verdict,
        day: localDay(held.at),
        baseHeadHash: this.baseHeadHash(),
        featureVersion: ATTENTION_FEATURE_VERSION,
        retraction:
          retraction === null
            ? null
            : {
                roundKey: retraction.roundKey ?? "",
                retractedAtSec: retraction.retractedAtSec,
                refusal: retraction.refusal,
              },
      });
      const photos = correction.capped
        ? "at the cap, no photos kept"
        : `${correction.frames.length} photo${correction.frames.length === 1 ? "" : "s"}`;
      this.safeLog(
        `${correction.id} · the model said ${correction.modelLabel} ` +
          `(${correction.modelConfidence.toFixed(2)}), you said ${correction.label} · ${photos}`,
      );
      const cooldown = meaning.armsCooldown
        ? silencedUntil(this.storeRef.corrections(), held.kind, now)
        : null;
      const state = this.getState();
      this.safePush(state);
      return {
        recorded: true,
        correctionId: correction.id,
        cooldown:
          cooldown === null
            ? null
            : { kind: cooldown.kind, until: cooldown.until, correctionId: cooldown.correctionId },
        retraction,
        state,
      };
    } catch (error) {
      this.trip(error);
      return refuse(retraction);
    }
  }

  private attemptRetraction(correctionId: string): PlanRetraction | null {
    if (this.retractDrift === undefined) {
      return null;
    }
    try {
      return this.retractDrift(correctionId);
    } catch (error) {
      // A retraction that fails costs the retraction and never the verdict:
      // the resume and the cooldown have already happened.
      this.safeLog(`retraction failed · ${errorMessage(error)}`);
      return null;
    }
  }

  /* ── review and delete ───────────────────────────────────────────────── */

  /**
   * Deleting is never latched off. Whatever else has gone wrong, a student who
   * asks for their photographs to be gone gets them gone.
   */
  delete(id: string): DeskCorrectionsState {
    try {
      if (this.storeRef.remove(typeof id === "string" ? id : "")) {
        this.safeLog(`deleted ${id} — its photos and the cooldown it armed are gone`);
      }
    } catch (error) {
      this.safeLog(`delete failed · ${errorMessage(error)}`);
    }
    const state = this.getState();
    this.safePush(state);
    return state;
  }

  clear(): DeskCorrectionsState {
    try {
      const before = this.storeRef.corrections().length;
      // Frames held for a pause nobody has answered are the student's
      // photographs too. *Delete all* means all of them.
      this.pending.drop("stopped");
      this.storeRef.clear();
      this.safeLog(
        `deleted all ${before} correction${before === 1 ? "" : "s"} — photos, index and any ` +
          "personal head. Your focus history keeps the drifts you retracted.",
      );
      // A store that could not be written can be written now: the directory it
      // failed into is gone.
      this.off = false;
    } catch (error) {
      this.safeLog(`delete all failed · ${errorMessage(error)}`);
    } finally {
      // Unlinking the head file is only half of removing it. The desk model
      // loads its weights once and keeps them for the lifetime of the
      // instance, and that instance outlives a session — so without this the
      // app would go on taking every reading with the layer fitted from the
      // photographs that just went, while `activeHead()` below re-reads the
      // now-missing file and truthfully reports "shipped". Running one head
      // and claiming the other is the exact failure `personalHeadFits` says
      // this feature exists to stop, and it must not happen on the privacy
      // action. `force` because the path did not move — only the file did.
      //
      // In `finally`, and unconditionally: a `clear()` that threw part way
      // may have taken the head with it, and dropping a cache is cheap and
      // safe whether it did or not. `syncPersonalHead` swallows its own
      // failures, so this can never turn a deletion into a thrown error.
      this.syncPersonalHead({ force: true });
    }
    const state = this.getState();
    this.safePush(state);
    return state;
  }

  /**
   * `<userData>/desk-corrections` — what *Reveal folder* opens.
   *
   * Created on demand, and ONLY here: a student who asks to see the folder
   * gets a folder, and an install that never asked has none. Seeing the actual
   * files is a stronger privacy guarantee than any sentence in the docs, so
   * this must not be the one button that fails on a clean machine.
   */
  revealPath(): string {
    try {
      this.storeRef.ensureRoot();
    } catch {
      // Reveal what is there. A directory that cannot be created is one the
      // OS file manager will report better than this could.
    }
    return this.storeRef.root();
  }

  /**
   * Fit the student's own output layer, gate it, and install it only if it
   * won. THE ONLY CALLER IS THE SETTINGS BUTTON: nothing on the pause path,
   * the verdict path or the store reaches this, which is what makes "one click
   * never retrains the model" a property of the call graph rather than a
   * promise — `no-retrain.test.ts` asserts it by spying on the write seam.
   *
   * The state is pushed afterwards whatever happened, because the report, the
   * gate that stopped it and which head is now running all changed on screen.
   */
  refit(options?: { gate?: "off" }): Promise<RefitReport> {
    // Deliberately not an `async` method: a build with no refit attached must
    // refuse LOUDLY and at the call, not hand back a promise that rejects a
    // tick later. Nothing has been read, nothing written, nothing fitted.
    if (this.refitFn === undefined) {
      throw new Error("The personal attention head is not available in this build");
    }
    return this.refitFn(options).finally(() => {
      this.publish();
    });
  }

  /* ── state ───────────────────────────────────────────────────────────── */

  getState(): DeskCorrectionsState {
    const now = this.now();
    let settings: AppSettings | null = null;
    try {
      settings = this.loadSettings();
    } catch {
      settings = null;
    }
    const attention = this.storeRef
      .corrections()
      .filter((correction) => correction.head === "attention");
    const trainGroups = attention.filter((correction) => correction.split === "train").length;
    const evalGroups = attention.filter((correction) => correction.split === "eval").length;
    return {
      v: 1,
      enabled: settings === null ? true : settings.deskCorrectionsEnabled !== false,
      available: settings !== null && settings.deskModelId === "custom",
      pending: this.pending.wire(now),
      items: this.safeList(),
      lifetimeCorrections: this.storeRef.lifetimeCorrections(),
      bytes: this.storeRef.bytes(),
      capped: this.storeRef.atCap(),
      cooldowns: this.cooldowns(now),
      refitReady:
        attention.length >= CORRECTION_REFIT_MIN_GROUPS &&
        trainGroups >= CORRECTION_REFIT_MIN_TRAIN_GROUPS &&
        evalGroups >= CORRECTION_REFIT_MIN_EVAL_GROUPS,
      refitTrainGroups: trainGroups,
      refitEvalGroups: evalGroups,
      refitNeeded: Math.max(0, CORRECTION_REFIT_MIN_GROUPS - attention.length),
      activeHead: this.activeHead(settings),
      lastRefit: this.lastRefit(),
    };
  }

  publish(): void {
    this.safePush(this.getState());
  }

  /**
   * A push that fails is a screen that did not update, and nothing more. In
   * particular it must never turn a correction that WAS written into one the
   * student is told was not — the same rule the log follows.
   */
  private safePush(state: DeskCorrectionsState): void {
    try {
      this.push?.(state);
    } catch (error) {
      console.error("Failed to push corrections state:", errorMessage(error));
    }
  }

  private safeList(): DeskCorrectionsState["items"] {
    try {
      return this.storeRef.list();
    } catch {
      return [];
    }
  }

  /**
   * Which head is running. A personal head exists only when the gate let one
   * in, and `personalAttentionHeadEnabled: false` turns it off again — a
   * preference, never a capability: it can only ever turn a head OFF.
   */
  private activeHead(settings: AppSettings | null): ActiveAttentionHead {
    if (settings !== null && settings.personalAttentionHeadEnabled === false) {
      return "shipped";
    }
    try {
      // The SAME predicate `YourModel` decides with, so the screen cannot
      // claim a head the arithmetic refused to wear. A head left behind by an
      // app update that shipped a new attention head fails the base-hash check
      // in both places, and both fall back to shipped.
      const parsed = this.storeRef.readJsonAt(personalAttentionHeadPath(this.userDataDir));
      return personalHeadFits(
        parsed,
        this.baseHeadHash(),
        ATTENTION_HIDDEN_DIM,
        ATTENTION_LABELS.length,
      )
        ? "personal"
        : "shipped";
    } catch {
      // Unreadable is shipped. A personal head that cannot be seen is not one
      // that should be claimed on screen.
      return "shipped";
    }
  }

  private lastRefit(): RefitReport | null {
    try {
      const parsed = this.storeRef.readJsonAt(refitReportPath(this.userDataDir));
      return typeof parsed === "object" && parsed !== null && (parsed as RefitReport).v === 1
        ? (parsed as RefitReport)
        : null;
    } catch {
      return null;
    }
  }

  /**
   * `sha256(attention-head.json).slice(0, 16)` at capture time.
   *
   * Stamped on every record so a cached activation computed against one head
   * can never be scored against another: if an app update ships a different
   * attention head the hashes disagree, the cache is invalid, and the JPEG —
   * the durable source of truth — regenerates it.
   */
  baseHeadHash(): string {
    if (this.headHash !== null) {
      return this.headHash;
    }
    try {
      const bytes = readFileSync(this.attentionHeadFile);
      this.headHash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    } catch {
      this.headHash = "";
    }
    return this.headHash;
  }

  /** First write failure ⇒ one log line and capture stops for the process. */
  private trip(error: unknown): void {
    if (this.off) {
      return;
    }
    this.off = true;
    this.pending.drop("stopped");
    this.safeLog(`off · ${errorMessage(error)}`);
  }

  /**
   * Logging must never take the corrections loop — or the session — down, and
   * in particular must never turn a correction that WAS written into one the
   * student is told was not.
   */
  private safeLog(detail: string): void {
    try {
      this.appendLog(detail);
    } catch {
      // Nothing to be done about a log that is gone; keep going.
    }
  }
}

export function createDeskCorrections(options: DeskCorrectionsOptions): DeskCorrections {
  return new DeskCorrections(options);
}

/** What `SessionController` is allowed to know about corrections. */
export interface CorrectionsSeam {
  shouldCapture(settings: AppSettings): boolean;
  openPause(input: OpenPauseCapture): string | null;
  silencedKinds(now: number): PauseKind[];
  dropPending(): void;
  /**
   * "Settings moved." Optional, so every existing double and every headless
   * run keeps working untouched. The controller is told nothing about which
   * head that implies — deciding that is this service's job, and running it is
   * the desk model's.
   */
  syncPersonalHead?(): void;
}
