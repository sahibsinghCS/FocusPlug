import { useEffect, useRef, useState } from "react";
import type { SessionEvent } from "@shared/ipc";
import { elapsedSeconds, findSessionStartedAt } from "./model";

export function useSessionElapsed(
  sessionActive: boolean,
  log: readonly SessionEvent[],
): {
  now: number;
  startedAt: number | null;
  elapsedSec: number | null;
} {
  const observedAt = useRef<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!sessionActive) {
      observedAt.current = null;
      return;
    }
    observedAt.current ??= Date.now();
    const id = window.setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(id);
    };
  }, [sessionActive]);

  const fromLog = findSessionStartedAt(log, sessionActive);
  const startedAt = fromLog ?? (sessionActive ? observedAt.current : null);
  return {
    now,
    startedAt,
    elapsedSec: elapsedSeconds(startedAt, now),
  };
}
