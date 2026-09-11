import { useState, type JSX } from "react";
import type { DeskModelId } from "@shared/ipc";
import { Field, GhostButton, Toggle } from "../components/ui";
import {
  ConfigHeader,
  ConfigPage,
  CUSTOM_GUIDE_PATH,
  CUSTOM_MODEL_PATH,
  customReadiness,
  DeskModelPicker,
  errorMessage,
  modelReturned,
  Notice,
  useSaveState,
} from "../features/config";
import { useAppState } from "../state/AppState";

export function SettingsPage(): JSX.Element {
  const app = useAppState();
  const { settings } = app;
  const modelSave = useSaveState();
  const [modelError, setModelError] = useState<string | null>(null);
  const readiness = customReadiness();

  async function onModel(id: DeskModelId): Promise<void> {
    if (id === settings.deskModelId || modelSave.saving) {
      return;
    }
    setModelError(null);
    modelSave.begin();
    try {
      const returned = await app.setDeskModelId(id);
      if (!modelReturned(returned, id)) {
        modelSave.fail(`Returned ${returned}, not ${id}`);
        return;
      }
      modelSave.succeed();
    } catch (caught) {
      const message = errorMessage(caught, "Could not save desk model");
      setModelError(message);
      modelSave.fail(message);
    }
  }

  return (
    <ConfigPage>
      <ConfigHeader
        kicker="Policy"
        title="Settings"
        description="Countdown fuse, desk-presence threshold, Desk AI model seam, and strict on-task rules."
      />

      <section className="space-y-5 rounded-md border border-fp-line bg-fp-panel p-4">
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
              aria-label="Countdown seconds"
              value={settings.countdownSec}
              onChange={(event) => {
                void app.patchSettings({ countdownSec: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-lime"
            />
            <span className="w-12 font-mono text-[13px] tabular">{settings.countdownSec}s</span>
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
              aria-label="Desk confidence threshold"
              value={settings.deskThreshold}
              onChange={(event) => {
                void app.patchSettings({ deskThreshold: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-lime"
            />
            <span className="w-12 font-mono text-[13px] tabular">
              {Math.round(settings.deskThreshold * 100)}%
            </span>
          </div>
        </Field>

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-4">
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

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-4">
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
      </section>

      <section className="space-y-3 rounded-md border border-fp-line bg-fp-panel p-4" aria-busy={modelSave.saving}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-fp-faint">
              Desk model
            </p>
            <p className="mt-1 text-[12px] text-fp-mute">
              Frozen <span className="font-mono text-fp-ink">deskModelId</span> seam. BlazeFace is
              the default. Custom is Timmy's drop-in. Stub is a safe soak.
            </p>
          </div>
          <p className="shrink-0 font-mono text-[11px] text-fp-faint">
            {modelSave.saving ? "Saving…" : `active ${settings.deskModelId}`}
          </p>
        </div>

        <DeskModelPicker
          value={settings.deskModelId}
          disabled={modelSave.saving}
          onChange={(id) => {
            void onModel(id);
          }}
        />

        {settings.deskModelId === "custom" ? (
          <Notice tone="amber" title="Custom readiness" role="status">
            <p>{readiness.label}</p>
            <p className="mt-1 text-fp-mute">{readiness.detail}</p>
            <p className="mt-1 font-mono text-[11px] text-fp-ink">
              {CUSTOM_MODEL_PATH} · {CUSTOM_GUIDE_PATH}
            </p>
          </Notice>
        ) : settings.deskModelId === "stub" ? (
          <Notice tone="mute" title="Stub" role="status">
            Always uncertain. Desk-away will not start a kill on presence alone.
          </Notice>
        ) : (
          <Notice tone="lime" title="BlazeFace" role="status">
            Shipped graph is active. Uncertain still never desk-only-kills.
          </Notice>
        )}

        {modelError ? (
          <p className="text-[12px] text-fp-red" role="alert">
            {modelError}
          </p>
        ) : modelSave.state.status === "saved" ? (
          <p className="text-[12px] text-fp-lime" aria-live="polite">
            Model set to {settings.deskModelId}
          </p>
        ) : null}
      </section>

      <section className="rounded-md border border-fp-line bg-fp-panel p-4">
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
    </ConfigPage>
  );
}
