import { useEffect, useMemo, useState, type JSX } from "react";
import { CircuitFace } from "../circuit";
import { DescentFace } from "../descent";
import { OrbitFace } from "../orbit";
import { FACE_CATALOG } from "../register";
import type { FaceId, FaceProps } from "../types";
import { parsePreview } from "./parsePreview";
import { PlainBar } from "./PlainBar";
import "./preview.css";

function usePreviewQuery() {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onHash = (): void => {
      setHash(window.location.hash);
    };
    window.addEventListener("hashchange", onHash);
    if (!window.location.hash) {
      window.location.hash = "#/descent?p=0.62";
    }
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  return parsePreview(hash);
}

function faceProps(query: ReturnType<typeof parsePreview>, size: FaceProps["size"]): FaceProps {
  return {
    progress: query.progress,
    phase: query.phase,
    events: [],
    killCount: query.killCount,
    now: query.now,
    size,
  };
}

function FaceById(props: { id: FaceId; face: FaceProps }): JSX.Element {
  if (props.id === "descent") return <DescentFace {...props.face} />;
  if (props.id === "orbit") return <OrbitFace {...props.face} />;
  return <CircuitFace {...props.face} />;
}

export function FacesPreview(): JSX.Element {
  const query = usePreviewQuery();
  const title = query.kind === "bar" ? "Plain bar" : FACE_CATALOG[query.kind].title;

  const soloSize = useMemo(() => ({ width: 1120, height: 680 }), []);
  const splitSize = useMemo(() => ({ width: 560, height: 640 }), []);

  return (
    <div className="fp-faces-stage" data-preview-kind={query.kind} data-preview-vs={query.vs ? "1" : "0"}>
      <header className="fp-faces-chrome">
        <span className="fp-faces-brand">FocusPlug</span>
        <span className="fp-faces-name">
          {query.vs ? `A/B · ${title}` : title} · {Math.round(query.progress * 100)}%
        </span>
      </header>
      <main className="fp-faces-canvas">
        {query.kind === "bar" ? (
          <PlainBar progress={query.progress} width={1120} height={680} />
        ) : query.vs ? (
          <div className="fp-faces-split">
            <PlainBar progress={query.progress} width={560} height={640} />
            <FaceById id={query.kind} face={faceProps(query, splitSize)} />
          </div>
        ) : (
          <FaceById id={query.kind} face={faceProps(query, soloSize)} />
        )}
      </main>
    </div>
  );
}
