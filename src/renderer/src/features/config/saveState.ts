import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus =
  | { status: "idle" }
  | { status: "saving" }
  | { status: "saved" }
  | { status: "error"; message: string };

export function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.trim().length > 0
    ? caught.message
    : fallback;
}

export function useSaveState(): {
  state: SaveStatus;
  saving: boolean;
  begin: () => void;
  succeed: () => void;
  fail: (message: string) => void;
  reset: () => void;
} {
  const [state, setState] = useState<SaveStatus>({ status: "idle" });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback((): void => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => () => clearTimer(), [clearTimer]);

  const begin = useCallback((): void => {
    clearTimer();
    setState({ status: "saving" });
  }, [clearTimer]);

  const succeed = useCallback((): void => {
    clearTimer();
    setState({ status: "saved" });
    timer.current = setTimeout(() => {
      setState({ status: "idle" });
      timer.current = null;
    }, 1600);
  }, [clearTimer]);

  const fail = useCallback(
    (message: string): void => {
      clearTimer();
      setState({ status: "error", message });
    },
    [clearTimer],
  );

  const reset = useCallback((): void => {
    clearTimer();
    setState({ status: "idle" });
  }, [clearTimer]);

  return { state, saving: state.status === "saving", begin, succeed, fail, reset };
}
