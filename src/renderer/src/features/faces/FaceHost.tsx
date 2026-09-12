import {
  Component,
  useEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";
import { FACE_CATALOG, faceMeta, type FaceId } from "@shared/faces";
import { cn } from "../../lib/cn";
import { FacePicker } from "./FacePicker";
import { faceComponent } from "./registry";
import type { FaceProps } from "./types";
import "./faces.css";

const FALLBACK_SIZE = { width: 960, height: 300 };

function useHostSize(ref: RefObject<HTMLElement | null>): { width: number; height: number } {
  const [size, setSize] = useState(FALLBACK_SIZE);

  useEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return;
    }
    const apply = (width: number, height: number): void => {
      const nextWidth = Math.max(1, Math.round(width));
      const nextHeight = Math.max(1, Math.round(height));
      setSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight },
      );
    };
    apply(node.clientWidth, node.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) {
        return;
      }
      apply(box.width, box.height);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [ref]);

  return size;
}

class FaceErrorBoundary extends Component<
  { faceId: FaceId; children: ReactNode },
  { error: string | null; faceId: FaceId }
> {
  state = { error: null as string | null, faceId: this.props.faceId };

  static getDerivedStateFromError(error: Error): { error: string } {
    return { error: error.message || "Face failed to render" };
  }

  static getDerivedStateFromProps(
    props: { faceId: FaceId },
    state: { error: string | null; faceId: FaceId },
  ): { error: string | null; faceId: FaceId } | null {
    if (props.faceId !== state.faceId) {
      return { error: null, faceId: props.faceId };
    }
    return null;
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="fp-face-crash" role="alert">
          <p className="fp-section-label text-fp-red">Face fault</p>
          <p className="mt-2 text-[14px] text-fp-ink">{this.props.faceId} failed to render.</p>
          <p className="mt-1 text-[12px] text-fp-mute">{this.state.error}</p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function FaceHost(props: {
  faceId: FaceId;
  face: Omit<FaceProps, "width" | "height">;
  onFaceId: (id: FaceId) => void;
  picker?: "rail" | "none";
  className?: string;
}): JSX.Element {
  const hostRef = useRef<HTMLElement | null>(null);
  const size = useHostSize(hostRef);
  const Face = faceComponent(props.faceId);
  const meta = faceMeta(props.faceId);
  const faceProps: FaceProps = {
    ...props.face,
    width: size.width,
    height: size.height,
  };

  return (
    <section
      ref={hostRef}
      className={cn("fp-face-host", props.className)}
      aria-label={`${meta.title} session face`}
      data-face={props.faceId}
    >
      <div className="fp-face-host-bar">
        <div className="min-w-0">
          <p className="fp-section-label">Session face</p>
          <p className="mt-0.5 truncate text-[13px] text-fp-mute">{meta.blurb}</p>
        </div>
        {props.picker === "none" ? null : (
          <FacePicker
            value={props.faceId}
            onChange={props.onFaceId}
            layout="rail"
            faces={FACE_CATALOG}
          />
        )}
      </div>
      <div className="fp-face-stage">
        <FaceErrorBoundary faceId={props.faceId}>
          <Face {...faceProps} />
        </FaceErrorBoundary>
      </div>
    </section>
  );
}
