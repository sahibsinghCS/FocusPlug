import type { JSX } from "react";
import { FaceSolo, isFaceSolo } from "./features/faces";
import "./features/faces/faces.css";
import { AppStateProvider } from "./state/AppState";
import { Shell } from "./components/Shell";

export default function App(): JSX.Element {
  if (isFaceSolo()) {
    return <FaceSolo />;
  }
  return (
    <AppStateProvider>
      <Shell />
    </AppStateProvider>
  );
}
