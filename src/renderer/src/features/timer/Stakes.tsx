import type { JSX } from "react";
import type { AppLists, AppSettings } from "@shared/ipc";
import { Led } from "../../components/ui";
import { enabledPlugViews, type PlugView } from "../../lib/plugsUi";
import { deskModelLabel } from "../../lib/format";
import { routeHash } from "../../lib/routes";

/**
 * What you are agreeing to. Named apps and named devices — a student should
 * never have to open Settings to find out what is about to be force-quit.
 */
export function Stakes(props: {
  lists: AppLists;
  plugs: readonly PlugView[];
  settings: AppSettings;
}): JSX.Element {
  const blocked = props.lists.blocklist.filter((entry) => entry.enabled);
  const allowed = props.lists.allowlist.filter((entry) => entry.enabled);
  const armedPlugs = enabledPlugViews(props.plugs);

  return (
    <section className="fp-card flex min-w-0 flex-col gap-3 p-4" aria-labelledby="fp-stakes">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="fp-stakes" className="fp-stencil">
          When you drift
        </h2>
        <a
          href={routeHash("blocklist")}
          className="fp-btn text-[12px] font-medium text-fp-mute hover:text-fp-focus"
        >
          Edit lists
        </a>
      </div>

      <Row
        tone="red"
        title={blocked.length > 0 ? namesOf(blocked, 3) : "No apps armed"}
        detail={
          blocked.length > 0
            ? `${blocked.length} blocked app${blocked.length === 1 ? "" : "s"} get force-quit`
            : "Add Discord or a game to the blocklist"
        }
      />
      <Row
        tone={armedPlugs.length > 0 ? "red" : "mute"}
        title={armedPlugs.length > 0 ? namesOf(armedPlugs, 2) : "No plugs armed"}
        detail={
          armedPlugs.length > 0
            ? "Cut at the wall. Never the study PC"
            : "Optional — add a LAN smart plug for fun devices"
        }
      />
      <Row
        tone={props.settings.webcamEnabled ? "focus" : "mute"}
        title={props.settings.webcamEnabled ? "Desk AI watches the chair" : "Desk AI off"}
        detail={
          props.settings.webcamEnabled
            ? `${deskModelLabel(props.settings.deskModelId)} on-device · frames never leave the machine`
            : "Window focus alone decides whether you are on task"
        }
      />
      <Row
        tone="focus"
        title={allowed.length > 0 ? `${namesOf(allowed, 2)} stay open` : "Nothing allowlisted yet"}
        detail={
          allowed.length > 0
            ? `${allowed.length} study app${allowed.length === 1 ? "" : "s"} count as on task`
            : "Add the app your assignment lives in"
        }
      />
    </section>
  );
}

function namesOf(entries: ReadonlyArray<{ name: string }>, limit: number): string {
  const shown = entries.slice(0, limit).map((entry) => entry.name);
  const rest = entries.length - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

function Row(props: {
  tone: "red" | "focus" | "mute";
  title: string;
  detail: string;
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-start gap-2.5">
      <Led tone={props.tone} className="mt-[7px]" />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium text-fp-ink">{props.title}</p>
        <p className="truncate text-[12px] text-fp-faint">{props.detail}</p>
      </div>
    </div>
  );
}
