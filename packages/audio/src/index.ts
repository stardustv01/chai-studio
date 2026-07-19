import type { TimelineOwnership } from "@chai-studio/timeline";

export interface AudioOwnership {
  readonly follows: TimelineOwnership["authority"];
  readonly owns: "program-audio-graph";
}

export const audioPackageBoundary: AudioOwnership = {
  follows: "integer-master-frame",
  owns: "program-audio-graph",
};

export {
  assertValidAudioGraph,
  createDefaultAudioGraph,
  validateAudioGraph,
  type AudioGraphValidationIssue,
} from "./graph.js";
export {
  audioDriftAtFrame,
  ceilDivide,
  driftThresholdSamples,
  floorDivide,
  sampleBoundaryForFrame,
  sampleRangeForFrames,
  type AudioSampleRange,
} from "./sample-mapping.js";
export {
  crossfadeGainAtFrame,
  clipEnvelopeGainAtFrame,
  clipFadeGain,
  decibelsToLinear,
  equalPowerPan,
  evaluateAudioGraphAtFrame,
  evaluateAutomationLane,
  type EvaluatedAudioBus,
  type EvaluatedAudioClip,
} from "./evaluation.js";
export {
  AudioDecodeCache,
  decodeCacheKey,
  normalizeDecodedAudioBlock,
  selectAudioDecodeInputPath,
  type AudioBlockDecoder,
  type AudioDecodePurpose,
  type AudioDecodeRequest,
  type DecodedAudioBlock,
} from "./decode-cache.js";
export {
  executeAudioGraphCommand,
  executeAudioDocumentEdit,
  type AudioGraphCommand,
  type AudioGraphCommandResult,
} from "./commands.js";
export { generateDuckingAutomation, type DuckingAnalysisWindow } from "./ducking.js";
export {
  completeAudioPreprocessingPlan,
  createAudioPreprocessingPlan,
  type AudioPreprocessingPlan,
} from "./preprocessing.js";
export { measurePcmAudio, type AudioMeasurements } from "./measurements.js";
export {
  AuthoritativeAudioPreviewFollower,
  type AudioPreviewBackend,
  type AudioPreviewPlaybackSession,
} from "./preview-follower.js";
export { audioScrubGrainDurationMs, WebAudioGraphBackend, type AudioBufferProvider } from "./web-audio.js";
export { createAudioInspectorDescriptor, type AudioInspectorDescriptor } from "./ui-descriptors.js";
export { AudioMeterHistory, type AudioMeterHistoryPoint } from "./meter-history.js";
export type {
  AudioAutomationKeyframe,
  AudioAutomationLane,
  AudioBusKind,
  AudioChannelLayout,
  AudioChannelMap,
  AudioCrossfade,
  AudioDuckingRule,
  AudioGraphBus,
  AudioGraphClip,
  AudioGraphDocument,
  AudioGraphSource,
  AudioProcessingReference,
  AudioSyncAnchor,
} from "@chai-studio/schema";
