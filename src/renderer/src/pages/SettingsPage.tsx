import type { JSX } from "react";
import type { DeskModelId } from "@shared/ipc";
import { Field, GhostButton, PageChrome, Select, Surface, Toggle } from "../components/ui";
import { deskModelLabel } from "../lib/format";
import { DESK_MODEL_IDS } from "../lib/plugsUi";
import { useAppState } from "../state/AppState";

const MODEL_OPTIONS: ReadonlyArray<{ value: DeskModelId; label: string }> = DESK_MODEL_IDS.map(
  (id) => ({ value: id, label: deskModelLabel(id) }),
);

export function SettingsPage(): JSX.Element {
  const app = useAppState();
  const { settings } = app;

  return (
    <PageChrome
      title="Settings"
      description="Countdown fuse, desk-presence threshold, Desk AI model seam, and strict on-task rules."
    >
      <Surface className="space-y-6 p-5">
        <Field
          label="Countdown"
          hint="Seconds between distracted/away and force-quit. Cancels if you return to an allowlisted app."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              value={settings.countdownSec}
              onChange={(event) => {
                void app.patchSettings({ countdownSec: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-lime"
            />
            <span className="w-12 font-mono text-[14px] tabular">{settings.countdownSec}s</span>
          </div>
        </Field>

        <Field
          label="Desk threshold"
          hint="Minimum confidence before desk-away can start a kill countdown. Uncertain never kills on desk alone."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.3}
              max={0.95}
              step={0.01}
              value={settings.deskThreshold}
              onChange={(event) => {
                void app.patchSettings({ deskThreshold: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-lime"
            />
            <span className="w-12 font-mono text-[14px] tabular">
              {Math.round(settings.deskThreshold * 100)}%
            </span>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-5">
          <div className="max-w-[65ch]">
            <p className="text-[13px] font-medium">Strict mode</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-fp-mute">
              On-task requires allowlisted focus and at-desk presence.
            </p>
          </div>
          <Toggle
            checked={settings.strictMode}
            onChange={(next) => {
              void app.patchSettings({ strictMode: next });
            }}
            label="Strict mode"
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-5">
          <div className="max-w-[65ch]">
            <p className="text-[13px] font-medium">Desk AI webcam</p>
            <p className="mt-0.5 text-[12px] leading-relaxed text-fp-mute">
              On-device presence. Load-bearing for away detection, never uploaded.
            </p>
          </div>
          <Toggle
            checked={settings.webcamEnabled}
            onChange={(next) => {
              void app.setDeskEnabled(next);
              void app.patchSettings({ webcamEnabled: next });
            }}
            label="Desk AI webcam"
          />
        </div>

        <div className="border-t border-fp-line pt-5">
          <Field
            label="Desk model"
            hint="IPC-persisted seam for the on-device presence detector. Stub skips inference, BlazeFace is the shipped graph, custom is Timmy's drop-in."
          >
            <div className="max-w-xs">
              <Select
                value={settings.deskModelId}
                onChange={(next) => {
                  void app.setDeskModelId(next);
                }}
                options={MODEL_OPTIONS}
                ariaLabel="Desk model"
              />
            </div>
            <p className="mt-2 text-[12px] text-fp-mute">
              Current: <span className="font-mono text-fp-ink">{settings.deskModelId}</span>. Swap
              rules and file layout:{" "}
              <span className="font-mono text-fp-lime">docs/MODEL-SEAM.md</span>.
            </p>
          </Field>
        </div>
      </Surface>

      <Surface className="p-5">
        <p className="text-[13px] font-medium">Filming</p>
        <p className="mt-2 max-w-[65ch] text-[13px] leading-relaxed text-fp-mute">
          Preview the kill overlay without waiting for Discord. Uses the current countdown length.
        </p>
        <div className="mt-3">
          <GhostButton
            onClick={() => app.previewCountdown(settings.countdownSec, "Distracted: Discord")}
          >
            Preview kill overlay
          </GhostButton>
        </div>
      </Surface>
    </PageChrome>
  );
}
