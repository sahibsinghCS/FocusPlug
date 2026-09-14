import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  ATTENTION_LABELS,
  attentionHidden,
  correctionPool,
  evaluateRefit,
  shippedOutputLayer,
  type AttentionAnchorRow,
  type AttentionAnchors,
  type AttentionHeadShape,
} from "@shared/correction/refit";
import type { PersonalAttentionHead, RefitReport } from "@shared/correction/types";
import type { AttentionLabel, DeskModelId } from "@shared/types";
import { deskRoot } from "../assets";
import { decodeImageBuffer } from "../frame";
import { clearSharedDeskModel } from "../model/factory";
import {
  ATTENTION_ANCHORS_RELATIVE_PATH,
  ATTENTION_HEAD_LABELS,
  ATTENTION_HEAD_RELATIVE_PATH,
  attentionHeadHash,
  extractDeskFeatures,
  loadDeskHeadWeights,
} from "../model/your-model";
import { correctionFilePath, personalAttentionHeadPath, refitReportPath } from "./paths";
import type { CorrectionsStore } from "./store";

/**
 * The app's IO shell around the refit and its gate — the deferred half of the
 * correction loop, on the student's own machine.
 *
 * IT DECIDES NOTHING. Every judgement — the fit, the eleven gates, the two
 * scores, the bootstrap printed beside them — is `src/shared/correction/
 * refit.ts`, which is pure, has no clock and no filesystem, and is the SAME
 * module `scripts/desk-model/refit-attention.ts` runs on a developer's laptop.
 * This file reads bytes, hands them over, and writes back what it is told to.
 * That is the whole point: a gate that could be talked out of it by the caller
 * would not be a gate.
 *
 * WHAT IT WRITES, and nowhere else:
 *
 *   <userData>/desk-corrections/refit-report.json            always
 *   <userData>/desk-corrections/personal-attention-head.json only when the
 *                                                            gate passed; and
 *                                                            DELETED when it
 *                                                            did not
 *   <userData>/desk-corrections/corrections.json             activation cache
 *                                                            only, through the
 *                                                            store
 *
 * It never opens `src/main/desk/model/weights/attention-head.json` for
 * writing. On a packaged install that file is inside a read-only bundle, and
 * on a dev checkout it is a committed artifact that only
 * `scripts/desk-model/train-attention.ts` produces. A personal head is 51
 * numbers in the student's own directory, and the 1280→16 representation it
 * is anchored to is physically not in that file.
 *
 * NOTHING LEAVES THE MACHINE. There is no network import here and none is
 * added. The only way a correction reaches a developer is a student running
 * `npm run corrections:export` themselves, on their own copy.
 *
 * `docs/CORRECTION-LOOP.md § 6 – § 8`.
 */

export interface RefitDeps {
  store: CorrectionsStore;
  userDataDir: string;
  /** `deskModelId` — the refit refuses on anything but `"custom"` (gate 1). */
  deskModelId: () => DeskModelId;
  /** Gate 2. A session running is a measurement in progress. */
  sessionActive: () => boolean;
  appendLog?: (detail: string) => void;
  now?: () => number;
  /** Test seams. Production reads the committed defaults. */
  attentionHeadFile?: string;
  anchorsFile?: string;
}

/** `{ gate: "off" }` is the dev escape hatch of §7.5. It stamps itself. */
export interface RefitOptions {
  gate?: "off";
}

function writeJsonAtomic(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(tmp, file);
}

function isFiniteNumberArray(value: unknown, length: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  );
}

function isAttentionLabel(value: unknown): value is AttentionLabel {
  return typeof value === "string" && (ATTENTION_LABELS as readonly string[]).includes(value);
}

/**
 * The committed anchor pack: 286 held-out stock images as 16 activations and a
 * truth, and the sha of the head they were computed against.
 *
 * A row that does not parse is dropped rather than throwing, and an unreadable
 * pack returns `null` — which fails the `stale-anchors` gate with a sentence
 * that says to rebuild it, instead of failing the button with a stack trace.
 */
