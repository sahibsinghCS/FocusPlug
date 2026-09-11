import { useMemo, useState, type JSX } from "react";
import { formatClock } from "../lib/format";
import { useAppState } from "../state/AppState";
import { PageIntro, TextInput } from "../components/ui";

export function LogPage(): JSX.Element {
  const app = useAppState();
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle.length === 0) {
      return app.log;
    }
    return app.log.filter(
      (event) =>
        event.kind.toLowerCase().includes(needle) ||
        event.detail.toLowerCase().includes(needle),
    );
  }, [app.log, query]);

  return (
    <div className="page">
      <PageIntro
        kicker="Timeline"
        title="Session log"
        meta={
          <div className="w-56">
            <TextInput value={query} onChange={setQuery} placeholder="Filter events" />
          </div>
        }
      />

      {rows.length === 0 ? (
        <p className="empty">No events yet. Start a session to record window, desk, and kill activity.</p>
      ) : (
        <div className="plate plate-pad">
          <table className="log-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Kind</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((event, index) => {
                const kill = event.kind.toLowerCase().includes("kill");
                return (
                  <tr key={`${event.ts}-${event.kind}-${index}`}>
                    <td className="tape-time">{formatClock(event.ts)}</td>
                    <td className={kill ? "tone-kill" : undefined}>{event.kind}</td>
                    <td title={event.detail}>{event.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
