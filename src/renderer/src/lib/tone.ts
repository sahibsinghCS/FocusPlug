import type { Tone } from "./format";

export function toneText(tone: Tone): string {
  if (tone === "lime") return "text-fp-lime";
  if (tone === "red") return "text-fp-red";
  if (tone === "amber") return "text-fp-amber";
  return "text-fp-mute";
}

export function toneDot(tone: Tone): string {
  if (tone === "lime") return "bg-fp-lime shadow-[0_0_8px_rgba(212,255,58,0.85)]";
  if (tone === "red") return "bg-fp-red shadow-[0_0_8px_rgba(255,45,85,0.9)]";
  if (tone === "amber") return "bg-fp-amber shadow-[0_0_8px_rgba(255,176,32,0.85)]";
  return "bg-[#4b5568]";
}

export function toneChip(tone: Tone): string {
  if (tone === "lime") return "border-fp-lime/25 bg-fp-lime/10 text-fp-lime";
  if (tone === "red") return "border-fp-red/30 bg-fp-red/10 text-fp-red";
  if (tone === "amber") return "border-fp-amber/30 bg-fp-amber/10 text-fp-amber";
  return "border-fp-line bg-white/5 text-fp-mute";
}

export function toneWash(tone: Tone): string {
  if (tone === "lime") return "border-fp-lime/30 bg-fp-lime/[0.08]";
  if (tone === "red") return "border-fp-red/30 bg-fp-red/[0.08]";
  if (tone === "amber") return "border-fp-amber/30 bg-fp-amber/[0.08]";
  return "border-fp-line bg-fp-elev/80";
}

export function toneCard(tone: Tone): string {
  if (tone === "lime") return "border-fp-lime/25";
  if (tone === "red") return "border-fp-red/30";
  if (tone === "amber") return "border-fp-amber/25";
  return "border-fp-line";
}
