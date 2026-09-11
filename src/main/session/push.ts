import type {
  DeskSnapshot,
  FocusSnapshot,
  PolicyEvent,
  SessionEvent,
  SessionState,
} from "../../shared/ipc.ts";

/** Main → renderer fan-out. Electron fills this with webContents.send. */
export interface SessionPush {
  sessionState(state: SessionState): void;
  policyEvent(event: PolicyEvent): void;
  focusSnapshot(snap: FocusSnapshot): void;
  deskSnapshot(snap: DeskSnapshot): void;
  sessionEvent(event: SessionEvent): void;
}

export function silentPush(): SessionPush {
  return {
    sessionState: () => undefined,
    policyEvent: () => undefined,
    focusSnapshot: () => undefined,
    deskSnapshot: () => undefined,
    sessionEvent: () => undefined,
  };
}
