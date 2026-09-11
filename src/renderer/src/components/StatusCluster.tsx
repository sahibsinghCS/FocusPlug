import { useEffect, useState, type JSX } from "react";
import { deskChrome, formatHmClock, plugChrome, sessionChrome } from "../lib/format";
import { navigate } from "../lib/routes";
import { useAppState } from "../state/AppState";
import { StatusPill } from "./ui";

export function StatusCluster(): JSX.Element {
  const app = useAppState();
  const session = sessionChrome(app.state);
  const desk = deskChrome(app.state.desk);
  const plugs = plugChrome(app.plugs);

  return (
    <div
      className="flex min-w-0 items-center gap-1.5"
      role="group"
      aria-label="Live session, desk AI, and plug status"
    >
      <StatusPill
        label={session.label}
        detail={session.detail}
        tone={session.tone}
        live={session.live}
        onClick={() => navigate("session")}
      />
      <StatusPill
        label={desk.label}
        detail={desk.detail}
        tone={desk.tone}
        live={desk.live}
        onClick={() => navigate("settings")}
      />
      <StatusPill
        label={plugs.label}
        detail={plugs.detail}
        tone={plugs.tone}
        live={plugs.live}
        onClick={() => navigate("plugs")}
      />
    </div>
  );
}

export function useClock(): string {
  const [now, setNow] = useState(() => formatHmClock(Date.now()));

  useEffect(() => {
    const id = window.setInterval(() => {
      setNow(formatHmClock(Date.now()));
    }, 1000);
    return () => window.clearInterval(id);
  }, []);

  return now;
}