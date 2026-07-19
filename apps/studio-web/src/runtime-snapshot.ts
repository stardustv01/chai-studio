import { createDefaultAudioGraph } from "@chai-studio/audio";
import { normalizeRational } from "@chai-studio/schema/rational";
import { createEmptyTimelineSnapshot, stableEntityId } from "@chai-studio/timeline/browser";
import type { StudioSnapshot } from "./types.js";

const fps = normalizeRational(30_000n, 1_001n);
const timelineId = stableEntityId("timeline-unopened-local-0001");

export const initialStudioSnapshot: StudioSnapshot = {
  project: null,
  preview: {
    masterFrame: "0",
    durationFrames: "0",
    timecode: "00:00:00;00",
    timelineFps: fps,
    playRate: normalizeRational(1n, 1n),
    stateVersion: 1,
    quality: "balanced",
    fidelityEquivalent: false,
    loopRange: null,
    inOutRange: null,
    bufferingStatus: "idle",
    mode: "interactive",
    source: "original",
    engineState: "native",
    playback: "stopped",
    droppedFrames: 0,
    warnings: [],
  },
  render: {
    status: "idle",
    progress: 0,
    stage: "No project open",
    qa: "not-run",
    approval: "not-requested",
  },
  selection: { clipIds: [], assetIds: [] },
  assets: [],
  timeline: createEmptyTimelineSnapshot({
    id: timelineId,
    projectId: stableEntityId("project-unopened-local-0001"),
    revisionId: stableEntityId("revision-unopened-local-0001"),
    name: "No project open",
    fps,
  }),
  audioGraph: createDefaultAudioGraph({
    graphId: "audio-unopened-local-0001",
    sampleRate: 48_000,
    channelLayout: "stereo",
  }),
  transcripts: [],
  captionDocuments: [],
  serverSequence: 0,
};
