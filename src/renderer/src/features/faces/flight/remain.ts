import type { FlightPhase } from "./math";

export function formatRemainHms(totalSec: number): string {
  if (!Number.isFinite(totalSec)) {
    throw new Error("formatRemainHms requires a finite number of seconds");
  }
  const safe = Math.max(0, Math.floor(totalSec));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatStudied(elapsedSec: number): string {
  if (!Number.isFinite(elapsedSec)) {
    throw new Error("formatStudied requires a finite number of seconds");
  }
  const totalMinutes = Math.round(Math.max(0, elapsedSec) / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}

export function formatArriveLocal(ms: number): string {
  if (!Number.isFinite(ms)) {
    throw new Error("formatArriveLocal requires a finite timestamp");
  }
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(ms));
}

export function flightStatusLine(phase: FlightPhase, complete: boolean): string {
  if (complete || phase === "complete") {
    return "ARRIVED";
  }
  if (phase === "climb") {
    return "IN FLIGHT · CLIMBING OUT";
  }
  if (phase === "descent") {
    return "IN FLIGHT · DESCENDING";
  }
  return "IN FLIGHT · CRUISE";
}

export function studiedSeconds(estimateMinutes: number, remainingSec: number): number {
  if (!Number.isFinite(estimateMinutes) || !Number.isFinite(remainingSec)) {
    throw new Error("studiedSeconds requires finite estimate and remaining");
  }
  return Math.max(0, estimateMinutes * 60 - Math.max(0, remainingSec));
}
