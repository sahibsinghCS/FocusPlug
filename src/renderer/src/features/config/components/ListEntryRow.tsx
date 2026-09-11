import { useEffect, useState, type JSX } from "react";
import type { AppEntry } from "@shared/types";
import { cn } from "../../../lib/cn";
import { Chip, Toggle } from "../../../components/ui";
import { isShippedDefault, validateListDraft, type ListKind } from "../lists";
import { errorMessage, useSaveState } from "../saveState";
import { ConfirmAction } from "./ConfirmAction";
import { SaveHint } from "./SaveHint";
import { TokenField } from "./TokenField";

export function ListEntryRow(props: {
  entry: AppEntry;
  kind: ListKind;
  accent: "lime" | "red";
  busy: boolean;
  onToggle: (enabled: boolean) => Promise<unknown>;
  onSave: (next: { name: string; match: string[] }) => Promise<unknown>;
  onDelete: () => Promise<unknown>;
}): JSX.Element {
  const { entry } = props;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const [tokens, setTokens] = useState<string[]>([...entry.match]);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const save = useSaveState();
  const shipped = isShippedDefault(props.kind, entry.id);

  useEffect(() => {
    setName(entry.name);
    setTokens([...entry.match]);
  }, [entry.id, entry.name, entry.match.join("\0")]);

  async function persistEdit(): Promise<void> {
    const error = validateListDraft({ name, match: tokens });
    if (error) {
      setFieldError(error.message);
      return;
    }
    setFieldError(null);
    save.begin();
    try {
      await props.onSave({ name: name.trim(), match: tokens });
      save.succeed();
      setEditing(false);
    } catch (caught) {
      save.fail(errorMessage(caught, "Could not save entry"));
    }
  }

  return (
    <li
      className={cn(
        "px-3 py-2",
        save.saving || props.busy ? "opacity-70" : null,
      )}
      aria-busy={save.saving || props.busy}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            entry.enabled
              ? props.accent === "lime"
                ? "bg-fp-lime"
                : "bg-fp-red"
              : "bg-[#4b5568]",
          )}
          aria-hidden="true"
        />
        {editing ? (
          <input
            value={name}
            aria-label={`${entry.name} display name`}
            disabled={save.saving}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void persistEdit();
              }
              if (event.key === "Escape") {
                setName(entry.name);
                setTokens([...entry.match]);
                setEditing(false);
                setFieldError(null);
              }
            }}
            className="h-7 min-w-[8rem] flex-1 rounded-md border border-fp-line bg-fp-elev px-2 text-[13px] font-medium text-fp-ink"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="min-w-0 truncate text-left text-[13px] font-medium text-fp-ink hover:underline"
          >
            {entry.name}
          </button>
        )}
        {shipped ? <Chip tone="mute">Default</Chip> : null}
        <div className="ml-auto flex items-center gap-1.5">
          <Toggle
            checked={entry.enabled}
            disabled={props.busy || save.saving}
            label={`${entry.enabled ? "Disable" : "Enable"} ${entry.name}`}
            onChange={(enabled) => {
              void props.onToggle(enabled);
            }}
          />
          {editing ? (
            <>
              <button
                type="button"
                disabled={save.saving}
                onClick={() => void persistEdit()}
                className="rounded-md px-2 py-1 text-[11px] font-semibold text-fp-lime hover:bg-fp-lime/10"
              >
                Save
              </button>
              <button
                type="button"
                disabled={save.saving}
                onClick={() => {
                  setName(entry.name);
                  setTokens([...entry.match]);
                  setEditing(false);
                  setFieldError(null);
                }}
                className="rounded-md px-2 py-1 text-[11px] font-medium text-fp-faint hover:bg-white/5"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              type="button"
              disabled={props.busy}
              onClick={() => setEditing(true)}
              className="rounded-md px-2 py-1 text-[11px] font-medium text-fp-faint hover:bg-white/5 hover:text-fp-ink"
            >
              Edit
            </button>
          )}
          <ConfirmAction
            label="Remove"
            confirmLabel="Confirm"
            ariaLabel={`Remove ${entry.name}`}
            disabled={props.busy || save.saving}
            onConfirm={() => {
              void props.onDelete();
            }}
          />
        </div>
      </div>
      <div className="mt-1.5 pl-3.5">
        {editing ? (
          <TokenField
            id={`match-${entry.id}`}
            tokens={tokens}
            onChange={setTokens}
            disabled={save.saving}
            invalid={fieldError !== null}
            placeholder="process.exe, title substring"
            ariaLabel={`Match tokens for ${entry.name}`}
          />
        ) : (
          <ul className="flex flex-wrap gap-1" aria-label={`${entry.name} match tokens`}>
            {entry.match.map((token) => (
              <li
                key={token}
                className="rounded border border-fp-line bg-white/[0.03] px-1.5 py-0.5 font-mono text-[11px] text-fp-mute"
              >
                {token}
              </li>
            ))}
          </ul>
        )}
        {fieldError ? (
          <p className="mt-1 text-[11px] text-fp-red" role="alert">
            {fieldError}
          </p>
        ) : (
          <SaveHint state={save.state} />
        )}
      </div>
    </li>
  );
}
