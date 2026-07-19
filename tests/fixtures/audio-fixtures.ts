import { createDefaultAudioGraph, type AudioGraphDocument } from "../../packages/audio/src/index.js";
import { normalizeRational, serializeBigInt } from "../../packages/schema/src/index.js";

export const audioTestFps = normalizeRational(30_000n, 1_001n);

export const createAudioGraphFixture = (): AudioGraphDocument => {
  const graph = createDefaultAudioGraph({
    graphId: "audio-graph-test-0001",
    sampleRate: 48_000,
    channelLayout: "stereo",
  });
  return {
    ...graph,
    sources: [
      {
        id: "audio-source-test-0001",
        assetId: "asset-audio-test-0001",
        streamIndex: 0,
        contentHash: "c".repeat(64),
        originalPath: "media/audio/test.wav",
        proxyPath: null,
        sourceSampleRate: 48_000,
        sourceChannels: 2,
        previewPolicy: "original-only",
      },
      {
        id: "audio-source-test-0002",
        assetId: "asset-audio-test-0002",
        streamIndex: 0,
        contentHash: "d".repeat(64),
        originalPath: "media/audio/music.wav",
        proxyPath: "derived/audio/music-preview.wav",
        sourceSampleRate: 48_000,
        sourceChannels: 2,
        previewPolicy: "proxy-preferred",
      },
    ],
    channelMaps: [
      {
        id: "channel-map-test-0001",
        inputChannels: 2,
        outputChannels: 2,
        matrix: [
          [1, 0],
          [0, 1],
        ],
      },
    ],
    clips: [
      {
        id: "audio-clip-test-0001",
        timelineClipId: "clip-timeline-test-0001",
        sourceId: "audio-source-test-0001",
        busId: `${graph.graphId}:voiceover`,
        startFrame: serializeBigInt(0n),
        endFrameExclusive: serializeBigInt(300n),
        sourceStartSample: serializeBigInt(0n),
        sourceEndSampleExclusive: serializeBigInt(480_480n),
        gainDb: 0,
        pan: 0,
        muted: false,
        fadeInFrames: serializeBigInt(10n),
        fadeOutFrames: serializeBigInt(10n),
        fadeCurve: "equal-power",
        automationLaneIds: ["audio-lane-test-0001"],
        channelMapId: "channel-map-test-0001",
        syncAnchorIds: ["audio-sync-test-0001"],
        processingReferenceIds: [],
      },
      {
        id: "audio-clip-test-0002",
        timelineClipId: "clip-timeline-test-0002",
        sourceId: "audio-source-test-0002",
        busId: `${graph.graphId}:music`,
        startFrame: serializeBigInt(120n),
        endFrameExclusive: serializeBigInt(360n),
        sourceStartSample: serializeBigInt(0n),
        sourceEndSampleExclusive: serializeBigInt(384_384n),
        gainDb: -6,
        pan: 0.25,
        muted: false,
        fadeInFrames: serializeBigInt(0n),
        fadeOutFrames: serializeBigInt(0n),
        fadeCurve: "linear",
        automationLaneIds: [],
        channelMapId: "channel-map-test-0001",
        syncAnchorIds: [],
        processingReferenceIds: [],
      },
    ],
    automationLanes: [
      {
        id: "audio-lane-test-0001",
        targetKind: "clip",
        targetId: "audio-clip-test-0001",
        property: "gainDb",
        keyframes: [
          {
            id: "audio-key-test-0001",
            frame: serializeBigInt(0n),
            value: -12,
            interpolation: "linear",
          },
          {
            id: "audio-key-test-0002",
            frame: serializeBigInt(60n),
            value: 0,
            interpolation: "linear",
          },
        ],
      },
    ],
    crossfades: [
      {
        id: "audio-crossfade-test-0001",
        fromClipId: "audio-clip-test-0001",
        toClipId: "audio-clip-test-0002",
        startFrame: serializeBigInt(120n),
        endFrameExclusive: serializeBigInt(150n),
        curve: "equal-power",
      },
    ],
    duckingRules: [
      {
        id: "audio-duck-test-0001",
        triggerBusId: `${graph.graphId}:voiceover`,
        targetBusId: `${graph.graphId}:music`,
        thresholdDb: -30,
        reductionDb: -8,
        attackFrames: serializeBigInt(6n),
        releaseFrames: serializeBigInt(18n),
        generatedAutomationLaneId: null,
      },
    ],
    syncAnchors: [
      {
        id: "audio-sync-test-0001",
        label: "Phrase start",
        frame: serializeBigInt(120n),
        sourceSample: serializeBigInt(192_192n),
        toleranceSamples: serializeBigInt(1n),
      },
    ],
  };
};
