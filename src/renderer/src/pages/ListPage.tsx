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
    <div className="page">
      <PageIntro
        kicker={isAllow ? "Study apps" : "Kill targets"}
        title={isAllow ? "Allowlist" : "Blocklist"}
        meta={
          <p className="page-kicker">
            {enabledCount} enabled
            <span className="block">{entries.length} total</span>
          </p>
        }
      >
        {isAllow
          ? "Foreground apps that count as on-task. Chrome, Docs, Word, VS Code."
          : "Processes FocusPlug force-quits after the countdown. Discord, Steam, games."}
      </PageIntro>

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
              placeholder={isAllow ? "Obsidian" : "Spotify"}
            />
          </label>
          <label className="field field-grow">
            <span className="field-label">Match tokens</span>
            <TextInput
              value={match}
              onChange={(value) => {
                setMatch(value);
                setFormError(null);
              }}
              placeholder="process.exe, title substring"
              mono
            />
          </label>
          <PrimaryButton submit>Add</PrimaryButton>
        </div>
        {formError ? <p className="err">{formError}</p> : null}
      </form>

      {entries.length === 0 ? (
        <p className="empty">No apps yet.</p>
      ) : (
        <ul className="tile-grid">
          {entries.map((entry) => (
            <EntryTile
              key={entry.id}
              entry={entry}
              kind={props.kind}
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
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryTile(props: {
  entry: AppEntry;
  kind: "allow" | "block";
  onToggle: (enabled: boolean) => Promise<void>;
  onMatch: (match: string[]) => Promise<void>;
  onName: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}): JSX.Element {
  const [name, setName] = useState(props.entry.name);
  const [matchText, setMatchText] = useState(props.entry.match.join(", "));
  const onClass = props.kind === "allow" ? "is-on" : "is-armed";

  return (
    <li className={cn("app-tile", props.entry.enabled && onClass)}>
      <div className="tile-top">
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
          className="tile-name-input tile-name"
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
            className="icon-btn"
            aria-label={`Remove ${props.entry.name}`}
          >
            <IconClose className="h-4 w-4" />
          </button>
        </div>
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
        className="tile-match"
      />
    </li>
  );
}
