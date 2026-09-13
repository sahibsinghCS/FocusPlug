/**
 * FNV-1a 32-bit — the one hash used by the telemetry ring, the recorder, and
 * the simulator. Window titles and process names leave memory only as these
 * hashes; switch/churn/distinctness signals survive losslessly, the strings
 * do not. Standard offset basis and prime so vectors are pinnable.
 */

export const FNV1A_OFFSET_BASIS = 0x811c9dc5;
export const FNV1A_PRIME = 0x01000193;

/** FNV-1a 32-bit over UTF-16 code units. Deterministic, unsigned result. */
export function fnv1a32(text: string): number {
  let hash = FNV1A_OFFSET_BASIS;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, FNV1A_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** Title identity as stored everywhere: hash of the lowercased title. */
export function titleHash(windowTitle: string): number {
  return fnv1a32(windowTitle.toLowerCase());
}

/** Process identity for on-disk rows (raw keys stay memory-only). */
export function processHash(processKey: string): number {
  return fnv1a32(processKey.toLowerCase());
}
