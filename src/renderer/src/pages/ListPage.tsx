import { useMemo, useState, type FormEvent, type JSX } from "react";
import type { AppEntry } from "@shared/types";
import { EmptyState } from "../components/page";
import { PrimaryButton } from "../components/ui";
import {
  ConfigHeader,
  ConfigPage,
  entryReturned,
  errorMessage,
  FieldMessage,
  LabeledInput,
  listCopy,
  ListEntryRow,
  listMeta,
  Notice,
  TokenField,
  useSaveState,
  validateListDraft,
} from "../features/config";
import { newEntryId } from "../lib/ids";
import { useAppState } from "../state/AppState";

interface ListPageProps {
  kind: "allow" | "block";
}

export function ListPage(props: ListPageProps): JSX.Element {
  const app = useAppState();
  const isAllow = props.kind === "allow";
  const copy = listCopy(props.kind);
  const entries = isAllow ? app.lists.allowlist : app.lists.blocklist;
  const saveList = isAllow ? app.setAllowlist : app.setBlocklist;
  const [name, setName] = useState("");
  const [tokens, setTokens] = useState<string[]>([]);
  const [field, setField] = useState<"name" | "match" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const save = useSaveState();
  const [rowBusy, setRowBusy] = useState<string | null>(null);

  const meta = useMemo(() => listMeta(entries), [entries]);

  async function persist(next: AppEntry[]): Promise<AppEntry[]> {
    const lists = await saveList(next);
    return isAllow ? lists.allowlist : lists.blocklist;
  }

  async function onAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    const error = validateListDraft({ name, match: tokens });
    if (error) {
      setField(error.field);
      setMessage(error.message);
      return;
    }
    const entry: AppEntry = {
      id: newEntryId(props.kind),
      name: name.trim(),
      match: tokens,
      enabled: true,
    };
    setField(null);
    setMessage(null);
    save.begin();
    try {
      const returned = await persist([...entries, entry]);
      if (!entryReturned(returned, entry.id)) {
        save.fail("Save returned without the new row");
        return;
      }
      setName("");
      setTokens([]);
      save.succeed();
    } catch (caught) {
      save.fail(errorMessage(caught, "Could not add app"));
    }
  }

  return (
    <ConfigPage>
      <ConfigHeader
        kicker={copy.kicker}
        title={copy.title}
        description={copy.summary}
        meta={meta}
      />

      <Notice tone="mute" title="Defaults">
        {copy.defaults} {copy.matchHelp}
      </Notice>

      <form
        onSubmit={(event) => {
          void onAdd(event);
        }}
        className="fp-card p-3"
        aria-busy={save.saving}
      >
        <div className="grid gap-2 md:grid-cols-[minmax(0,11rem)_1fr_auto] md:items-end">
          <LabeledInput
            id={`${props.kind}-name`}
            label="Name"
            value={name}
            onChange={setName}
            placeholder={copy.namePlaceholder}
            disabled={save.saving}
            invalid={field === "name"}
            describedBy="list-add-msg"
          />
          <div>
            <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-fp-faint">
              Match tokens
            </span>
            <div className="mt-1">
              <TokenField
                id={`${props.kind}-match`}
                tokens={tokens}
                onChange={setTokens}
                placeholder={copy.tokenPlaceholder}
                disabled={save.saving}
                invalid={field === "match"}
                describedBy="list-add-msg"
              />
            </div>
          </div>
          <PrimaryButton submit disabled={save.saving}>
            {save.saving ? "Adding…" : "Add"}
          </PrimaryButton>
        </div>
        {message ? (
          <FieldMessage id="list-add-msg" tone="red">
            {message}
          </FieldMessage>
        ) : save.state.status === "saved" ? (
          <p className="mt-1 text-[11px] text-fp-focus" aria-live="polite">
            Added
          </p>
        ) : save.state.status === "error" ? (
          <FieldMessage id="list-add-msg" tone="red">
            {save.state.message}
          </FieldMessage>
        ) : (
          <FieldMessage id="list-add-msg" tone="mute">
            Enter or comma adds a token. Process basename or title substring.
          </FieldMessage>
        )}
      </form>

      <ul className="fp-card divide-y divide-fp-line overflow-hidden">
        {entries.length === 0 ? (
          <li className="px-4">
            <EmptyState kicker="Empty" title="No apps yet">
              Add a name and at least one match token. Disable a default to ignore it without
              deleting.
            </EmptyState>
          </li>
        ) : (
          entries.map((entry) => (
            <ListEntryRow
              key={entry.id}
              entry={entry}
              kind={props.kind}
              accent={isAllow ? "focus" : "red"}
              busy={rowBusy === entry.id}
              onToggle={async (enabled) => {
                setRowBusy(entry.id);
                try {
                  await persist(
                    entries.map((item) => (item.id === entry.id ? { ...item, enabled } : item)),
                  );
                } finally {
                  setRowBusy(null);
                }
              }}
              onSave={async (next) => {
                setRowBusy(entry.id);
                try {
                  const returned = await persist(
                    entries.map((item) =>
                      item.id === entry.id ? { ...item, name: next.name, match: next.match } : item,
                    ),
                  );
                  if (!entryReturned(returned, entry.id)) {
                    throw new Error("Save returned without this row");
                  }
                } finally {
                  setRowBusy(null);
                }
              }}
              onDelete={async () => {
                setRowBusy(entry.id);
                try {
                  const returned = await persist(entries.filter((item) => item.id !== entry.id));
                  if (entryReturned(returned, entry.id)) {
                    throw new Error("Remove returned the deleted row");
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
