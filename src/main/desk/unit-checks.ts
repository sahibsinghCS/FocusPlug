import { classifyDesk } from "./classify";
import type { FaceSignal, FrameStats } from "./types";

export interface UnitCheckResult {
  name: string;
  pass: boolean;
  detail: string;
}

function deskFrame(width = 640, height = 480, meanLuma = 80): FrameStats {
  return { width, height, meanLuma, lumaStd: 20 };
}

function faceAt(
  probability: number,
  box: FaceSignal["box"],
  landmarks?: FaceSignal["landmarks"],
): FaceSignal {
  return {
    probability,
    box,
    landmarks: landmarks ?? [
      { x: box.x0 + 20, y: box.y0 + 24 },
      { x: box.x1 - 20, y: box.y0 + 24 },
      { x: (box.x0 + box.x1) / 2, y: box.y0 + 40 },
      { x: (box.x0 + box.x1) / 2, y: box.y0 + 70 },
    ],
  };
}

export function runClassifyUnitChecks(): UnitCheckResult[] {
  const results: UnitCheckResult[] = [];

  function check(name: string, pass: boolean, detail: string): void {
    results.push({ name, pass, detail });
  }

  const disabled = classifyDesk({
    ts: 1,
    webcamEnabled: false,
    frame: deskFrame(),
    faces: [faceAt(0.99, { x0: 80, y0: 60, x1: 280, y1: 300 })],
  });
  check(
    "disabled webcam is never at_desk",
    disabled.label === "uncertain" && disabled.webcamEnabled === false && disabled.confidence === 0,
    JSON.stringify(disabled),
  );

  const missing = classifyDesk({
    ts: 2,
    webcamEnabled: true,
    frame: null,
    faces: [],
  });
  check(
    "missing frame is uncertain, not at_desk",
    missing.label === "uncertain" && missing.webcamEnabled === true,
    JSON.stringify(missing),
  );

  const present = classifyDesk({
    ts: 3,
    webcamEnabled: true,
    frame: deskFrame(),
    faces: [faceAt(0.91, { x0: 120, y0: 80, x1: 360, y1: 360 })],
  });
  check(
    "strong face is at_desk with model confidence",
    present.label === "at_desk" && present.confidence === 0.91,
    JSON.stringify(present),
  );

  const covered = classifyDesk({
    ts: 4,
    webcamEnabled: true,
    frame: { width: 640, height: 480, meanLuma: 3, lumaStd: 1 },
    faces: [],
  });
  check(
    "no-face covered/empty frame is away",
    covered.label === "away" && covered.confidence >= 0.6,
    JSON.stringify(covered),
  );

  const tiny = classifyDesk({
    ts: 5,
    webcamEnabled: true,
    frame: deskFrame(),
    faces: [faceAt(0.99, { x0: 0, y0: 0, x1: 8, y1: 8 })],
  });
  check(
    "tiny face is not at_desk",
    tiny.label !== "at_desk",
    JSON.stringify(tiny),
  );

  const inverted = classifyDesk({
    ts: 6,
    webcamEnabled: true,
    frame: deskFrame(),
    faces: [
      faceAt(0.95, { x0: 100, y0: 80, x1: 340, y1: 340 }, [
        { x: 140, y: 280 },
        { x: 300, y: 280 },
        { x: 220, y: 200 },
        { x: 220, y: 120 },
      ]),
    ],
  });
  check(
    "implausible landmarks are not at_desk",
    inverted.label !== "at_desk",
    JSON.stringify(inverted),
  );

  const again = classifyDesk({
    ts: 7,
    webcamEnabled: true,
    frame: deskFrame(),
    faces: [faceAt(0.91, { x0: 120, y0: 80, x1: 360, y1: 360 })],
  });
  check(
    "classify is deterministic",
    again.label === present.label && again.confidence === present.confidence,
    JSON.stringify({ present, again }),
  );

  return results;
}
