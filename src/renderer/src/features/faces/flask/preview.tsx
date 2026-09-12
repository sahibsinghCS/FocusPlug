import { StrictMode, type JSX } from "react";
import { createRoot } from "react-dom/client";
import "../../../index.css";
import { FlaskVessel } from "./FlaskFace";
import { parseFlaskPreview } from "./preview";
import "./flask.css";

function Preview(): JSX.Element {
  const preview = parseFlaskPreview(window.location.search, window.location.hash);
  return (
    <div
      className="fp-flask-preview"
      data-scene={preview.scene}
      data-still={preview.freeze ? "1" : "0"}
      data-face="flask"
    >
      <div className="fp-flask-preview__stage">
        <FlaskVessel
          progress={preview.progress}
          phase={preview.phase}
          remainingMs={preview.remainingMs}
          elapsedMs={preview.elapsedMs}
          sessionId={preview.sessionId}
          width={1280}
          height={800}
          freeze={preview.freeze}
        />
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Flask preview root #root is missing");
}

createRoot(rootEl).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
