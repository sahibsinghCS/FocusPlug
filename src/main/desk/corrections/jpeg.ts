import { encode as encodeJpeg } from "jpeg-js";
import {
  CORRECTION_JPEG_QUALITY,
  CORRECTION_THUMB_MAX_SIDE,
  CORRECTION_THUMB_QUALITY,
} from "@shared/correction/constants";
import { resizeMaxSide } from "../frame";
import type { RgbFrame } from "../types";

/**
 * RGB → RGBA → JPEG, the same three lines `scripts/desk-model/capture-
 * attention.ts` uses, so a correction frame and a captured clip frame are the
 * same kind of file and `extract-features.ts` can read either.
 */
export function encodeFrameJpeg(
  frame: RgbFrame,
  quality: number = CORRECTION_JPEG_QUALITY,
): Buffer {
  const pixels = Math.max(0, frame.width * frame.height);
  const rgba = Buffer.alloc(pixels * 4);
  for (let i = 0; i < pixels; i += 1) {
    const src = i * 3;
    const dst = i * 4;
    rgba[dst] = frame.data[src] ?? 0;
    rgba[dst + 1] = frame.data[src + 1] ?? 0;
    rgba[dst + 2] = frame.data[src + 2] ?? 0;
    rgba[dst + 3] = 255;
  }
  return Buffer.from(
    encodeJpeg({ data: rgba, width: frame.width, height: frame.height }, quality).data,
  );
}

/**
 * The 160 px thumbnail the review list draws.
 *
 * Written at capture time so the list costs one read per correction rather
 * than a decode-and-resize of a native-size frame, and so *Reveal folder*
 * shows the student the same picture the screen just showed them.
 */
export function encodeThumbJpeg(frame: RgbFrame): Buffer {
  return encodeFrameJpeg(
    resizeMaxSide(frame, CORRECTION_THUMB_MAX_SIDE),
    CORRECTION_THUMB_QUALITY,
  );
}

/** The review list ships thumbnails inline; full frames never cross the wire. */
export function thumbDataUrl(jpeg: Uint8Array): string {
  return `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}`;
}
