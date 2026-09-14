import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  DeskCorrectionsState,
  RecordCorrectionRequest,
  RecordCorrectionResult,
  RefitReport,
} from "@shared/correction/types";
import type { FocusPlugApi } from "@shared/ipc";
import { getApi } from "../../lib/api";

/**
 * The correction loop's own read of main: the stored corrections, the pending
 * pause waiting for a verdict, the live cooldowns and which attention head is
 * running.
 *
 * Deliberately not folded into `AppState`. Nothing in the session loop's own
 * state has to know this feature exists — the same reason Focus Plan keeps its
 * fetch in `useFocusPlan` — and it means the paused screen can ask for the
 * pending capture without the console's state tree gaining a field that is
 * null on every install that cannot pause.
 *
 * Every call is feature-detected. The preload of an older build, `probe.ts`
 * and the smoke scripts do not expose these channels, and a missing channel
 * must degrade to "no corrections" rather than throw on a screen that is about
 * to restart a study clock.
 */

export const EMPTY_CORRECTIONS_STATE: DeskCorrectionsState = {
  v: 1,
  enabled: false,
  available: false,
  pending: null,
  items: [],
  lifetimeCorrections: 0,
  bytes: 0,
  capped: false,
  cooldowns: [],
  refitReady: false,
  refitTrainGroups: 0,
  refitEvalGroups: 0,
  refitNeeded: 0,
  activeHead: "shipped",
  lastRefit: null,
};

type CorrectionCapableApi = FocusPlugApi & {
  correctionsGetState?: () => Promise<DeskCorrectionsState>;
  correctionsRecord?: (request: RecordCorrectionRequest) => Promise<RecordCorrectionResult>;
  correctionsDelete?: (id: string) => Promise<DeskCorrectionsState>;
  correctionsClear?: () => Promise<DeskCorrectionsState>;
  correctionsReveal?: () => Promise<void>;
  correctionsRefit?: (options?: { gate?: "off" }) => Promise<RefitReport>;
  onCorrectionsState?: (cb: (state: DeskCorrectionsState) => void) => () => void;
};

type CorrectionApi = Required<
  Pick<
    CorrectionCapableApi,
    | "correctionsGetState"
    | "correctionsRecord"
    | "correctionsDelete"
    | "correctionsClear"
    | "correctionsReveal"
    | "correctionsRefit"
    | "onCorrectionsState"
  >
>;

function hasCorrectionChannels(api: FocusPlugApi): api is CorrectionApi & FocusPlugApi {
  const candidate = api as CorrectionCapableApi;
  return (
    typeof candidate.correctionsGetState === "function" &&
    typeof candidate.correctionsRecord === "function" &&
    typeof candidate.correctionsDelete === "function" &&
    typeof candidate.correctionsClear === "function" &&
    typeof candidate.correctionsReveal === "function" &&
    typeof candidate.correctionsRefit === "function" &&
    typeof candidate.onCorrectionsState === "function"
  );
}

export interface CorrectionsHandle {
  state: DeskCorrectionsState;
  /** The first fetch has resolved, or the channels were found missing. */
  ready: boolean;
  /** A write is in flight. The chips and the refit disable off this. */
  busy: boolean;
  error: string | null;
  /**
   * Record a verdict. Resolves with main's answer — the cooldown it armed and
   * the Focus Plan retraction it asked for — or null when the channel is not
   * there. NEVER rejects: the caller's resume must not depend on it.
   */
  record: (request: RecordCorrectionRequest) => Promise<RecordCorrectionResult | null>;
  remove: (id: string) => Promise<void>;
  clear: () => Promise<void>;
  reveal: () => Promise<void>;
  /** The separate, explicit refit. Resolves with the report, gate and all. */
  refit: () => Promise<RefitReport | null>;
}

function message(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message.trim().length > 0 ? caught.message : fallback;
}

export function useCorrections(): CorrectionsHandle {
  const handle = useMemo(() => getApi(), []);
  const { api } = handle;
  const [state, setState] = useState<DeskCorrectionsState>(EMPTY_CORRECTIONS_STATE);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    if (!hasCorrectionChannels(api)) {
      setReady(true);
      return;
    }
    void api
      .correctionsGetState()
      .then((next) => {
        if (live) {
          setState(next);
          setReady(true);
        }
      })
      .catch((caught: unknown) => {
        if (live) {
          setError(message(caught, "Could not read your corrections"));
          setReady(true);
        }
      });
    const off = api.onCorrectionsState((next) => {
      setState(next);
    });
    return () => {
      live = false;
      off();
    };
  }, [api]);

  const record = useCallback(
    async (request: RecordCorrectionRequest): Promise<RecordCorrectionResult | null> => {
      if (!hasCorrectionChannels(api)) {
        return null;
      }
      setBusy(true);
      try {
        const result = await api.correctionsRecord(request);
        setState(result.state);
        setError(null);
        return result;
      } catch (caught) {
        // A failed record costs the record. The clock is the student's either
        // way, which is why the caller resumes without waiting on this.
        setError(message(caught, "Could not save that correction"));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const remove = useCallback(
    async (id: string): Promise<void> => {
      if (!hasCorrectionChannels(api)) {
        return;
      }
      setBusy(true);
      try {
        setState(await api.correctionsDelete(id));
        setError(null);
      } catch (caught) {
        setError(message(caught, "Could not delete that correction"));
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const clear = useCallback(async (): Promise<void> => {
    if (!hasCorrectionChannels(api)) {
      return;
    }
    setBusy(true);
    try {
      setState(await api.correctionsClear());
      setError(null);
    } catch (caught) {
      setError(message(caught, "Could not delete your correction photos"));
    } finally {
      setBusy(false);
    }
  }, [api]);

  const reveal = useCallback(async (): Promise<void> => {
    if (!hasCorrectionChannels(api)) {
      return;
    }
    try {
      await api.correctionsReveal();
    } catch (caught) {
      setError(message(caught, "Could not open the folder"));
    }
  }, [api]);

  const refit = useCallback(async (): Promise<RefitReport | null> => {
    if (!hasCorrectionChannels(api)) {
      return null;
    }
    setBusy(true);
    try {
      const report = await api.correctionsRefit();
      setError(null);
      // The report carries the gate's verdict; the state push that follows it
      // carries which head is now running. Refetch rather than infer, so the
      // card can never claim a head the gate refused.
      setState(await api.correctionsGetState());
      return report;
    } catch (caught) {
      setError(message(caught, "Could not run the refit"));
      return null;
    } finally {
      setBusy(false);
    }
  }, [api]);

  return { state, ready, busy, error, record, remove, clear, reveal, refit };
}
