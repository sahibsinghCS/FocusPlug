import { useMemo, useState, type FormEvent, type JSX } from "react";
import type { PlugProtocol } from "@shared/ipc";
import { cn } from "../lib/cn";
import { plugPowerLabel } from "../lib/format";
import { looksLikeStudyPc, PLUG_PROTOCOLS, STUDY_PC_WARNING, type PlugView } from "../lib/plugsUi";
import { useAppState } from "../state/AppState";
import { Chip, GhostButton, PrimaryButton, Select, TextInput, Toggle } from "../components/ui";

const PROTOCOL_OPTIONS: ReadonlyArray<{ value: PlugProtocol; label: string }> = PLUG_PROTOCOLS.map(
  (protocol) => ({ value: protocol, label: protocol }),
);

export function PlugsPage(): JSX.Element {
  const app = useAppState();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [protocol, setProtocol] = useState<PlugProtocol>("mock");
  const [formError, setFormError] = useState<string | null>(null);

  const enabledCount = useMemo(
    () => app.plugs.filter((plug) => plug.enabled).length,
    [app.plugs],
  );

  async function onAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedAddress = address.trim();
    if (trimmedName.length === 0) {
      setFormError("Name is required");
      return;
    }
    if (trimmedAddress.length === 0) {
      setFormError("Address is required");
      return;
    }
    if (looksLikeStudyPc(trimmedName)) {
      setFormError(STUDY_PC_WARNING);
      return;
    }
    setFormError(null);
    await app.addPlug({ name: trimmedName, address: trimmedAddress, protocol });
    setName("");
    setAddress("");
    setProtocol("mock");
  }

  return (
    <div className="mx-auto flex max-w-[920px] flex-col gap-4 px-7 py-5">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">
          Outlets
        </p>
        <h1 className="mt-1 text-[18px] font-semibold tracking-tight">Smart plugs</h1>
        <p className="mt-1 text-[13px] text-fp-mute">
          Optional kill targets for lamps, fans, and other fun devices. Demo Kill and the
          countdown overlay cut every armed plug.
        </p>
        <p className="mt-2 font-mono text-[12px] text-fp-faint">
          {enabledCount} enabled · {app.plugs.length} total
        </p>
      </header>

      <aside
        className="rounded-lg border border-fp-amber/40 bg-fp-amber/[0.08] px-4 py-3"
        role="note"
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-fp-amber">
          Safety
        </p>
        <p className="mt-1 text-[14px] font-medium text-fp-ink">{STUDY_PC_WARNING}</p>
        <p className="mt-1 text-[12px] text-fp-mute">
          Do not add the machine running FocusPlug, a PSU, or any outlet that would drop the
          session. Mock is the filming path; kasa and http talk LAN only.
        </p>
      </aside>

      <form
        onSubmit={(event) => {
          void onAdd(event);
        }}
        className="rounded-lg border border-fp-line bg-fp-panel p-4"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1.2fr_140px_auto] md:items-end">
          <label>
            <span className="text-[11px] uppercase tracking-[0.16em] text-fp-faint">Name</span>
            <div className="mt-1.5">
              <TextInput value={name} onChange={setName} placeholder="Desk lamp" />
            </div>
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-[0.16em] text-fp-faint">
              Address
            </span>
            <div className="mt-1.5">
              <TextInput
                value={address}
                onChange={setAddress}
                placeholder="192.168.1.40 or mock://lamp"
                mono
              />
            </div>
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-[0.16em] text-fp-faint">
              Protocol
            </span>
            <div className="mt-1.5">
              <Select
                value={protocol}
                onChange={setProtocol}
                options={PROTOCOL_OPTIONS}
                ariaLabel="Plug protocol"
              />
            </div>
          </label>
          <PrimaryButton submit>Add plug</PrimaryButton>
        </div>
        {formError ? <p className="mt-2 text-[12px] text-fp-red">{formError}</p> : null}
      </form>

      <ul className="divide-y divide-fp-line overflow-hidden rounded-lg border border-fp-line bg-fp-panel">
        {app.plugs.length === 0 ? (
          <li className="px-4 py-10 text-center text-[13px] text-fp-mute">
            No plugs yet. Add a mock device to film the outlet cut.
          </li>
        ) : (
          app.plugs.map((plug) => (
            <PlugRow
              key={plug.id}
              plug={plug}
              onToggle={(enabled) => {
                void app.setPlugEnabled(plug.id, enabled);
              }}
              onTest={(powerOn) => {
                void app.testPlug(plug.id, powerOn);
              }}
              onRemove={() => {
                void app.removePlug(plug.id);
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function PlugRow(props: {
  plug: PlugView;
  onToggle: (enabled: boolean) => void;
  onTest: (powerOn: boolean) => void;
  onRemove: () => void;
}): JSX.Element {
  const { plug } = props;
  const powerTone = plug.error ? "red" : !plug.online ? "mute" : plug.powerOn ? "lime" : "red";

  return (
    <li className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            plug.enabled && plug.online && plug.powerOn
              ? "bg-fp-lime"
              : plug.online
                ? "bg-fp-amber"
                : "bg-zinc-600",
          )}
        />
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-fp-ink">{plug.name}</p>
          <p className="truncate font-mono text-[11px] text-fp-faint" title={plug.address}>
            {plug.address}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone="mute">{plug.protocol}</Chip>
        <Chip tone={powerTone}>{plugPowerLabel(plug)}</Chip>
        <Toggle
          checked={plug.enabled}
          onChange={props.onToggle}
          label={`Enable ${plug.name}`}
        />
        <GhostButton onClick={() => props.onTest(false)}>Test off</GhostButton>
        <GhostButton onClick={() => props.onTest(true)}>Test on</GhostButton>
        <button
          type="button"
          onClick={props.onRemove}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-fp-faint transition hover:bg-white/5 hover:text-fp-red"
          aria-label={`Remove ${plug.name}`}
        >
          Remove
        </button>
      </div>
    </li>
  );
}
