import { useMemo, useState, type FormEvent, type JSX } from "react";
import type { PlugProtocol } from "@shared/ipc";
import { cn } from "../lib/cn";
import { plugPowerLabel } from "../lib/format";
import { looksLikeStudyPc, PLUG_PROTOCOLS, STUDY_PC_WARNING, type PlugView } from "../lib/plugsUi";
import { useAppState } from "../state/AppState";
import { GhostButton, PageIntro, PrimaryButton, Select, TextInput, Toggle } from "../components/ui";
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
    <div className="page">
      <PageIntro
        kicker="Outlets"
        title="Smart plugs"
        meta={
          <p className="page-kicker">
            {enabledCount} enabled
            <span className="block">{app.plugs.length} total</span>
          </p>
        }
      >
        Optional kill targets for lamps, fans, and other fun devices. Demo Kill and the countdown
        overlay cut every armed plug.
      </PageIntro>

      <aside className="note" role="note">
        <IconWarning className="h-4 w-4 shrink-0 tone-warn" />
        <div>
          <p className="setting-name">{STUDY_PC_WARNING}</p>
          <p className="setting-copy">
            Do not add the machine running FocusPlug, a PSU, or any outlet that would drop the
            session. Mock is the filming path. Kasa and HTTP talk LAN only.
          </p>
        </div>
      </aside>

      <form
        onSubmit={(event) => {
          void onAdd(event);
        }}
        className="plate plate-pad"
      >
        <div className="field-row">
          <label className="field field-grow">
            <span className="field-label">Name</span>
            <TextInput
              value={name}
              onChange={(value) => {
                setName(value);
                setFormError(null);
              }}
              placeholder="Desk lamp"
            />
          </label>
          <label className="field field-grow">
            <span className="field-label">Address</span>
            <TextInput
              value={address}
              onChange={(value) => {
                setAddress(value);
                setFormError(null);
              }}
              placeholder="192.168.1.40 or mock://lamp"
              mono
            />
          </label>
          <label className="field" style={{ width: "8.5rem" }}>
            <span className="field-label">Protocol</span>
            <Select
              value={protocol}
              onChange={setProtocol}
              options={PROTOCOL_OPTIONS}
              ariaLabel="Plug protocol"
            />
          </label>
          <PrimaryButton submit>Add plug</PrimaryButton>
        </div>
        {formError ? <p className="err">{formError}</p> : null}
      </form>

      {app.plugs.length === 0 ? (
        <p className="empty">No plugs yet. Add a mock device to film the outlet cut.</p>
      ) : (
        <ul className="socket-grid">
          {app.plugs.map((plug) => (
            <PlugSocket
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
          ))}
        </ul>
      )}
    </div>
  );
}

function PlugSocket(props: {
  plug: PlugView;
  onToggle: (enabled: boolean) => void;
  onTest: (powerOn: boolean) => void;
  onRemove: () => void;
}): JSX.Element {
  const { plug } = props;

  return (
    <li className={cn("socket", plug.enabled && plug.powerOn !== false && "is-on")}>
      <div className="socket-wells" aria-hidden="true">
        <span className="socket-well" />
        <span className="socket-well" />
      </div>
      <div className="min-w-0">
        <p className="socket-name">{plug.name}</p>
        <p className="socket-host" title={plug.address}>
          {plug.protocol} · {plug.address}
        </p>
        <p className="setting-copy">{plugPowerLabel(plug)}</p>
      </div>
      <div className="socket-actions">
        <Toggle checked={plug.enabled} onChange={props.onToggle} label={`Enable ${plug.name}`} />
        <GhostButton onClick={() => props.onTest(false)}>Test off</GhostButton>
        <GhostButton onClick={() => props.onTest(true)}>Test on</GhostButton>
        <button
          type="button"
          onClick={props.onRemove}
          className="icon-btn"
          aria-label={`Remove ${plug.name}`}
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
