import { useMemo, useState, type FormEvent, type JSX } from "react";
import type { AppEntry } from "@shared/types";
import { newEntryId } from "../lib/ids";
import { cn } from "../lib/cn";
import { useAppState } from "../state/AppState";
import { PageChrome, PrimaryButton, Surface, TextButton, TextInput, Toggle } from "../components/ui";

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
    <PageChrome
      title={isAllow ? "Allowlist" : "Blocklist"}
      description={
        isAllow
          ? "Foreground apps that count as on-task. Chrome, Docs, Word, VS Code."
          : "Processes FocusPlug force-quits after the countdown. Discord, Steam, games."
      }
      meta={`${enabledCount} enabled  ${entries.length} total`}
    >
      <form
        onSubmit={(event) => {
          void onAdd(event);
        }}
        className="border border-fp-line bg-fp-panel p-4"
      >
        <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
          <label>
            <span className="text-[12px] text-fp-mute">Name</span>
            <div className="mt-1.5">
              <TextInput value={name} onChange={setName} placeholder={isAllow ? "Obsidian" : "Spotify"} />
            </div>
          </label>
          <label>
            <span className="text-[12px] text-fp-mute">Match tokens</span>
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

      <Surface>
        <ul>
          {entries.length === 0 ? (
            <li className="px-4 py-12">
              <p className="text-[15px] font-medium">No apps yet</p>
              <p className="mt-1 max-w-[48ch] text-[13px] leading-relaxed text-fp-mute">
                {isAllow
                  ? "Add the study app you want to stay in. Match tokens can be a process name or a window title fragment."
                  : "Add Discord, Steam, or any leak process. Enabled entries are what the countdown will kill."}
              </p>
            </li>
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
      </Surface>
    </PageChrome>
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
    <li className="flex flex-col gap-3 border-b border-fp-line px-4 py-3 last:border-b-0 md:flex-row md:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0",
            props.entry.enabled
              ? props.accent === "lime"
                ? "bg-fp-lime"
                : "bg-fp-red"
              : "bg-[#5a584e]",
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
        <TextButton onClick={() => void props.onDelete()} ariaLabel={`Remove ${props.entry.name}`}>
          Remove
        </TextButton>
      </div>
    </li>
  );
}
