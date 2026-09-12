import type { Tone } from "./format";

export function toneText(tone: Tone): string {
  if (tone === "focus") return "text-fp-focus";
  if (tone === "red") return "text-fp-red";
  if (tone === "warn") return "text-fp-warn";
  return "text-fp-mute";
}

export function toneDot(tone: Tone): string {
  if (tone === "focus") return "bg-fp-focus shadow-[0_0_8px_rgba(255,176,97,0.85)]";
  if (tone === "red") return "bg-fp-red shadow-[0_0_8px_rgba(255,59,88,0.9)]";
  if (tone === "warn") return "bg-fp-warn shadow-[0_0_8px_rgba(174,140,255,0.85)]";
  return "bg-[#4a4354]";
}

export function toneChip(tone: Tone): string {
  if (tone === "focus") return "border-fp-focus/25 bg-fp-focus/10 text-fp-focus";
  if (tone === "red") return "border-fp-red/30 bg-fp-red/10 text-fp-red";
  if (tone === "warn") return "border-fp-warn/30 bg-fp-warn/10 text-fp-warn";
  return "border-fp-line bg-white/5 text-fp-mute";
}

export function toneWash(tone: Tone): string {
  if (tone === "focus") return "border-fp-focus/30 bg-fp-focus/[0.08]";
  if (tone === "red") return "border-fp-red/30 bg-fp-red/[0.08]";
  if (tone === "warn") return "border-fp-warn/30 bg-fp-warn/[0.08]";
  return "border-fp-line bg-fp-elev/80";
}

export function toneCard(tone: Tone): string {
  if (tone === "focus") return "border-fp-focus/25";
  if (tone === "red") return "border-fp-red/30";
  if (tone === "warn") return "border-fp-warn/25";
  return "border-fp-line";
}
