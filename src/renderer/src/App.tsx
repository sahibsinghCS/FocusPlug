import { useEffect, useState, type JSX } from "react";
import { FaceSolo, isFaceSolo, readFaceUrl } from "./features/faces";
import "./features/faces/faces.css";
import { AppStateProvider } from "./state/AppState";
import { Shell } from "./components/Shell";

export default function App(): JSX.Element {
  const [href, setHref] = useState(() => window.location.href);

  useEffect(() => {
    const sync = (): void => {
      setHref(window.location.href);
    };
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, []);

  if (isFaceSolo(readFaceUrl())) {
    return <FaceSolo key={href} />;
  }
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
