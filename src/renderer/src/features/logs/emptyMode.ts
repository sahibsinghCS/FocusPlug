export type LogEmptyMode = "loading" | "error" | "empty" | "filtered";

export function resolveEmptyMode(input: {
  ready: boolean;
  error: string | null;
  logCount: number;
  filteredCount: number;
}): LogEmptyMode | null {
  if (!input.ready) {
    return "loading";
  }
  if (input.logCount === 0 && typeof input.error === "string" && input.error.trim().length > 0) {
    return "error";
  }
  if (input.logCount === 0) {
    return "empty";
  }
  if (input.filteredCount === 0) {
    return "filtered";
  }
  return null;
}
