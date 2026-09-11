import type { Tone } from "../../lib/format";

export function toneText(tone: Tone): string {
  if (tone === "lime") return "text-fp-lime";
  if (tone === "red") return "text-fp-red";
  if (tone === "amber") return "text-fp-amber";
  return "text-fp-mute";
}

export function toneDot(tone: Tone): string {
  if (tone === "lime") return "bg-fp-lime";
  if (tone === "red") return "bg-fp-red";
  if (tone === "amber") return "bg-fp-amber";
  return "bg-zinc-500";
}

export function toneChip(tone: Tone): string {
  if (tone === "lime") return "border-fp-lime/30 bg-fp-lime/10 text-fp-lime";
  if (tone === "red") return "border-fp-red/35 bg-fp-red/10 text-fp-red";
  if (tone === "amber") return "border-fp-amber/35 bg-fp-amber/10 text-fp-amber";
  return "border-fp-line bg-white/5 text-fp-mute";
}
