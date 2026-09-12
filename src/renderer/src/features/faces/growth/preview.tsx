import { StrictMode, type JSX } from "react";
import { createRoot } from "react-dom/client";
import "../../../index.css";
import { GrowthFace } from "./GrowthFace";
import "./growth.css";
import { GROWTH_SCENES, parseGrowthScene, sceneToProps } from "./scenes";

function Preview(): JSX.Element {
  const params = new URLSearchParams(window.location.search);
  const scene = parseGrowthScene(window.location.search);
  const still = params.get("still") !== null;
  const healthy = GROWTH_SCENES.healthy;
  const wilted = GROWTH_SCENES.wilted;

  return (
    <div className="fp-growth-preview" data-scene={scene} data-still={still ? "1" : "0"}>
      <div className="fp-growth-preview__stage">
        {scene === "diptych" ? (
          <div className="fp-growth-preview__pair">
            <figure>
              {still ? null : <p className="fp-growth-preview__caption">{healthy.label}</p>}
              <GrowthFace {...sceneToProps(healthy)} width={520} height={700} />
            </figure>
            <figure>
              {still ? null : <p className="fp-growth-preview__caption">{wilted.label}</p>}
              <GrowthFace {...sceneToProps(wilted)} width={520} height={700} />
            </figure>
          </div>
        ) : (
          <figure>
            {still ? null : <p className="fp-growth-preview__caption">{GROWTH_SCENES[scene].label}</p>}
            <GrowthFace {...sceneToProps(GROWTH_SCENES[scene])} width={560} height={740} />
          </figure>
        )}
      </div>
    </div>
  );
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Growth preview root #root is missing");
}

createRoot(rootEl).render(
  <StrictMode>
    <Preview />
  </StrictMode>,
);
