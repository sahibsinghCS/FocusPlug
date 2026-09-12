import { useEffect, useMemo, useState, type JSX } from "react";
import { deriveFaceProps } from "./derive";
import { renderMidFace } from "./FaceSolo";
import type { FaceId, FaceProps, FaceRound, FaceSource } from "./types";
import { MID_FACE_IDS } from "./types";
import { readFaceUrl } from "./urlFace";

const PREF_KEY = "focusplug.face.mid";

export function readStoredFace(): FaceId {
  try {
    const raw = window.localStorage.getItem(PREF_KEY);
    if (raw === "movement" || raw === "line" || raw === "record") {
      return raw;
    }
  } catch {
    // private mode
  }
  const url = readFaceUrl();
  if (url.face && url.face !== "bar") {
    return url.face;
  }
  return "record";
}

export function FaceStage(props: {
  source: FaceSource;
  selected?: FaceId;
  onSelect?: (id: FaceId) => void;
}): JSX.Element {
  const [selected, setSelected] = useState<FaceId>(() => props.selected ?? readStoredFace());
  const face = deriveFaceProps(props.source);

  useEffect(() => {
    if (props.selected) {
      setSelected(props.selected);
    }
  }, [props.selected]);

  const pick = (id: FaceId): void => {
    setSelected(id);
    try {
      window.localStorage.setItem(PREF_KEY, id);
    } catch {
      // ignore
    }
    props.onSelect?.(id);
  };

  return (
    <section className="fp-face-stage" aria-label="Session face">
      <div className="fp-face-stage-bar">
        <p className="fp-face-stage-kicker">Face</p>
        <div className="fp-face-tabs" role="tablist" aria-label="Mid pack faces">
          {MID_FACE_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={selected === id}
              className={selected === id ? "is-on" : undefined}
              onClick={() => {
                pick(id);
              }}
            >
              {labelFor(id)}
            </button>
          ))}
        </div>
      </div>
      <div className="fp-face-stage-body">{renderMidFace(selected, face)}</div>
    </section>
  );
}

export function useLiveFaceProps(source: FaceSource): FaceProps {
  return useMemo(() => deriveFaceProps(source), [source]);
}

export function defaultDemoRounds(): readonly FaceRound[] {
  return [
    { id: "r1", label: "Round 1", start: 0, end: 0.28, kind: "focus" },
    { id: "b1", label: "Break", start: 0.28, end: 0.4, kind: "break" },
    { id: "r2", label: "Round 2", start: 0.4, end: 0.7, kind: "focus" },
    { id: "b2", label: "Break", start: 0.7, end: 0.82, kind: "break" },
    { id: "r3", label: "Round 3", start: 0.82, end: 1, kind: "focus" },
  ];
}

function labelFor(id: FaceId): string {
  if (id === "movement") {
    return "Movement";
  }
  if (id === "line") {
    return "Line";
  }
  return "The Record";
}
