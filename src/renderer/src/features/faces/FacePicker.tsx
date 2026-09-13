import type { JSX, KeyboardEvent } from "react";
import { FACE_CATALOG, type FaceId, type FaceMeta } from "@shared/faces";
import { cn } from "../../lib/cn";

export function FacePicker(props: {
  value: FaceId;
  onChange: (id: FaceId) => void;
  layout: "rail" | "grid";
  faces?: readonly FaceMeta[];
  disabled?: boolean;
}): JSX.Element {
  const faces = props.faces ?? FACE_CATALOG;
  const selectedIndex = Math.max(
    0,
    faces.findIndex((face) => face.id === props.value),
  );

  function move(delta: number): void {
    const next = faces[(selectedIndex + delta + faces.length) % faces.length];
    if (next) {
      props.onChange(next.id);
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

  if (props.layout === "rail") {
    return (
      <label className="fp-face-picker-rail">
        <span className="sr-only">Session face</span>
        <select
          aria-label="Session face"
          value={props.value}
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.target.value as FaceId)}
          className="fp-control h-8 min-w-[11rem] px-2 font-mono text-[12px]"
        >
          {faces.map((face) => (
            <option key={face.id} value={face.id}>
              {face.title}
              {face.readiness === "pending" ? " · pending" : ""}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div
      role="radiogroup"
      aria-label="Session face"
      onKeyDown={onKeyDown}
      className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6"
    >
      {faces.map((face) => {
        const selected = props.value === face.id;
        return (
          <button
            key={face.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={props.disabled}
            tabIndex={selected ? 0 : -1}
            onClick={() => props.onChange(face.id)}
            className={cn(
              "rounded-md border px-3 py-2.5 text-left transition disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "border-fp-lime/50 bg-fp-lime/[0.07]"
                : "border-fp-line bg-fp-elev hover:bg-fp-hover",
            )}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-semibold">{face.title}</span>
              <span className="rounded border border-fp-line px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-fp-faint">
                {face.readiness === "ready" ? "Ready" : "Pending"}
              </span>
            </span>
            <span className="mt-1 block text-[11px] leading-snug text-fp-mute">{face.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}
