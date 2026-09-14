import { useState, type JSX } from "react";
import { ConfirmAction } from "../config";
import { correctionsCardView } from "./model";
import { HeadStatus } from "./HeadStatus";
import { useCorrections } from "./useCorrections";
import "./corrections.css";

/**
 * `Settings → Desk model → Your corrections` — the privacy affordance, as a
 * screen rather than as a sentence.
 *
 * Everything the student's disk is holding, listed: a thumbnail per
 * correction, when it happened, what the model said and how sure it was, what
 * they answered, and the byte count. Being able to open the folder and look is
 * worth more than any promise this app could print, so *Reveal folder* is
 * here too — and deletion is one confirmed action that takes the photographs,
 * the index, the personal head fitted from them and the refit report together.
 *
 * The one thing deletion does NOT undo is said before they press it: a Focus
 * Plan retraction stands, because they told us that drift was wrong and it
 * still is. Deleting the photographs is a statement about the photographs.
 */
export function CorrectionsCard(props: {
  /** `personalAttentionHeadEnabled`. */
  personalEnabled: boolean;
  onTogglePersonal: (next: boolean) => void;
  /** Injected by the stills script; live screens read the clock. */
  now?: number;
}): JSX.Element | null {
  const corrections = useCorrections();
  const [note, setNote] = useState<string | null>(null);
  const view = correctionsCardView(corrections.state, props.now ?? Date.now());

  // Nothing here is reachable on a default install: only `deskModelId: custom`
  // can pause, and only a pause can produce a correction. A card offering to
  // delete photographs that could never have been taken would be theatre.
  if (view.hidden) {
    return null;
  }

  return (
    <div className="space-y-3 border-t border-fp-line pt-4" data-corrections-card="">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-medium">Your corrections</p>
          <p className="mt-0.5 max-w-[62ch] text-[12px] leading-snug text-fp-mute">
            {view.privacy}
          </p>
          <p className="mt-1 max-w-[62ch] text-[12px] leading-snug text-fp-faint">
            {view.deleteCaveat}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="font-mono text-[11px] text-fp-faint">{view.summary}</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                void corrections.reveal();
              }}
              className="fp-btn h-8 rounded-[var(--radius-fp)] border border-fp-line px-2.5 text-[11px] font-medium hover:border-white/25"
            >
              Reveal folder
            </button>
            <ConfirmAction
              label="Delete all"
              confirmLabel="Erase them"
              ariaLabel={view.deleteAllLabel}
              disabled={corrections.state.items.length === 0 || corrections.busy}
              onConfirm={() => {
                void corrections.clear();
                setNote(
                  "Deleted. The photos, the index and any head fitted from them are gone; " +
                    "the shipped head is running again.",
                );
              }}
            />
          </div>
        </div>
      </div>

      {view.capNotice === null ? null : (
        <p className="text-[12px] leading-snug text-fp-warn" role="status">
          {view.capNotice}
        </p>
      )}

      {view.cooldownLines.map((line) => (
        <p key={line} className="text-[12px] text-fp-mute">
          {line}
        </p>
      ))}

      {view.empty === null ? (
        <ul className="space-y-2">
          {view.rows.map((row) => (
            <li
              key={row.id}
              className="fp-correction-row rounded-[var(--radius-fp)] border border-fp-line px-2.5 py-2"
            >
              {row.thumbnail === null ? (
                <span
                  className="fp-correction-thumb inline-block"
                  aria-hidden="true"
                  title="no photos kept"
                />
              ) : (
                <img
                  className="fp-correction-thumb"
                  src={row.thumbnail}
                  alt={`Thumbnail of the frame that caused the ${row.when} pause`}
                />
              )}
              <div className="min-w-0">
                <p className="truncate text-[12px] text-fp-ink">
                  <span className="font-mono text-fp-faint">{row.when}</span> · {row.said}
                </p>
                <p className="mt-0.5 truncate text-[12px] text-fp-mute">{row.answered}</p>
                <p className="mt-0.5 font-mono text-[11px] text-fp-faint">{row.size}</p>
                {row.excludedBecause === null ? null : (
                  // The count in this list and the count on the refit button
                  // must reconcile on screen — the same rule Focus Plan applies
                  // to its own greyed evidence rows.
                  <p className="mt-0.5 text-[11px] text-fp-faint">{row.excludedBecause}</p>
                )}
              </div>
              <ConfirmAction
                label="Delete"
                confirmLabel="Erase it"
                ariaLabel={`Delete the correction from ${row.when}`}
                disabled={corrections.busy}
                onConfirm={() => {
                  void corrections.remove(row.id);
                }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12px] leading-snug text-fp-mute">{view.empty}</p>
      )}

      <HeadStatus
        state={corrections.state}
        busy={corrections.busy}
        personalEnabled={props.personalEnabled}
        onTogglePersonal={props.onTogglePersonal}
        onRefit={() => {
          void corrections.refit().then((report) => {
            if (report !== null) {
              setNote(
                report.installed
                  ? "Fitted and installed — it did not lose to the shipped head on the held-out eval."
                  : `Fitted and discarded — ${report.blockedBy ?? "a gate refused it"}. Your corrections are kept.`,
              );
            }
          });
        }}
      />

      {note === null ? null : (
        <p className="text-[12px] text-fp-lime" aria-live="polite">
          {note}
        </p>
      )}
      {corrections.error === null ? null : (
        <p className="text-[12px] text-fp-red" role="alert">
          {corrections.error}
        </p>
      )}
    </div>
  );
}