export function loadAnchors(file: string): { anchors: AttentionAnchors; hash: string } | null {
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    return null;
  }
  const pack = parsed as AttentionAnchors;
  if (
    typeof pack !== "object" ||
    pack === null ||
    pack.v !== 1 ||
    typeof pack.baseHeadHash !== "string" ||
    typeof pack.hiddenDim !== "number" ||
    !Array.isArray(pack.labels) ||
    pack.labels.length !== ATTENTION_LABELS.length ||
    pack.labels.some((label, index) => label !== ATTENTION_LABELS[index]) ||
    !Array.isArray(pack.rows)
  ) {
    return null;
  }
  const rows: AttentionAnchorRow[] = [];
  for (const row of pack.rows) {
    if (
      typeof row?.path === "string" &&
      (row.slice === "adaption" || row.slice === "proxy") &&
      isAttentionLabel(row.truth) &&
      isFiniteNumberArray(row.hidden, pack.hiddenDim)
    ) {
      rows.push({ path: row.path, slice: row.slice, truth: row.truth, hidden: row.hidden });
    }
  }
  return { anchors: { ...pack, rows }, hash: sha16(bytes) };
}

/** sha256, first 16 hex — the same definition `baseHeadHash` uses. */
function sha16(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

/**
 * The empty pack an unreadable anchors file degrades to.
 *
 * Handing `evaluateRefit` a pack with no rows is what turns "I could not read
 * the eval" into the `stale-anchors` gate refusing, with a sentence naming the
 * command that rebuilds it — rather than into an exception on a button.
 */
function emptyAnchors(baseHeadHash: string): AttentionAnchors {
  return { v: 1, baseHeadHash, hiddenDim: 0, labels: ATTENTION_LABELS, rows: [] };
}

export class PersonalRefit {
  private readonly deps: RefitDeps;
  private readonly now: () => number;
  private readonly attentionHeadFile: string;
  private readonly anchorsFile: string;

  constructor(deps: RefitDeps) {
    this.deps = deps;
    this.now = deps.now ?? Date.now;
    this.attentionHeadFile =
      deps.attentionHeadFile ?? join(deskRoot(), ATTENTION_HEAD_RELATIVE_PATH);
    this.anchorsFile = deps.anchorsFile ?? join(deskRoot(), ATTENTION_ANCHORS_RELATIVE_PATH);
  }

  /**
   * Recompute the 16 bottleneck activations for every attention frame that has
   * none for the running head, and cache them back into `corrections.json`.
   *
   * THE JPEG IS THE SOURCE OF TRUTH and the activation is only ever a cache —
   * which is what makes an app update that ships a different attention head
   * survivable: the hashes stop matching, every cached number is thrown away,
   * and this reads the student's photographs again. A photo that is gone (they
   * deleted it by hand) costs its frame and nothing else.
   *
   * About a second per photo on the CPU backend, which is why gate 2 refuses
   * to do it while a session is running.
   */
  private async fillActivations(head: AttentionHeadShape, baseHeadHash: string): Promise<number> {
    const updates: { id: string; file: string; hidden: number[]; hiddenFor: string }[] = [];
    for (const correction of this.deps.store.corrections()) {
      if (correction.head !== "attention") {
        continue;
      }
      for (const frame of correction.frames) {
        if (frame.hidden !== null && frame.hiddenFor === baseHeadHash) {
          continue;
        }
        const file = correctionFilePath(this.deps.userDataDir, frame.file);
        try {
          const image = decodeImageBuffer(readFileSync(file));
          const { vector } = await extractDeskFeatures(image);
          updates.push({
            id: correction.id,
            file: frame.file,
            hidden: attentionHidden(head, vector),
            hiddenFor: baseHeadHash,
          });
        } catch (error) {
          // One unreadable photo drops one frame from one correction. The
          // correction keeps its other photos, and a correction that loses all
          // of them is counted by `correctionPool` as `missing` and named in
          // the report rather than silently vanishing from the census.
          this.log(
            `could not read ${correction.id}/${frame.file} — its activation was not recomputed ` +
              `(${error instanceof Error ? error.message : String(error)})`,
          );
        }
      }
    }
    // One write for the whole batch: see `CorrectionsStore.setFramesHidden`.
    return this.deps.store.setFramesHidden(updates);
  }

  /**
   * Fit, gate, and install or refuse. Always returns a report; the report is
   * the product, and `installed: false` is a perfectly good one.
   */
  async run(options?: RefitOptions): Promise<RefitReport> {
    const gateEnforced = options?.gate !== "off";
    const head = loadDeskHeadWeights(this.attentionHeadFile, ATTENTION_HEAD_LABELS);
    const baseHeadHash = attentionHeadHash(this.attentionHeadFile);
    if (head === null) {
      throw new Error(
        `The shipped attention head at ${this.attentionHeadFile} could not be read, so there is ` +
          "nothing to refit and nothing to score against.",
      );
    }
    const loaded = loadAnchors(this.anchorsFile);

    // The whole reason gate 2 exists: this is a second of CPU per photo.
    const filled = await this.fillActivations(head, baseHeadHash);
    if (filled > 0) {
      this.log(`recomputed ${filled} activation(s) from your photos for head ${baseHeadHash}`);
    }

    const pool = correctionPool(this.deps.store.corrections(), baseHeadHash);
    const outcome = evaluateRefit({
      at: this.now(),
      deskModelId: this.deps.deskModelId(),
      sessionActive: this.deps.sessionActive(),
      baseHeadHash,
      anchors: loaded?.anchors ?? emptyAnchors(baseHeadHash),
      anchorsHash: loaded?.hash ?? "",
      base: shippedOutputLayer(head),
      groups: pool.groups,
      staleGroups: pool.stale.length,
      gateEnforced,
    });

    writeJsonAtomic(refitReportPath(this.deps.userDataDir), outcome.report);

    const headFile = personalAttentionHeadPath(this.deps.userDataDir);
    if (outcome.personal === null) {
      // A refit that did not pass leaves NO head behind — not an inactive one
      // for a later bug to load by accident.
      const existed = existsSync(headFile);
      if (existed) {
        rmSync(headFile, { force: true });
      }
      this.log(
        `refit refused by ${outcome.report.blockedBy ?? "no gate"} — the shipped head keeps ` +
          `running${existed ? ", and the previous personal head was removed" : ""}`,
      );
    } else {
      const personal: PersonalAttentionHead = {
        v: 1,
        baseHeadHash,
        labels: ATTENTION_LABELS,
        output: outcome.personal,
        fittedAt: outcome.report.at,
        report: outcome.report,
      };
      writeJsonAtomic(headFile, personal);
      const shipped = outcome.report.shipped.pooled.balanced * 100;
      const fitted = outcome.report.personal.pooled.balanced * 100;
      this.log(
        `personal head installed — ${fitted.toFixed(2)}% balanced on the ` +
          `${outcome.report.personal.pooled.images} held-out stock images against the shipped ` +
          `head's ${shipped.toFixed(2)}%` +
          (gateEnforced ? "" : ", WITH THE GATE OFF: nothing showed it is no worse"),
      );
    }

    // Whatever happened, the cached model instance is now wrong: it is either
    // wearing a head that was just deleted or missing one that was just
    // written. Dropping it makes the very next reading use the right layer.
    clearSharedDeskModel();
    return outcome.report;
  }

  private log(detail: string): void {
    try {
      this.deps.appendLog?.(detail);
    } catch {
      // A log that is gone must never turn a refit that ran into one the
      // student is told did not.
    }
  }
}

export function createPersonalRefit(deps: RefitDeps): PersonalRefit {
  return new PersonalRefit(deps);
}
