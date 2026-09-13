import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./demo.css";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("FocusPlug demo: #root is missing");
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
