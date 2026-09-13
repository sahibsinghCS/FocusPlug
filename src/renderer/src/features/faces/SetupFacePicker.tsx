import { useMemo, useRef, type JSX, type KeyboardEvent } from "react";
import { FACE_CATALOG, faceMeta, type FaceId } from "@shared/faces";
import { cn } from "../../lib/cn";
import { FaceErrorBoundary } from "./FaceHost";
import { previewFaceProps, PREVIEW_FALLBACK } from "./previewProps";
import { faceComponent } from "./registry";
import { useHostSize } from "./useHostSize";
import "./faces.css";

export function SetupFacePicker(props: {
  value: FaceId;
  estimateMinutes: number;
  onPick: (id: FaceId) => void;
  disabled?: boolean;
}): JSX.Element {
  const faces = FACE_CATALOG;
  const selectedIndex = Math.max(
    0,
    faces.findIndex((face) => face.id === props.value),
  );
  const now = useMemo(() => new Date(), []);

  function move(delta: number): void {
    const next = faces[(selectedIndex + delta + faces.length) % faces.length];
    if (next) {
      props.onPick(next.id);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Timer face"
      onKeyDown={onKeyDown}
      className="grid grid-cols-3 gap-2 min-[700px]:grid-cols-5 min-[1100px]:grid-cols-7"
    >
      {faces.map((face) => {
        const selected = props.value === face.id;
        return (
          <button
            key={face.id}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`${face.title}. ${face.blurb}`}
            disabled={props.disabled}
            tabIndex={selected ? 0 : -1}
            title={face.blurb}
            onClick={() => props.onPick(face.id)}
            className={cn(
              "fp-btn group flex flex-col items-center gap-2 rounded-[var(--radius-fp-sm)] border bg-fp-elev px-2 pb-2 pt-3",
              selected
                ? "border-fp-ink/70 bg-fp-hover"
                : "border-fp-line hover:border-fp-line-strong hover:bg-fp-hover",
            )}
          >
            <FacePreview
              faceId={face.id}
              estimateMinutes={props.estimateMinutes}
              now={now}
            />
            <span
              className={cn(
                "fp-display text-[12.5px] font-semibold",
                selected ? "text-fp-ink" : "text-fp-mute",
              )}
            >
              {face.title}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function FacePreview(props: {
  faceId: FaceId;
  estimateMinutes: number;
  now: Date;
}): JSX.Element {
  const boxRef = useRef<HTMLSpanElement | null>(null);
  const size = useHostSize(boxRef, PREVIEW_FALLBACK);
  const Face = faceComponent(props.faceId);
  const face = previewFaceProps({
    estimateMinutes: props.estimateMinutes,
    width: size.width,
    height: size.height,
    now: props.now,
  });
  const meta = faceMeta(props.faceId);

  return (
    <span
      ref={boxRef}
      className="fp-face-preview fp-setup-face-preview flex w-full items-center justify-center overflow-hidden"
      data-face={props.faceId}
    >
      <FaceErrorBoundary faceId={props.faceId}>
        <Face {...face} />
      </FaceErrorBoundary>
      <span className="sr-only">{meta.blurb}</span>
    </span>
  );
}
