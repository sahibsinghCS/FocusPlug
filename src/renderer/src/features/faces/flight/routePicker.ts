/**
 * Face-level Origin/Arrival boxes belong on settings-style surfaces.
 * Lock mode always keeps the globe and stats strip clear.
 */
export function resolveFlightRoutePicker(input: {
  showRoutePicker?: boolean;
  sessionId?: string;
}): boolean {
  if (input.sessionId === "lock") {
    return false;
  }
  return input.showRoutePicker === true;
}
