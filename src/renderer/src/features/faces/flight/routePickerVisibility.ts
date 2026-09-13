/**
 * Face-level Origin/Arrival boxes belong on settings-style surfaces.
 * Lock keeps the globe clear by never passing showRoutePicker: true.
 * sessionId is not a lock signal — live lock uses faceSessionId (`sess-<ms>`).
 */
export function resolveFlightRoutePicker(input: {
  showRoutePicker?: boolean;
  /** Ignored. Lock sessions are `sess-<ms>`, not the leftover `"lock"` id. */
  sessionId?: string;
}): boolean {
  return input.showRoutePicker === true;
}
