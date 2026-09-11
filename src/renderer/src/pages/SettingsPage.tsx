import type { JSX } from "react";
import type { DeskModelId } from "@shared/ipc";
import { Field, GhostButton, Select, Toggle } from "../components/ui";
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
    <div className="mx-auto flex max-w-[720px] flex-col gap-4 px-7 py-5">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">Policy</p>
        <h1 className="mt-1 text-[18px] font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-[13px] text-fp-mute">
          Countdown fuse, desk-presence threshold, Desk AI model seam, and strict on-task rules.
        </p>
      </header>

      <section className="space-y-4 rounded-lg border border-fp-line bg-fp-panel p-4">
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

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-3">
          <div>
            <p className="text-[13px] font-medium">Strict mode</p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
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

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-3">
          <div>
            <p className="text-[13px] font-medium">Desk AI webcam</p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
              On-device presence. Load-bearing for away detection — never uploaded.
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

        <div className="border-t border-fp-line pt-3">
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
              Current: <span className="font-mono text-fp-ink">{settings.deskModelId}</span>.
              Swap rules and file layout:{" "}
              <span className="font-mono text-fp-lime">docs/MODEL-SEAM.md</span>.
            </p>
          </Field>
        </div>
      </section>

      <section className="rounded-lg border border-fp-line bg-fp-panel p-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fp-faint">Filming</p>
        <p className="mt-2 text-[13px] text-fp-mute">
          Preview the kill overlay without waiting for Discord. Uses the current countdown length.
        </p>
        <div className="mt-3">
          <GhostButton
            onClick={() => app.previewCountdown(settings.countdownSec, "Distracted: Discord")}
          >
            Preview kill overlay
          </GhostButton>
        </div>
      </section>
    </div>
  );
}
