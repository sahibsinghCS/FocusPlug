import { useState, type JSX } from "react";
import { FACE_CATALOG, type FaceId } from "@shared/faces";
import { FORECAST_PARAM_COUNT } from "@shared/forecast";
import type { DeskModelId } from "@shared/ipc";
import { deskModelMayPauseOnAway } from "@shared/nudge";
import { Field, GhostButton, Toggle } from "../components/ui";
import { pageCopy } from "../lib/routes";
import {
  ConfigHeader,
  ConfigPage,
  ConfirmAction,
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
import { useFocusPlan } from "../features/focusplan";
import { FlightRoutePicker } from "../features/faces/flight/RoutePicker";
import { useAppState } from "../state/AppState";

export function SettingsPage(): JSX.Element {
  const app = useAppState();
  const { settings } = app;
  const modelSave = useSaveState();
  const faceSave = useSaveState();
  const [modelError, setModelError] = useState<string | null>(null);
  const [faceError, setFaceError] = useState<string | null>(null);
  const readiness = customReadiness();
  const focusPlan = useFocusPlan();
  /**
   * Whether the presence model they are running has earned a stopped clock.
   * The switch below is a preference and is stored either way; this is what
   * decides whether it can do anything, so the card has to say so.
   */
  const awayPauseEarned = deskModelMayPauseOnAway(settings.deskModelId);

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
          hint="Seconds between distracted/away and force-quit. Cancels if you return to an allowlisted app. Stopping the clock when you leave waits for this countdown, so a longer fuse delays that pause rather than cancelling the force-quit."
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

      <section className="fp-card space-y-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium">Stop the clock when you leave</p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
              Fifteen unbroken seconds of away and the Pomodoro clock pauses — and stays paused
              until you start it again, so time out of the room is not study time. The force-quit
              always goes first: while a countdown is burning the clock waits for it, so setting
              Countdown above fifteen seconds delays this pause and never cancels the kill. Only
              the desk model trained in this repo is allowed to stop your clock: on the held-out
              eval it is right 92% of the times it says away.
            </p>
          </div>
          <Toggle
            checked={settings.pauseOnAwayEnabled}
            onChange={(next) => {
              void app.patchSettings({ pauseOnAwayEnabled: next });
            }}
            label="Stop the clock when you leave"
          />
        </div>

        {awayPauseEarned ? null : (
          <Notice tone="warn" title="Nudge only on this desk model" role="status">
            {settings.deskModelId === "blazeface" ? (
              <p>
                BlazeFace is a face detector, not an away model — it answers &ldquo;away&rdquo; for
                any frame it cannot find a face in, so a dim room, a bad angle or a head turned
                down reads as an empty chair. On the held-out eval it is right 42% of the times it
                says away, against 92% for the trained model, and it says it about two thirds of
                the frames of someone sitting right there.
              </p>
            ) : (
              <p>
                The stub model is a fixture: it answers uncertain to everything and has no eval
                behind it, so nothing it says is allowed to stop a clock.
              </p>
            )}
            <p className="mt-1">
              So leaving your desk still pulls you back — window, overlay, lamp — and never stops
              your clock here, whatever this switch says. Set <b>Desk model</b> to
              <span className="font-mono"> custom</span> below and the switch takes effect.
            </p>
          </Notice>
        )}

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-4">
          <div>
            <p className="text-[13px] font-medium">Stop the clock on your phone</p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
              Off by default, on purpose. The attention model catches 50-69% of phones and calls
              about 17% of phone-free photos &ldquo;phone&rdquo;, and pausing someone who is
              working is the worst thing this can do. On, it needs thirty unbroken seconds
              rather than fifteen, and the higher floor below. It still nudges either way.
            </p>
          </div>
          <Toggle
            checked={settings.pauseOnPhoneEnabled}
            onChange={(next) => {
              void app.patchSettings({ pauseOnPhoneEnabled: next });
            }}
            label="Stop the clock on your phone"
          />
        </div>

        <Field
          label="Away pause floor"
          hint="Presence confidence every one of those readings must clear before the clock stops."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.5}
              max={0.95}
              step={0.01}
              aria-label="Away pause confidence floor"
              value={settings.pauseAwayConfidence}
              disabled={!settings.pauseOnAwayEnabled}
              onChange={(event) => {
                void app.patchSettings({ pauseAwayConfidence: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-amber disabled:opacity-40"
            />
            <span className="w-12 font-mono text-[13px] tabular">
              {Math.round(settings.pauseAwayConfidence * 100)}%
            </span>
          </div>
        </Field>

        <Field
          label="Phone pause floor"
          hint="Attention confidence for a phone pause. Kept at least 5 points above the away floor — the weaker model always has to be surer."
        >
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0.5}
              max={0.99}
              step={0.01}
              aria-label="Phone pause confidence floor"
              value={settings.pausePhoneConfidence}
              disabled={!settings.pauseOnPhoneEnabled}
              onChange={(event) => {
                void app.patchSettings({ pausePhoneConfidence: Number(event.target.value) });
              }}
              className="h-1 flex-1 accent-fp-red disabled:opacity-40"
            />
            <span className="w-12 font-mono text-[13px] tabular">
              {Math.round(settings.pausePhoneConfidence * 100)}%
            </span>
          </div>
        </Field>
      </section>

      <section className="fp-card space-y-4 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[13px] font-medium">Focus Plan</p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
              Recommends a round length before you start, debriefs it after, and tracks one
              number: the minutes you hold before your first drift. It never locks, blocks or
              kills anything — the plan is an offer. Off reproduces today&apos;s screens exactly.
            </p>
          </div>
          <Toggle
            checked={settings.focusPlanEnabled}
            onChange={(next) => {
              void app.patchSettings({ focusPlanEnabled: next });
            }}
            label="Focus Plan"
          />
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-fp-line pt-4">
          <div>
            <p className="text-[13px] font-medium">Let the plan progress</p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
              Hold two rounds clean and the target goes up three minutes; drift early twice and
              it comes back down three, and says so. Off keeps the measurement and the debrief
              and plans straight to what you have held.
            </p>
          </div>
          <Toggle
            checked={settings.focusPlanStretchEnabled}
            onChange={(next) => {
              void app.patchSettings({ focusPlanStretchEnabled: next });
            }}
            label="Let the plan progress"
            disabled={!settings.focusPlanEnabled}
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-fp-line pt-4">
          <div>
            <p className="text-[13px] font-medium">
              Focus history · {focusPlan.state.lifetimeRounds}{" "}
              {focusPlan.state.lifetimeRounds === 1 ? "round" : "rounds"}
            </p>
            <p className="mt-0.5 text-[12px] text-fp-mute">
              Kept on this machine in <span className="font-mono">focus-plan.json</span>, beside
              your settings. Numbers and dates only — no app names, no window titles, nothing
              uploaded. Clearing it leaves the adaptive fuse model, the session log and your
              settings untouched.
            </p>
          </div>
          <ConfirmAction
            label="Forget my focus history"
            confirmLabel="Erase it"
            ariaLabel="Forget my focus history"
            disabled={focusPlan.state.lifetimeRounds === 0}
            onConfirm={() => {
              void focusPlan.reset();
            }}
          />
        </div>

        {focusPlan.error === null ? null : (
          <p className="text-[12px] text-fp-red" role="alert">
            {focusPlan.error}
          </p>
        )}
      </section>

      <section className="fp-card space-y-3 p-4" aria-busy={faceSave.saving}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="fp-section-label">Session face</p>
            <p className="mt-1 text-[12px] text-fp-mute">
              The instrument lock mode draws your session on. Pick the one you want on
              screen for the next hour.
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

      <section className="fp-card space-y-3 p-4">
        <div>
          <p className="fp-section-label">Flight route</p>
          <p className="mt-1 text-[12px] text-fp-mute">
            Origin and arrival for the Flight face. Default is Dublin to Edinburgh.
            Both ends are user-choosable and persist on the same settings blob.
          </p>
        </div>
        <FlightRoutePicker
          dep={settings.flightDep}
          arr={settings.flightArr}
          layout="settings"
          onChange={(next) => {
            void app.patchSettings({ flightDep: next.dep, flightArr: next.arr });
          }}
        />
      </section>

      <section className="fp-card space-y-3 p-4">
        <div>
          <p className="fp-section-label">When you drift</p>
          <p className="mt-1 text-[12px] text-fp-mute">
            On your phone, looking away, or on a blocked app: FocusPlug comes back to the front
            with your timer. Phone and looking-away need the custom desk model.
          </p>
        </div>
        <div className="grid gap-2 min-[720px]:grid-cols-2" role="radiogroup" aria-label="Plugs when you drift">
          {(
            [
              ["nudge", "Lamp on", "Enabled plugs switch on to pull you back."],
              ["cut", "Cut power", "Enabled plugs power off when a blocked app is killed."],
            ] as const
          ).map(([id, title, detail]) => {
            const selected = settings.plugMode === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => {
                  void app.patchSettings({ plugMode: id });
                }}
                className={`fp-btn rounded-[var(--radius-fp)] border px-3 py-2.5 text-left ${
                  selected ? "border-fp-focus/60 bg-fp-focus/10" : "border-fp-line hover:border-white/25"
                }`}
              >
                <p className="text-[13px] font-medium">{title}</p>
                <p className="mt-0.5 text-[12px] text-fp-mute">{detail}</p>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-fp-line pt-3">
          <p className="mr-auto text-[12px] text-fp-mute">
            Test it: click, switch to another window, and the nudge fires in 5 seconds.
          </p>
          {(
            [
              ["phone", "Test phone nudge"],
              ["away", "Test away nudge"],
              ["blocked", "Test blocked-app nudge"],
            ] as const
          ).map(([kind, label]) => (
            <button
              key={kind}
              type="button"
              onClick={() => {
                setTimeout(() => {
                  void app.demoNudge(kind);
                }, 5000);
              }}
              className="fp-btn h-9 rounded-[var(--radius-fp)] border border-fp-line px-3 text-[12px] font-medium hover:border-white/25"
            >
              {label}
            </button>
          ))}
        </div>
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
          <Notice tone="warn" title="Custom readiness" role="status">
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
          <Notice tone="focus" title="BlazeFace" role="status">
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
