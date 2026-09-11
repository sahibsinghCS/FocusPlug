import type { AppEntry, FocusSnapshot } from "../../shared/types.ts";
import { findMatchingEntry } from "./match.ts";

export interface BuildFocusSnapshotInput {
  processName: string;
  windowTitle: string;
  allowlist: AppEntry[];
  blocklist: AppEntry[];
  ts?: number;
}

export function buildFocusSnapshot(input: BuildFocusSnapshotInput): FocusSnapshot {
  const processName = input.processName;
  const windowTitle = input.windowTitle;
  const allowHit = findMatchingEntry(input.allowlist, processName, windowTitle);
  const blockHit = findMatchingEntry(input.blocklist, processName, windowTitle);

  const snapshot: FocusSnapshot = {
    ts: input.ts ?? Date.now(),
    processName,
    windowTitle,
    matchedAllow: allowHit !== undefined,
    matchedBlock: blockHit !== undefined,
  };

  if (blockHit !== undefined) {
    snapshot.blockEntryId = blockHit.id;
  }

  return snapshot;
}
