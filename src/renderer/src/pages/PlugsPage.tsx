import { useMemo, useState, type FormEvent, type JSX } from "react";
import type { PlugProtocol } from "@shared/ipc";
import { PrimaryButton } from "../components/ui";
import {
  ConfigHeader,
  ConfigPage,
  errorMessage,
  FieldMessage,
  LabeledInput,
  Notice,
  PlugDeviceRow,
  PlugOnboarding,
  plugReturned,
  ProtocolPicker,
  protocolCard,
  useSaveState,
  validatePlugDraft,
} from "../features/config";
import { STUDY_PC_WARNING } from "../lib/plugsUi";
import { useAppState } from "../state/AppState";

export function PlugsPage(): JSX.Element {
  const app = useAppState();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [protocol, setProtocol] = useState<PlugProtocol>("kasa");
  const [field, setField] = useState<"name" | "address" | "protocol" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const save = useSaveState();
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const card = protocolCard(protocol);
  const firstRun = app.plugs.length === 0;

  const meta = useMemo(() => {
    const armed = app.plugs.filter((plug) => plug.enabled).length;
    return `${armed} armed · ${app.plugs.length} total`;
  }, [app.plugs]);

  async function onAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    const error = validatePlugDraft({ name, address, protocol });
    if (error) {
      setField(error.field);
      setMessage(error.message);
      return;
    }
    setField(null);
    setMessage(null);
    save.begin();
    const draft = { name: name.trim(), address: address.trim(), protocol };
    try {
      const returned = await app.addPlug(draft);
      if (!returned.some((plug) => plug.name === draft.name && plug.address === draft.address)) {
        save.fail("Add returned without this plug");
        return;
      }
      setName("");
      setAddress("");
      save.succeed();
    } catch (caught) {
      save.fail(errorMessage(caught, "Could not add plug"));
    }
  }

  return (
    <ConfigPage>
      <ConfigHeader
        kicker="Outlets"
        title="Smart plugs"
        description="Optional kill targets for lamps and other fun devices. Demo Kill and the countdown overlay cut every armed plug."
        meta={meta}
      />

      {firstRun ? (
        <PlugOnboarding />
      ) : (
        <Notice tone="amber" title="Never the study PC" role="note">
          <p className="font-medium">{STUDY_PC_WARNING}</p>
        </Notice>
      )}

      <form
        onSubmit={(event) => {
          void onAdd(event);
        }}
        className="space-y-3 rounded-md border border-fp-line bg-fp-panel p-3"
        aria-busy={save.saving}
      >
        <ProtocolPicker value={protocol} onChange={setProtocol} disabled={save.saving} />
        <div className="grid gap-2 md:grid-cols-[minmax(0,12rem)_1fr_auto] md:items-end">
          <LabeledInput
            id="plug-name"
            label="Name"
            value={name}
            onChange={setName}
            placeholder="RGB lamp"
            disabled={save.saving}
            invalid={field === "name"}
            describedBy="plug-add-msg"
          />
          <div>
            <LabeledInput
              id="plug-address"
              label={card.addressLabel}
              value={address}
              onChange={setAddress}
              placeholder={card.addressPlaceholder}
              mono
              disabled={save.saving}
              invalid={field === "address"}
              describedBy="plug-add-help plug-add-msg"
            />
            <p id="plug-add-help" className="mt-1 text-[11px] text-fp-faint">
              {card.addressHelp}
            </p>
          </div>
          <PrimaryButton submit disabled={save.saving}>
            {save.saving ? "Adding…" : "Add plug"}
          </PrimaryButton>
        </div>
        {message ? (
          <FieldMessage id="plug-add-msg" tone="red">
            {message}
          </FieldMessage>
        ) : save.state.status === "error" ? (
          <FieldMessage id="plug-add-msg" tone="red">
            {save.state.message}
          </FieldMessage>
        ) : save.state.status === "saved" ? (
          <p className="text-[11px] text-fp-lime" aria-live="polite">
            Plug added — probe it before a session.
          </p>
        ) : null}
      </form>

      <ul className="divide-y divide-fp-line overflow-hidden rounded-md border border-fp-line bg-fp-panel">
        {firstRun ? (
          <li className="px-4 py-8 text-center text-[13px] text-fp-mute">
            No plugs yet. Pick Kasa, HTTP, or Mock, then add a fun device — never the study PC.
          </li>
        ) : (
          app.plugs.map((plug) => (
            <PlugDeviceRow
              key={plug.id}
              plug={plug}
              busy={rowBusy === plug.id}
              onToggle={async (enabled) => {
                setRowBusy(plug.id);
                try {
                  const returned = await app.setPlugEnabled(plug.id, enabled);
                  const updated = returned.find((item) => item.id === plug.id);
                  if (!updated || updated.enabled !== enabled) {
                    throw new Error("Enable toggle did not persist");
                  }
                } finally {
                  setRowBusy(null);
                }
              }}
              onTest={async (powerOn) => {
                return await app.testPlug(plug.id, powerOn);
              }}
              onRemove={async () => {
                setRowBusy(plug.id);
                try {
                  const returned = await app.removePlug(plug.id);
                  if (plugReturned(returned, plug.id)) {
                    throw new Error("Remove returned the deleted plug");
                  }
                } finally {
                  setRowBusy(null);
                }
              }}
            />
          ))
        )}
      </ul>
    </ConfigPage>
  );
}
