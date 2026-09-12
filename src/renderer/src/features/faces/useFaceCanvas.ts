import { useEffect, type RefObject } from "react";
import { fitCanvas, prefersReducedMotion } from "./canvas";

export function useFaceCanvas(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number, clockMs: number) => void,
  deps: readonly unknown[],
  opts: { freeze?: boolean; paused?: boolean },
): void {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const freeze = opts.freeze || opts.paused || prefersReducedMotion();
    let frame = 0;
    let running = true;

    const paint = (clockMs: number): void => {
      const parent = canvas.parentElement;
      const w = parent?.clientWidth ?? canvas.clientWidth;
      const h = parent?.clientHeight ?? canvas.clientHeight;
      if (w < 8 || h < 8) {
        return;
      }
      const { ctx } = fitCanvas(canvas, w, h);
      draw(ctx, w, h, clockMs);
    };

    const ro = new ResizeObserver(() => {
      paint(freeze ? 0 : performance.now());
    });
    if (canvas.parentElement) {
      ro.observe(canvas.parentElement);
    }
    void document.fonts.ready.then(() => {
      if (running) {
        paint(0);
      }
    });
    paint(0);

    if (!freeze) {
      const loop = (clockMs: number): void => {
        if (!running) {
          return;
        }
        paint(clockMs);
        frame = window.requestAnimationFrame(loop);
      };
      frame = window.requestAnimationFrame(loop);
    }

    return () => {
      running = false;
      window.cancelAnimationFrame(frame);
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller owns the draw identity via deps
  }, [canvasRef, opts.freeze, opts.paused, ...deps]);
}
