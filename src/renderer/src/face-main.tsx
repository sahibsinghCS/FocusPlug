import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { FlightFace } from "./features/faces/FlightFace";
import { parseFlightPreview } from "./features/faces/flight/preview";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Flight preview root #root is missing");
}

const preview = parseFlightPreview(window.location.search, window.location.hash);

createRoot(rootEl).render(
  <StrictMode>
    <FlightFace {...preview.face} />
  </StrictMode>,
);
