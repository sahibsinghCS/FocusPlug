import type { JSX } from "react";
import type { DeskModelId } from "@shared/ipc";
import { Field, GhostButton, PageIntro, Select, Toggle } from "../components/ui";
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
    <div className="page">
      <PageIntro kicker="Policy" title="Settings">
        Countdown fuse, desk-presence threshold, Desk AI model seam, and strict on-task rules.
      </PageIntro>

      <div className="settings-grid">
        <section className="plate setting-card">
          <Field
            label="Countdown"
            hint="Seconds between distracted or away and force-quit. Cancels if you return to an allowlisted app."
          >
            <div className="fader">
              <input
                type="range"
                min={3}
                max={30}
                step={1}
                value={settings.countdownSec}
                onChange={(event) => {
                  void app.patchSettings({ countdownSec: Number(event.target.value) });
                }}
              />
              <span className="fader-value">{settings.countdownSec}s</span>
            </div>
          </Field>
        </section>

        <section className="plate setting-card">
          <Field
            label="Desk threshold"
            hint="Minimum confidence before desk-away can start a kill countdown. Uncertain never kills on desk alone."
          >
            <div className="fader">
              <input
                type="range"
                min={0.3}
                max={0.95}
                step={0.01}
                value={settings.deskThreshold}
                onChange={(event) => {
                  void app.patchSettings({ deskThreshold: Number(event.target.value) });
                }}
              />
              <span className="fader-value">{Math.round(settings.deskThreshold * 100)}%</span>
            </div>
          </Field>
        </section>

        <section className="plate setting-card">
          <div className="tile-top">
            <div>
              <p className="setting-name">Strict mode</p>
              <p className="setting-copy">On-task requires allowlisted focus and at-desk presence.</p>
            </div>
            <Toggle
              checked={settings.strictMode}
              onChange={(next) => {
                void app.patchSettings({ strictMode: next });
              }}
              label="Strict mode"
            />
          </div>
        </section>

        <section className="plate setting-card">
          <div className="tile-top">
            <div>
              <p className="setting-name">Desk AI webcam</p>
              <p className="setting-copy">On-device presence. Load-bearing for away detection. Never uploaded.</p>
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
        </section>

        <section className="plate setting-card">
          <Field
            label="Desk model"
            hint="IPC-persisted seam for the on-device presence detector. Stub skips inference, BlazeFace is the shipped graph, custom is Timmy's drop-in."
          >
            <Select
              value={settings.deskModelId}
              onChange={(next) => {
                void app.setDeskModelId(next);
              }}
              options={MODEL_OPTIONS}
              ariaLabel="Desk model"
            />
            <p className="setting-copy">
              Current: {settings.deskModelId}. Swap rules and file layout: docs/MODEL-SEAM.md.
            </p>
          </Field>
        </section>

        <section className="plate setting-card">
          <p className="setting-name">Filming</p>
          <p className="setting-copy">
            Preview the kill overlay without waiting for Discord. Uses the current countdown length.
          </p>
          <GhostButton
            onClick={() => app.previewCountdown(settings.countdownSec, "Distracted: Discord")}
          >
            Preview kill overlay
          </GhostButton>
        </section>
      </div>
    </div>
  );
}
