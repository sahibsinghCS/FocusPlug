export { analyzeDeskFrame } from "./analyze";
export { createDefaultFrameSource, NullFrameSource, ScriptedFrameSource } from "./camera";
export {
  AT_DESK_MIN_PROB,
  classifyDesk,
  sceneIsOccluded,
  UNCERTAIN_MIN_PROB,
} from "./classify";
export {
  createDeskCorrections,
  createPersonalRefit,
  DeskCorrections,
  PersonalRefit,
  correctionsPath,
  DESK_CORRECTIONS_DIR,
  personalAttentionHeadPath,
  refitReportPath,
  type CorrectionsSeam,
  type DeskCorrectionsOptions,
  type OpenPauseCapture,
} from "./corrections/index";
export { decodeImageBuffer } from "./frame";
export { FrameRing, type RetainedFrame } from "./frameRing";
export {
  applyPersonalAttentionHead,
  ATTENTION_ANCHORS_RELATIVE_PATH,
  ATTENTION_HEAD_RELATIVE_PATH,
  attentionHeadHash,
  BLAZEFACE_GRAPH_ID,
  BlazeFaceDeskModel,
  clearSharedDeskModel,
  createDeskModel,
  DEFAULT_DESK_MODEL_ID,
  deskModelFactory,
  getSharedDeskModel,
  resolveDeskModelId,
  StubDeskModel,
  wearPersonalAttentionHead,
  YourModel,
} from "./model";
export {
  createDeskMonitor,
  DEFAULT_DESK_INTERVAL_MS,
  DeskMonitor,
  type DeskMonitorOptions,
} from "./monitor";
export type { DeskAnalysis, DeskDebug, FaceSignal, FrameSource, RgbFrame } from "./types";
