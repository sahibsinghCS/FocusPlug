export { analyzeDeskFrame } from "./analyze";
export { createDefaultFrameSource, NullFrameSource, ScriptedFrameSource } from "./camera";
export {
  AT_DESK_MIN_PROB,
  classifyDesk,
  sceneIsOccluded,
  UNCERTAIN_MIN_PROB,
} from "./classify";
export { BlazeFaceDetector, DESK_MODEL_ID, getSharedDetector } from "./detector";
export { decodeImageBuffer } from "./frame";
export {
  createDeskMonitor,
  DEFAULT_DESK_INTERVAL_MS,
  DeskMonitor,
  type DeskMonitorOptions,
} from "./monitor";
export type { DeskAnalysis, DeskDebug, FaceSignal, FrameSource, RgbFrame } from "./types";
