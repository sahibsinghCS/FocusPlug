import type { JSX } from "react";
import { AppStateProvider } from "./state/AppState";
import { Shell } from "./components/Shell";

export default function App(): JSX.Element {
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
