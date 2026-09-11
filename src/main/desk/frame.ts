import { decode as decodeJpeg } from "jpeg-js";
import { PNG } from "pngjs";
import type { FrameStats, RgbFrame } from "./types";

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47];

export function isPng(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === PNG_SIG[0] &&
    buffer[1] === PNG_SIG[1] &&
    buffer[2] === PNG_SIG[2] &&
    buffer[3] === PNG_SIG[3]
  );
}

export function isJpeg(buffer: Uint8Array): boolean {
  return buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xd8;
}

export function rgbaToRgb(rgba: Uint8Array, pixelCount: number): Uint8Array {
  const rgb = new Uint8Array(pixelCount * 3);
  for (let i = 0; i < pixelCount; i += 1) {
    const si = i * 4;
    const di = i * 3;
    rgb[di] = rgba[si] ?? 0;
    rgb[di + 1] = rgba[si + 1] ?? 0;
    rgb[di + 2] = rgba[si + 2] ?? 0;
  }
  return rgb;
}

export function decodeImageBuffer(buffer: Uint8Array): RgbFrame {
  if (isPng(buffer)) {
    const png = PNG.sync.read(Buffer.from(buffer));
    return {
      width: png.width,
      height: png.height,
      data: rgbaToRgb(png.data, png.width * png.height),
    };
  }
  if (isJpeg(buffer)) {
    const jpeg = decodeJpeg(buffer, { maxMemoryUsageInMB: 256 });
    return {
      width: jpeg.width,
      height: jpeg.height,
      data: rgbaToRgb(jpeg.data, jpeg.width * jpeg.height),
    };
  }
  throw new Error("Unsupported image format (expected JPEG or PNG)");
}

export function decodeDataUrl(dataUrl: string): RgbFrame {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) {
    throw new Error("Invalid image data URL");
  }
  const b64 = dataUrl.slice(comma + 1);
  return decodeImageBuffer(new Uint8Array(Buffer.from(b64, "base64")));
}

export function frameStats(frame: RgbFrame): FrameStats {
  const pixels = frame.width * frame.height;
  if (pixels <= 0) {
    return { width: frame.width, height: frame.height, meanLuma: 0, lumaStd: 0 };
  }
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < pixels; i += 1) {
    const o = i * 3;
    const r = frame.data[o] ?? 0;
    const g = frame.data[o + 1] ?? 0;
    const b = frame.data[o + 2] ?? 0;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    sum += luma;
    sumSq += luma * luma;
  }
  const meanLuma = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - meanLuma * meanLuma);
  return {
    width: frame.width,
    height: frame.height,
    meanLuma,
    lumaStd: Math.sqrt(variance),
  };
}

export function resizeMaxSide(frame: RgbFrame, maxSide: number): RgbFrame {
  const longSide = Math.max(frame.width, frame.height);
  if (longSide <= maxSide) {
    return frame;
  }
  const scale = maxSide / longSide;
  const width = Math.max(1, Math.round(frame.width * scale));
  const height = Math.max(1, Math.round(frame.height * scale));
  return resizeNearest(frame, width, height);
}

export function resizeNearest(frame: RgbFrame, width: number, height: number): RgbFrame {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    const srcY = Math.min(frame.height - 1, Math.floor((y * frame.height) / height));
    for (let x = 0; x < width; x += 1) {
      const srcX = Math.min(frame.width - 1, Math.floor((x * frame.width) / width));
      const si = (srcY * frame.width + srcX) * 3;
      const di = (y * width + x) * 3;
      data[di] = frame.data[si] ?? 0;
      data[di + 1] = frame.data[si + 1] ?? 0;
      data[di + 2] = frame.data[si + 2] ?? 0;
    }
  }
  return { width, height, data };
}
