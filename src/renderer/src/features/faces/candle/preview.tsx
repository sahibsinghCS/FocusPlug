import { StrictMode, type JSX } from "react";
import { createRoot } from "react-dom/client";
import "../../../index.css";
import { CandleVessel } from "./CandleFace";
import { parseCandlePreview } from "./preview";
import "./candle.css";

function Preview(): JSX.Element {
  const preview = parseCandlePreview(window.location.search, window.location.hash);
  return (
    <div
      className="fp-candle-preview"
      data-scene={preview.scene}
      data-still={preview.freeze ? "1" : "0"}
      data-face="candle"
    >
      <div className="fp-candle-preview__stage">
        <CandleVessel
          progress={preview.progress}
          phase={preview.phase}
          remainingMs={preview.remainingMs}
          elapsedMs={preview.elapsedMs}
          sessionId={preview.sessionId}
          killCount={preview.killCount}
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
  throw new Error("Candle preview root #root is missing");
}

createRoot(rootEl).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
