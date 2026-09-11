import type { JSX } from "react";
import { STUDY_PC_WARNING } from "../../../lib/plugsUi";
import { PLUG_ONBOARDING_STEPS } from "../plugs";
import { Notice } from "./Notice";

export function PlugOnboarding(): JSX.Element {
  return (
    <div className="space-y-3">
      <Notice tone="amber" title="Never the study PC" role="note">
        <p className="font-medium">{STUDY_PC_WARNING}</p>
        <p className="mt-1 text-fp-mute">
          Fun outlets only: RGB lamp, speaker, a game-PC PSU on a different socket. Persistence
          drops anything that is not <span className="font-mono text-fp-ink">isStudyPc: false</span>.
        </p>
      </Notice>
      <ol className="grid gap-2 sm:grid-cols-4">
        {PLUG_ONBOARDING_STEPS.map((step, index) => (
          <li key={step.title} className="rounded-md border border-fp-line bg-fp-panel px-3 py-2">
            <p className="font-mono text-[10px] text-fp-faint">{index + 1}</p>
            <p className="mt-0.5 text-[12px] font-semibold">{step.title}</p>
            <p className="mt-0.5 text-[11px] leading-snug text-fp-mute">{step.detail}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
