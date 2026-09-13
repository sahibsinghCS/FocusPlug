/** Catalog tiles and other hosts shorter than this get the sticker / object crop. */
export const FACE_THUMB_MAX_HEIGHT = 140;

/** True for setup-picker tiles (~84px, sometimes 58px) and any host under ~140px. */
export function isFaceThumb(height: number): boolean {
  return Number.isFinite(height) && height > 0 && height < FACE_THUMB_MAX_HEIGHT;
}
