import { useMemo, useState, type FormEvent, type JSX } from "react";
import type { AppEntry } from "@shared/types";
import { newEntryId } from "../lib/ids";
import { cn } from "../lib/cn";
import { useAppState } from "../state/AppState";
import { PrimaryButton, TextInput, Toggle } from "../components/ui";

interface ListPageProps {
  kind: "allow" | "block";
}

export function ListPage(props: ListPageProps): JSX.Element {
  const app = useAppState();
  const isAllow = props.kind === "allow";
  const entries = isAllow ? app.lists.allowlist : app.lists.blocklist;
  const save = isAllow ? app.setAllowlist : app.setBlocklist;
  const [name, setName] = useState("");
  const [match, setMatch] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const enabledCount = useMemo(
    () => entries.filter((entry) => entry.enabled).length,
    [entries],
  );

  async function persist(next: AppEntry[]): Promise<void> {
    await save(next);
  }

  async function onAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmedName = name.trim();
    const tokens = match
      .split(",")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
    if (trimmedName.length === 0) {
      setFormError("Name is required");
      return;
    }
    if (tokens.length === 0) {
      setFormError("Add at least one match token (process or title)");
      return;
    }
    setFormError(null);
    await persist([
      ...entries,
      {
        id: newEntryId(props.kind),
        name: trimmedName,
        match: tokens,
        enabled: true,
      },
    ]);
    setName("");
    setMatch("");
  }

  return (
    <div className="mx-auto flex max-w-[860px] flex-col gap-5 px-7 py-6">
      <header>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-fp-faint">
          {isAllow ? "Study apps" : "Kill targets"}
        </p>
        <h1 className="mt-1 text-[22px] font-semibold tracking-tight">
          {isAllow ? "Allowlist" : "Blocklist"}
        </h1>
        <p className="mt-1 text-[13px] text-fp-mute">
          {isAllow
            ? "Foreground apps that count as on-task. Chrome, Docs, Word, VS Code."
            : "Processes FocusPlug force-quits after the countdown. Discord, Steam, games."}
        </p>
        <p className="mt-2 font-mono text-[12px] text-fp-faint">
          {enabledCount} enabled · {entries.length} total
        </p>
      </header>

      <form
        onSubmit={(event) => {
          void onAdd(event);
        }}
        className="rounded-lg border border-fp-line bg-fp-panel p-4"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
          <label>
            <span className="text-[11px] uppercase tracking-[0.16em] text-fp-faint">Name</span>
            <div className="mt-1.5">
              <TextInput value={name} onChange={setName} placeholder={isAllow ? "Obsidian" : "Spotify"} />
            </div>
          </label>
          <label>
            <span className="text-[11px] uppercase tracking-[0.16em] text-fp-faint">
              Match tokens
            </span>
            <div className="mt-1.5">
              <TextInput
                value={match}
                onChange={setMatch}
                placeholder="process.exe, title substring"
                mono
              />
            </div>
          </label>
          <PrimaryButton submit>Add</PrimaryButton>
        </div>
        {formError ? <p className="mt-2 text-[12px] text-fp-red">{formError}</p> : null}
      </form>

      <ul className="divide-y divide-fp-line overflow-hidden rounded-lg border border-fp-line bg-fp-panel">
        {entries.length === 0 ? (
          <li className="px-4 py-10 text-center text-[13px] text-fp-mute">No apps yet.</li>
        ) : (
          entries.map((entry) => (
            <EntryRow
              key={entry.id}
              entry={entry}
              accent={isAllow ? "lime" : "red"}
              onToggle={async (enabled) => {
                await persist(
                  entries.map((item) => (item.id === entry.id ? { ...item, enabled } : item)),
                );
              }}
              onMatch={async (nextMatch) => {
                await persist(
                  entries.map((item) =>
                    item.id === entry.id ? { ...item, match: nextMatch } : item,
                  ),
                );
              }}
              onName={async (nextName) => {
                await persist(
                  entries.map((item) =>
                    item.id === entry.id ? { ...item, name: nextName } : item,
                  ),
                );
              }}
              onDelete={async () => {
                await persist(entries.filter((item) => item.id !== entry.id));
              }}
            />
          ))
        )}
      </ul>
    </div>
  );
}

function EntryRow(props: {
  entry: AppEntry;
  accent: "lime" | "red";
  onToggle: (enabled: boolean) => Promise<void>;
  onMatch: (match: string[]) => Promise<void>;
  onName: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState(props.entry.name);
  const [matchText, setMatchText] = useState(props.entry.match.join(", "));

  return (
    <li className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0 rounded-full",
            props.entry.enabled
              ? props.accent === "lime"
                ? "bg-fp-lime"
                : "bg-fp-red"
              : "bg-zinc-600",
          )}
        />
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const next = name.trim();
            if (next.length > 0 && next !== props.entry.name) {
              void props.onName(next);
            } else {
              setName(props.entry.name);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-fp-ink outline-none"
        />
      </div>
      <input
        value={matchText}
        onChange={(event) => setMatchText(event.target.value)}
        onBlur={() => {
          const tokens = matchText
            .split(",")
            .map((token) => token.trim())
            .filter((token) => token.length > 0);
          if (tokens.length > 0) {
            void props.onMatch(tokens);
          } else {
            setMatchText(props.entry.match.join(", "));
          }
        }}
        className="min-w-0 flex-[1.3] bg-transparent font-mono text-[11px] text-fp-mute outline-none"
      />
      <div className="flex items-center gap-2">
        <Toggle
          checked={props.entry.enabled}
          onChange={(next) => {
            void props.onToggle(next);
          }}
          label={`Enable ${props.entry.name}`}
        />
        <button
          type="button"
          onClick={() => void props.onDelete()}
          className="rounded-md px-2 py-1 text-[11px] font-medium text-fp-faint transition hover:bg-white/5 hover:text-fp-red"
          aria-label={`Remove ${props.entry.name}`}
        >
          Remove
        </button>
      </div>
    </li>
  );
}
