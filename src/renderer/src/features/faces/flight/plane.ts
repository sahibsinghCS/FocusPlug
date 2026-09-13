/**
 * Top-down airliner, nose up, in an 80×80 box centred on (40, 40). The wingspan
 * runs from x 6 to 74. The lock plane mark (SVG) and the canvas map (Path2D)
 * both draw this, so the plane on the whole map is the one you saw in flight.
 */
export const PLANE_PATH =
  "M40 3C42.6 3 43.6 7 43.6 12L43.6 33L74 51L74 55.5L43.6 47.5L43.2 63L55 71L55 74.5L42.4 71.5L41.2 77L38.8 77L37.6 71.5L25 74.5L25 71L36.8 63L36.4 47.5L6 55.5L6 51L36.4 33L36.4 12C36.4 7 37.4 3 40 3Z" +
  "M22.5 38.2a2.2 2.2 0 0 1 4.4 0v5.6a2.2 2.2 0 0 1-4.4 0z" +
  "M50.9 38.2a2.2 2.2 0 0 1 4.4 0v5.6a2.2 2.2 0 0 1-4.4 0z";

/** Side of the square the path is drawn in. */
export const PLANE_BOX = 80;

/** Wingspan in path units. */
export const PLANE_SPAN = 68;
