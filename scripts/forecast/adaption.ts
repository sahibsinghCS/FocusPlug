import { readFileSync } from "node:fs";

/**
 * Adaption Labs client (sponsor path) — upload the canonical TRAIN-split seed
 * as prompt/completion JSONL, request minority-class augmentation, poll, and
 * download the generated rows.
 *
 * This client NEVER throws to its caller: every auth / network / non-2xx /
 * timeout failure comes back as a structured `AdaptionOutcome` so
 * build-dataset.ts can log one honest warning, fall back to the local
 * augmenter, exit 0, and stamp the truth into the dataset manifest. Today's
 * real state is a 403 ("Invalid token. Please sign in") on the first call —
 * the pipeline is built to degrade through exactly that.
 *
 * Downloaded rows are NOT trusted: build-dataset re-parses each prompt,
 * range-checks it, re-encodes it with the shared formulas, and drops
 * violations with counts recorded. Adaption-origin rows are train-only.
 */

export const ADAPTION_BASE_URL = "https://api.prod.adaptionlabs.ai/api/v1";
const REQUEST_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 5_000;
const MAX_POLLS = 36; // ≤ 3 min per polling phase

export interface AdaptionRow {
  prompt: string;
  completion: string;
}

export interface AdaptionOutcome {
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
  datasetId: string | null;
  augmentedDatasetId: string | null;
  rows: AdaptionRow[];
}

export function adaptionApiKey(): string | null {
  return process.env.ADAPTION_API_KEY || process.env.API_KEY || null;
}

interface ApiResponse {
  status: number;
  body: unknown;
  text: string;
}

async function api(
  key: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<ApiResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${ADAPTION_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed, text };
  } finally {
    clearTimeout(timer);
  }
}

function fail(
  error: string,
  httpStatus: number | null,
  datasetId: string | null = null,
  augmentedDatasetId: string | null = null,
): AdaptionOutcome {
  return { ok: false, httpStatus, error, datasetId, augmentedDatasetId, rows: [] };
}

function field(body: unknown, ...keys: string[]): unknown {
  if (typeof body !== "object" || body === null) {
    return undefined;
  }
  for (const key of keys) {
    const value = (body as Record<string, unknown>)[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }
  return undefined;
}

async function pollUntilReady(
  key: string,
  datasetId: string,
): Promise<{ ok: boolean; status: number; error: string | null }> {
  for (let attempt = 0; attempt < MAX_POLLS; attempt += 1) {
    const response = await api(key, "GET", `/datasets/${datasetId}/status`);
    if (response.status < 200 || response.status >= 300) {
      return { ok: false, status: response.status, error: `status poll HTTP ${response.status}` };
    }
    const status = String(field(response.body, "status") ?? "").toLowerCase();
    if (status === "ready" || status === "succeeded") {
      return { ok: true, status: response.status, error: null };
    }
    if (status === "failed") {
      // Partial rows may still download per the API docs — treat as ready-ish.
      return { ok: true, status: response.status, error: null };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { ok: false, status: 0, error: "status poll timed out" };
}

function parseDownloadRows(text: string): AdaptionRow[] {
  const rows: AdaptionRow[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    const prompt = field(parsed, "enhanced_prompt", "prompt");
    const completion = field(parsed, "enhanced_completion", "completion");
    if (typeof prompt === "string" && typeof completion === "string") {
      rows.push({ prompt, completion });
    }
  }
  return rows;
}

/**
 * Full sponsor round-trip: create dataset → presigned PUT → upload/complete →
 * poll → augment → poll → download JSONL. `seedFile` is the local
 * prompt/completion JSONL of train-split rows (eval rows are never uploaded).
 */
export async function runAdaptionAugment(
  seedFile: string,
  requestedRows: number,
): Promise<AdaptionOutcome> {
  const key = adaptionApiKey();
  if (!key) {
    return fail("no ADAPTION_API_KEY / API_KEY in environment", null);
  }
  try {
    // 1. Register the dataset (deferred adaption — we only want augmentation).
    const create = await api(key, "POST", "/datasets", {
      source: {
        name: "focusplug-forecast-train-seed",
        file_format: "jsonl",
        processing_mode: "raw",
        files: ["forecast-train-seed.jsonl"],
        column_mapping: { prompt: "prompt", completion: "completion" },
      },
      defer_adaption: true,
    });
    if (create.status < 200 || create.status >= 300) {
      return fail(
        `POST /datasets HTTP ${create.status}: ${create.text.slice(0, 120)}`,
        create.status,
      );
    }
    const datasetId = String(field(create.body, "dataset_id", "id") ?? "");
    if (!datasetId) {
      return fail("POST /datasets returned no dataset_id", create.status);
    }

    // 2. Presigned upload of the seed bytes, then completion notification.
    const instructions = field(create.body, "upload_instructions");
    const uploadUrl = String(field(instructions, "url") ?? "");
    const s3Key = field(instructions, "s3_key");
    if (uploadUrl) {
      const bytes = readFileSync(seedFile);
      const put = await fetch(uploadUrl, {
        method: String(field(instructions, "method") ?? "PUT"),
        body: bytes,
        headers: { "Content-Type": "application/octet-stream" },
      });
      if (!put.ok) {
        return fail(`presigned upload HTTP ${put.status}`, put.status, datasetId);
      }
      const complete = await api(key, "POST", "/datasets/upload/complete", {
        dataset_id: datasetId,
        ...(typeof s3Key === "string" ? { s3_key: s3Key } : {}),
      });
      if (complete.status < 200 || complete.status >= 300) {
        return fail(
          `upload/complete HTTP ${complete.status}`,
          complete.status,
          datasetId,
        );
      }
    }
    const seedReady = await pollUntilReady(key, datasetId);
    if (!seedReady.ok) {
      return fail(seedReady.error ?? "seed dataset never became ready", seedReady.status, datasetId);
    }

    // 3. Augment — minority-class expansion from the curated pool. The API
    //    returns a NEW dataset id; the original is left unchanged.
    const augment = await api(key, "POST", `/datasets/${datasetId}/augment`, {
      domain_rows: Math.max(1, Math.min(100_000, Math.round(requestedRows))),
    });
    if (augment.status < 200 || augment.status >= 300) {
      return fail(
        `POST /datasets/${datasetId}/augment HTTP ${augment.status}`,
        augment.status,
        datasetId,
      );
    }
    const augmentedId = String(field(augment.body, "dataset_id", "id") ?? "");
    if (!augmentedId) {
      return fail("augment returned no dataset_id", augment.status, datasetId);
    }
    const augmentedReady = await pollUntilReady(key, augmentedId);
    if (!augmentedReady.ok) {
      return fail(
        augmentedReady.error ?? "augmented dataset never became ready",
        augmentedReady.status,
        datasetId,
        augmentedId,
      );
    }

    // 4. Download the generated rows as JSONL.
    const download = await api(key, "GET", `/datasets/${augmentedId}/download?fileFormat=jsonl`);
    if (download.status < 200 || download.status >= 300) {
      return fail(`download HTTP ${download.status}`, download.status, datasetId, augmentedId);
    }
    return {
      ok: true,
      httpStatus: download.status,
      error: null,
      datasetId,
      augmentedDatasetId: augmentedId,
      rows: parseDownloadRows(download.text),
    };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), null);
  }
}
