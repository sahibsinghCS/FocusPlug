import type { JSX, ReactNode } from "react";
import { faceMeta, type FaceId } from "@shared/faces";
import type { FaceProps } from "./types";

export function PendingFace(props: FaceProps & { id: FaceId; silhouette: ReactNode }): JSX.Element {
  const meta = faceMeta(props.id);
  return (
    <div
      className="fp-face-pending relative flex h-full w-full flex-col items-center justify-center overflow-hidden"
      data-face={props.id}
      data-face-status="pending"
    >
      <div className="fp-face-pending-grid" aria-hidden="true" />
      <div className="relative z-[1] flex flex-col items-center gap-3 px-6 text-center">
        <div className="fp-face-pending-sil text-fp-faint" aria-hidden="true">
          {props.silhouette}
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-fp-faint">
          Stream not merged
        </p>
        <h2 className="text-[22px] font-semibold tracking-tight text-fp-ink">{meta.title}</h2>
        <p className="max-w-md text-[13px] leading-5 text-fp-mute">{meta.blurb}</p>
        <p className="font-mono text-[11px] text-fp-faint">
          {meta.stream} · replace {meta.file.split("/").pop()}
        </p>
      </div>
    </div>
  );
}
