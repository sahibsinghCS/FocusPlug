import { useState, type JSX } from "react";
import type { PlugSnapshot } from "@shared/ipc";
import { Chip, Toggle } from "../../../components/ui";
import { cn } from "../../../lib/cn";
import type { PlugView } from "../../../lib/plugsUi";
import { formatProbe, plugStateLabel } from "../plugs";
import { errorMessage, useSaveState } from "../saveState";
import { ConfirmAction } from "./ConfirmAction";
import { SaveHint } from "./SaveHint";

export function PlugDeviceRow(props: {
  plug: PlugView;
  busy: boolean;
  onToggle: (enabled: boolean) => Promise<unknown>;
  onTest: (powerOn: boolean) => Promise<PlugSnapshot>;
  onRemove: () => Promise<unknown>;
}): JSX.Element {
  const { plug } = props;
  const state = plugStateLabel(plug);
  const test = useSaveState();
  const [probe, setProbe] = useState<PlugSnapshot | null>(null);
  const [intent, setIntent] = useState<"off" | "on" | null>(null);

  async function runTest(powerOn: boolean): Promise<void> {
    setIntent(powerOn ? "on" : "off");
    test.begin();
    try {
      const snap = await props.onTest(powerOn);
      setProbe(snap);
      test.succeed();
    } catch (caught) {
      test.fail(errorMessage(caught, "Probe failed"));
    }
  }

  return (
    <li className="px-3 py-2.5" aria-busy={props.busy || test.saving}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            !plug.probed
              ? "bg-zinc-600"
              : plug.error
                ? "bg-fp-red"
                : plug.online && plug.powerOn
                  ? "bg-fp-lime"
                  : plug.online
                    ? "bg-fp-amber"
                    : "bg-zinc-600",
          )}
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-fp-ink">{plug.name}</p>
          <p className="truncate font-mono text-[11px] text-fp-faint" title={plug.address}>
            {plug.address}
          </p>
        </div>
        <Chip tone="mute">{plug.protocol}</Chip>
        <Chip tone={state.tone}>{state.online}</Chip>
        <Chip tone={state.tone}>{plug.probed ? (plug.powerOn === true ? "On" : plug.powerOn === false ? "Off" : "Unknown") : "—"}</Chip>
        <Toggle
          checked={plug.enabled}
          disabled={props.busy || test.saving}
          label={`${plug.enabled ? "Disarm" : "Arm"} ${plug.name}`}
          onChange={(enabled) => {
            void props.onToggle(enabled);
          }}
        />
        <button
          type="button"
          disabled={props.busy || test.saving}
          onClick={() => void runTest(false)}
          className="h-7 rounded-md border border-fp-line-strong px-2 text-[11px] font-medium text-fp-ink hover:bg-fp-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {test.saving && intent === "off" ? "Testing off…" : "Test off"}
        </button>
        <button
          type="button"
          disabled={props.busy || test.saving}
          onClick={() => void runTest(true)}
          className="h-7 rounded-md border border-fp-line-strong px-2 text-[11px] font-medium text-fp-ink hover:bg-fp-hover disabled:cursor-not-allowed disabled:opacity-40"
        >
          {test.saving && intent === "on" ? "Testing on…" : "Test on"}
        </button>
        <ConfirmAction
          label="Remove"
          confirmLabel="Confirm"
          ariaLabel={`Remove ${plug.name}`}
          disabled={props.busy || test.saving}
          onConfirm={() => {
            void props.onRemove();
          }}
        />
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-2 pl-3.5">
        {probe ? (
          <div className="space-y-0.5">
            <p className="font-mono text-[11px] text-fp-mute" aria-live="polite">
              Last probe{intent ? ` · test ${intent}` : ""} · {formatProbe(probe)}
            </p>
            {intent &&
            probe.powerOn !== null &&
            (intent === "on") !== probe.powerOn ? (
              <p className="text-[11px] text-fp-amber">
                Driver reported {probe.powerOn ? "on" : "off"}. Test probes status;
                kill / Demo Kill send off.
              </p>
            ) : null}
          </div>
        ) : plug.probed && plug.error ? (
          <p className="font-mono text-[11px] text-fp-red">{plug.error}</p>
        ) : (
          <p className="text-[11px] text-fp-faint">
            Probe reads live status. Kill / Demo Kill cut armed outlets — never the study PC.
          </p>
        )}
        <SaveHint state={test.state} savedLabel="Probe returned" />
      </div>
    </li>
  );
}
