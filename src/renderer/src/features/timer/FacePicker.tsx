import { useEffect, useState, type JSX } from "react";
import { cn } from "../../lib/cn";
import { FACES, type FaceId } from "./faces";

const DEMO_MS = 9000;
const DEMO_TICK_MS = 60;
const DEMO_SESSION_SEC = 25 * 60;

/**
 * One clock drives every preview, so the six faces run in lockstep and you are
 * comparing the same moment of the same session six ways. Picking a face is
 * the one decision on this panel that is purely taste, so it gets to be the
 * thing you actually look at.
 */
function useDemoProgress(): number {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const id = setInterval(() => {
      setProgress(((performance.now() - started) % DEMO_MS) / DEMO_MS);
    }, DEMO_TICK_MS);
    return () => clearInterval(id);
  }, []);

  return progress;
}

export function FacePicker(props: {
  value: FaceId;
  onPick: (id: FaceId) => void;
}): JSX.Element {
  const progress = useDemoProgress();
  const remainingSec = Math.round((1 - progress) * DEMO_SESSION_SEC);

  return (
    <div
      className="grid grid-cols-3 gap-2 min-[760px]:grid-cols-6"
      role="group"
      aria-label="Timer face"
    >
      {FACES.map((face) => {
        const selected = props.value === face.id;
        return (
          <button
            key={face.id}
            type="button"
            aria-pressed={selected}
            title={face.blurb}
            onClick={() => props.onPick(face.id)}
            style={{ ["--ground" as string]: "var(--color-fp-elev)" }}
            className={cn(
              "fp-btn group flex flex-col items-center gap-2 rounded-[var(--radius-fp-sm)] border bg-fp-elev px-2 pb-2 pt-3",
              selected
                ? "border-fp-ink/70 bg-fp-hover"
                : "border-fp-line hover:border-fp-line-strong hover:bg-fp-hover",
            )}
          >
            <span
              className={cn(
                "fp-face-preview flex h-[84px] w-full items-center justify-center overflow-hidden",
                selected ? "text-fp-ink" : "text-fp-mute group-hover:text-fp-ink",
              )}
            >
              <face.Face
                progress={progress}
                remainingSec={remainingSec}
                preview
                className={face.ambient ? "h-full w-full" : "h-full w-auto"}
              />
            </span>
            <span
              className={cn(
                "fp-display text-[12.5px] font-semibold",
                selected ? "text-fp-ink" : "text-fp-mute",
              )}
            >
              {face.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
