export { analyzeDeskFrame } from "./analyze";
export { createDefaultFrameSource, NullFrameSource, ScriptedFrameSource } from "./camera";
export {
  AT_DESK_MIN_PROB,
  classifyDesk,
  sceneIsOccluded,
  UNCERTAIN_MIN_PROB,
} from "./classify";
export { decodeImageBuffer } from "./frame";
export {
  BLAZEFACE_GRAPH_ID,
  BlazeFaceDeskModel,
  createDeskModel,
  DEFAULT_DESK_MODEL_ID,
  deskModelFactory,
  getSharedDeskModel,
  resolveDeskModelId,
  StubDeskModel,
  YourModel,
} from "./model";
export {
  createDeskMonitor,
  DEFAULT_DESK_INTERVAL_MS,
  DeskMonitor,
  type DeskMonitorOptions,
} from "./monitor";
export type { DeskAnalysis, DeskDebug, FaceSignal, FrameSource, RgbFrame } from "./types";
