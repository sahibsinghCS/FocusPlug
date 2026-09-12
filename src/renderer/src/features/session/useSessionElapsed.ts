import { useEffect, useState } from "react";
import type { SessionEvent } from "@shared/ipc";
import { elapsedSeconds, findSessionStartedAt } from "./model";

export function useSessionElapsed(
  sessionActive: boolean,
  log: readonly SessionEvent[],
  sessionStartedAt: number | null,
): {
  now: number;
  startedAt: number | null;
  elapsedSec: number | null;
} {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sessionActive) {
      return;
    }
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [sessionActive]);

  // Prefer the log's "Session started" event; once the capped log trims it,
  // the provider-latched start (survives page remounts) takes over.
  const fromLog = findSessionStartedAt(log, sessionActive);
  const startedAt = fromLog ?? (sessionActive ? sessionStartedAt : null);
  return {
    now,
    startedAt,
    elapsedSec: elapsedSeconds(startedAt, now),
  };
}
