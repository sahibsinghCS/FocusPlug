/** Hooks the flight paint loop needs from its host (rAF + current clock state). */
export interface FlightLoopDriver {
  paint: () => void;
  /** True when the face should hold still (clock paused or reduced motion). */
  isStatic: () => boolean;
  request: (callback: () => void) => number;
  cancel: (handle: number) => void;
}

export interface FlightLoop {
  /** Paint now and keep animating until static. No-op while a frame is already pending. */
  kick: () => void;
  /** Cancel the pending frame (document hidden); a later kick resumes. */
  suspend: () => void;
  /** Stop permanently (unmount). Further kicks do nothing. */
  stop: () => void;
}

/**
 * Single-chain animation loop for the flight canvas. Only one rAF chain can
 * ever be pending (fonts.ready / visibilitychange kicks never stack a second
 * one), and a kick after the chain parked itself on a paused clock restarts it.
 */
export function createFlightLoop(driver: FlightLoopDriver): FlightLoop {
  let handle = 0;
  let scheduled = false;
  let stopped = false;

  const tick = (): void => {
    scheduled = false;
    if (stopped) {
      return;
    }
    driver.paint();
    if (driver.isStatic()) {
      return;
    }
    scheduled = true;
    handle = driver.request(tick);
  };

  return {
    kick: (): void => {
      if (stopped || scheduled) {
        return;
      }
      tick();
    },
    suspend: (): void => {
      driver.cancel(handle);
      scheduled = false;
    },
    stop: (): void => {
      stopped = true;
      driver.cancel(handle);
      scheduled = false;
    },
  };
}
