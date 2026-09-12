import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { FacesPreview } from "./features/faces/preview/FacesPreview";
import "./index.css";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("FocusPlug faces preview root #root is missing");
}

createRoot(rootEl).render(
  <StrictMode>
    <FacesPreview />
  </StrictMode>,
);
