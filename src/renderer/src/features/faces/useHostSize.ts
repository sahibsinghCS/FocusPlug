import { useEffect, useState, type RefObject } from "react";

export const FACE_HOST_FALLBACK = { width: 960, height: 300 };

export function useHostSize(
  ref: RefObject<HTMLElement | null>,
  fallback: { width: number; height: number } = FACE_HOST_FALLBACK,
): { width: number; height: number } {
  const [size, setSize] = useState(fallback);

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
