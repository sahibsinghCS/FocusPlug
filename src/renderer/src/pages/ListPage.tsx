import { useMemo, useState, type FormEvent, type JSX } from "react";
import type { AppEntry } from "@shared/types";
import { newEntryId } from "../lib/ids";
import { cn } from "../lib/cn";
import { useAppState } from "../state/AppState";
import { PageIntro, PrimaryButton, TextInput, Toggle } from "../components/ui";
import { IconClose } from "../lib/icons";

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
    <div className="flex h-full min-h-0 flex-col">
      <PageIntro
        kicker={isAllow ? "Study apps" : "Kill targets"}
        title={isAllow ? "Allowlist" : "Blocklist"}
        meta={
          <p className="font-mono text-[12px] text-fp-faint">
            {enabledCount} enabled
            <span className="block">{entries.length} total</span>
          </p>
        }
      >
        {isAllow
          ? "Foreground apps that count as on-task. Chrome, Docs, Word, VS Code."
          : "Processes FocusPlug force-quits after the countdown. Discord, Steam, games."}
      </PageIntro>

      <div className="min-h-0 flex-1 overflow-auto">
        <form
          onSubmit={(event) => {
            void onAdd(event);
          }}
          className="border-b border-fp-line px-7 py-5"
        >
          <div className="grid gap-3 md:grid-cols-[1fr_1.4fr_auto] md:items-end">
            <label>
              <span className="text-[12px] text-fp-faint">Name</span>
              <div className="mt-1.5">
                <TextInput
                  value={name}
                  onChange={(value) => {
                    setName(value);
                    setFormError(null);
                  }}
                  placeholder={isAllow ? "Obsidian" : "Spotify"}
                />
              </div>
            </label>
            <label>
              <span className="text-[12px] text-fp-faint">Match tokens</span>
              <div className="mt-1.5">
                <TextInput
                  value={match}
                  onChange={(value) => {
                    setMatch(value);
                    setFormError(null);
                  }}
                  placeholder="process.exe, title substring"
                  mono
                />
              </div>
            </label>
            <PrimaryButton submit>Add</PrimaryButton>
          </div>
          {formError ? <p className="mt-2 text-[12px] text-fp-kill">{formError}</p> : null}
        </form>

        <ul>
          {entries.length === 0 ? (
            <li className="px-7 py-12 text-[13px] text-fp-mute">No apps yet.</li>
          ) : (
            entries.map((entry, index) => (
              <EntryRow
                key={entry.id}
                entry={entry}
                accent={isAllow ? "live" : "kill"}
                odd={index % 2 === 1}
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
    </div>
  );
}

function EntryRow(props: {
  entry: AppEntry;
  accent: "live" | "kill";
  odd: boolean;
  onToggle: (enabled: boolean) => Promise<void>;
  onMatch: (match: string[]) => Promise<void>;
  onName: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState(props.entry.name);
  const [matchText, setMatchText] = useState(props.entry.match.join(", "));

  return (
    <li
      className={cn(
        "flex flex-col gap-3 px-7 py-3 md:flex-row md:items-center",
        props.odd && "bg-white/[0.015]",
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span
          className={cn(
            "h-1.5 w-1.5 shrink-0",
            props.entry.enabled
              ? props.accent === "live"
                ? "bg-fp-live"
                : "bg-fp-kill"
              : "bg-fp-line-strong",
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
          className="p-1.5 text-fp-faint transition hover:text-fp-kill"
          aria-label={`Remove ${props.entry.name}`}
        >
          <IconClose className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}
