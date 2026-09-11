import { useMemo, useState, type FormEvent, type JSX } from "react";
import type { PlugProtocol } from "@shared/ipc";
import { cn } from "../lib/cn";
import { plugPowerLabel } from "../lib/format";
import { looksLikeStudyPc, PLUG_PROTOCOLS, STUDY_PC_WARNING, type PlugView } from "../lib/plugsUi";
import { useAppState } from "../state/AppState";
import { Chip, GhostButton, PageIntro, PrimaryButton, Select, TextInput, Toggle } from "../components/ui";
import { IconClose, IconWarning } from "../lib/icons";

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
    <div className="flex h-full min-h-0 flex-col">
      <PageIntro
        kicker="Outlets"
        title="Smart plugs"
        meta={
          <p className="font-mono text-[12px] text-fp-faint">
            {enabledCount} enabled
            <span className="block">{app.plugs.length} total</span>
          </p>
        }
      >
        Optional kill targets for lamps, fans, and other fun devices. Demo Kill and the countdown
        overlay cut every armed plug.
      </PageIntro>

      <aside className="flex gap-3 border-b border-fp-warn/35 bg-fp-warn/[0.08] px-7 py-4" role="note">
        <IconWarning className="mt-0.5 h-4 w-4 shrink-0 text-fp-warn" />
        <div>
          <p className="text-[13px] font-medium text-fp-ink">{STUDY_PC_WARNING}</p>
          <p className="mt-1 text-[12px] text-fp-mute">
            Do not add the machine running FocusPlug, a PSU, or any outlet that would drop the
            session. Mock is the filming path. Kasa and HTTP talk LAN only.
          </p>
        </div>
      </aside>

      <div className="min-h-0 flex-1 overflow-auto">
        <form
          onSubmit={(event) => {
            void onAdd(event);
          }}
          className="border-b border-fp-line px-7 py-5"
        >
          <div className="grid gap-3 md:grid-cols-[1fr_1.2fr_132px_auto] md:items-end">
            <label>
              <span className="text-[12px] text-fp-faint">Name</span>
              <div className="mt-1.5">
                <TextInput
                  value={name}
                  onChange={(value) => {
                    setName(value);
                    setFormError(null);
                  }}
                  placeholder="Desk lamp"
                />
              </div>
            </label>
            <label>
              <span className="text-[12px] text-fp-faint">Address</span>
              <div className="mt-1.5">
                <TextInput
                  value={address}
                  onChange={(value) => {
                    setAddress(value);
                    setFormError(null);
                  }}
                  placeholder="192.168.1.40 or mock://lamp"
                  mono
                />
              </div>
            </label>
            <label>
              <span className="text-[12px] text-fp-faint">Protocol</span>
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
          {formError ? <p className="mt-2 text-[12px] text-fp-kill">{formError}</p> : null}
        </form>

        <ul>
          {app.plugs.length === 0 ? (
            <li className="px-7 py-12 text-[13px] text-fp-mute">
              No plugs yet. Add a mock device to film the outlet cut.
            </li>
          ) : (
            app.plugs.map((plug, index) => (
              <PlugRow
                key={plug.id}
                plug={plug}
                odd={index % 2 === 1}
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
    </div>
  );
}

function PlugRow(props: {
  plug: PlugView;
  odd: boolean;
  onToggle: (enabled: boolean) => void;
  onTest: (powerOn: boolean) => void;
  onRemove: () => void;
}): JSX.Element {
  const { plug } = props;
  const powerTone = plug.error ? "kill" : !plug.online ? "mute" : plug.powerOn ? "live" : "kill";

  return (
    <li
      className={cn(
        "flex flex-col gap-3 px-7 py-3 lg:flex-row lg:items-center",
        props.odd && "bg-white/[0.015]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0",
            plug.enabled && plug.online && plug.powerOn
              ? "bg-fp-live"
              : plug.online
                ? "bg-fp-warn"
                : "bg-fp-line-strong",
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
          className="p-1.5 text-fp-faint transition hover:text-fp-kill"
          aria-label={`Remove ${plug.name}`}
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
