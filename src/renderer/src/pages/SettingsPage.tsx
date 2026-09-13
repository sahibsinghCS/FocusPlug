import { useState, type JSX } from "react";
import { FACE_CATALOG, type FaceId } from "@shared/faces";
import { FORECAST_PARAM_COUNT } from "@shared/forecast";
import type { DeskModelId } from "@shared/ipc";
import { Field, GhostButton, Toggle } from "../components/ui";
import { pageCopy } from "../lib/routes";
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
import { FacePicker } from "../features/faces";
import { useAppState } from "../state/AppState";

export function SettingsPage(): JSX.Element {
  const app = useAppState();
  const { settings } = app;
  const modelSave = useSaveState();
  const faceSave = useSaveState();
  const [modelError, setModelError] = useState<string | null>(null);
  const [faceError, setFaceError] = useState<string | null>(null);
  const readiness = customReadiness();

  async function onFace(id: FaceId): Promise<void> {
    if (id === settings.faceId || faceSave.saving) {
      return;
    }
    setFaceError(null);
    faceSave.begin();
    try {
      await app.patchSettings({ faceId: id });
      faceSave.succeed();
    } catch (caught) {
      const message = errorMessage(caught, "Could not save session face");
      setFaceError(message);
      faceSave.fail(message);
    }
  }

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
        kicker={pageCopy("settings").kicker}
        title={pageCopy("settings").title}
        description="Countdown fuse, session face, desk-presence threshold, Desk AI model seam, and strict on-task rules."
        actions={
          <GhostButton
            onClick={() => app.previewCountdown(settings.countdownSec, "Distracted: Discord")}
          >
            Preview overlay
          </GhostButton>
        }
      />

      <section className="fp-card space-y-4 p-4">
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

      <section className="fp-card space-y-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium">Focus Forecast</p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
              {FORECAST_PARAM_COUNT}-param on-device neural net predicts drift 30 s out — nudges
              early, pre-arms the fuse. Off reproduces today&apos;s behavior exactly.
            </p>
          </div>
          <Toggle
            checked={settings.forecastEnabled}
            onChange={(next) => {
              void app.patchSettings({ forecastEnabled: next });
            }}
            label="Focus Forecast"
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-4">
          <div>
            <p className="text-[13px] font-medium">Pre-arm shortens the fuse</p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
              Sustained high risk arms the shorter fuse below (never under 3 s, never longer
              than the countdown). Off is nudge-only — zero enforcement change.
            </p>
          </div>
          <Toggle
            checked={settings.forecastPrearmEnabled}
            onChange={(next) => {
              void app.patchSettings({ forecastPrearmEnabled: next });
            }}
            label="Pre-arm shortens the fuse"
            disabled={!settings.forecastEnabled}
          />
        </div>

        <Field
          label="Nudge threshold"
          hint="Smoothed risk that triggers the heads-up toast (3 sustained seconds)."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.05}
              max={0.9}
              step={0.01}
              aria-label="Nudge risk threshold"
              value={settings.forecastNudgeRisk}
              disabled={!settings.forecastEnabled}
              onChange={(event) => {
                void app.patchSettings({ forecastNudgeRisk: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-amber disabled:opacity-40"
            />
            <span className="w-12 font-mono text-[13px] tabular">
              {Math.round(settings.forecastNudgeRisk * 100)}%
            </span>
          </div>
        </Field>

        <Field
          label="Pre-arm threshold"
          hint="Smoothed risk that pre-arms the fuse (2 sustained seconds). Kept at least 5 points above the nudge threshold."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.1}
              max={0.95}
              step={0.01}
              aria-label="Pre-arm risk threshold"
              value={settings.forecastPrearmRisk}
              disabled={!settings.forecastEnabled || !settings.forecastPrearmEnabled}
              onChange={(event) => {
                void app.patchSettings({ forecastPrearmRisk: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-red disabled:opacity-40"
            />
            <span className="w-12 font-mono text-[13px] tabular">
              {Math.round(settings.forecastPrearmRisk * 100)}%
            </span>
          </div>
        </Field>

        <Field
          label="Pre-armed fuse"
          hint="Countdown length while pre-armed. A fuse already burning never changes duration."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={3}
              max={30}
              step={1}
              aria-label="Pre-armed fuse seconds"
              value={settings.forecastPrearmFuseSec}
              disabled={!settings.forecastEnabled || !settings.forecastPrearmEnabled}
              onChange={(event) => {
                void app.patchSettings({ forecastPrearmFuseSec: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-red disabled:opacity-40"
            />
            <span className="w-12 font-mono text-[13px] tabular">
              {settings.forecastPrearmFuseSec}s
            </span>
          </div>
        </Field>
      </section>

      <section className="fp-card space-y-3 p-4" aria-busy={faceSave.saving}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="fp-section-label">Session face</p>
            <p className="mt-1 text-[12px] text-fp-mute">
              Immersive timer instrument. Default is Flight. Pending slots stay
              selectable so parallel streams can replace a file without fighting this picker.
            </p>
          </div>
          <p className="shrink-0 font-mono text-[11px] text-fp-faint">
            {faceSave.saving ? "Saving…" : `active ${settings.faceId}`}
          </p>
        </div>
        <FacePicker
          value={settings.faceId}
          disabled={faceSave.saving}
          layout="grid"
          faces={FACE_CATALOG}
          onChange={(id) => {
            void onFace(id);
          }}
        />
        {faceError ? (
          <p className="text-[12px] text-fp-red" role="alert">
            {faceError}
          </p>
        ) : faceSave.state.status === "saved" ? (
          <p className="text-[12px] text-fp-lime" aria-live="polite">
            Face set to {settings.faceId}
          </p>
        ) : null}
      </section>

      <section className="fp-card space-y-3 p-4" aria-busy={modelSave.saving}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="fp-section-label">Desk model</p>
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

    </ConfigPage>
  );
}
