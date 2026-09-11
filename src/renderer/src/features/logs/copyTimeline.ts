import { isSessionEventShape } from "./eventModel";

export function canCopyTimeline(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.clipboard === "object" &&
    navigator.clipboard !== null &&
    typeof navigator.clipboard.writeText === "function"
  );
}

export function formatTimelineCopy(events: readonly unknown[]): string {
  const rows = events.filter(isSessionEventShape).slice();
  rows.sort((left, right) => left.ts - right.ts);
  const lines = ["FocusPlug session log"];
  if (rows.length === 0) {
    lines.push("(no events)");
    return lines.join("\n");
  }
  lines.push("");
  for (const event of rows) {
    const stamp = Number.isFinite(event.ts) ? new Date(event.ts).toISOString() : String(event.ts);
    lines.push(`${stamp}\t${event.kind}\t${event.detail}`);
  }
  return lines.join("\n");
}

export async function copyTimeline(events: readonly unknown[]): Promise<boolean> {
  if (!canCopyTimeline()) {
    return false;
  }
  const payload = formatTimelineCopy(events);
  await navigator.clipboard.writeText(payload);
  return true;
}
