import { createDefaultAudioGraph, type AudioGraphDocument } from "@chai-studio/audio";
import { defaultCaptionStyle, importTimedText } from "@chai-studio/captions";
import type { AssetRecord, CaptionDocument, TranscriptDocument } from "@chai-studio/schema";
import { serializeBigInt } from "@chai-studio/schema/rational";
import { createStudioTimelineFixture, type TimelineSnapshotV1 } from "@chai-studio/timeline/browser";

export const workspaceIds = ["edit", "inspect", "media", "animation", "deliver"] as const;
export type WorkspaceId = (typeof workspaceIds)[number];

export const shellStateIds = [
  "ready",
  "empty",
  "loading",
  "offline",
  "reconnecting",
  "migrating",
  "recovering",
  "read-only",
  "conflict",
] as const;
export type ShellStateId = (typeof shellStateIds)[number];

export interface ProjectIdentity {
  readonly projectId: string;
  readonly title: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly saved: boolean;
  readonly readOnly: boolean;
}

export const shortRevisionId = (revisionId: string): string =>
  revisionId.replace(/^revision-/u, "").slice(0, 8);

export const projectRevisionLabel = (project: ProjectIdentity): string =>
  `Revision ${String(project.revisionNumber)} · ${shortRevisionId(project.revisionId)}`;

export interface PreviewTruth {
  readonly masterFrame: string;
  readonly durationFrames: string;
  readonly timecode: string;
  readonly timelineFps: Readonly<{ numerator: string; denominator: string }>;
  readonly playRate: Readonly<{ numerator: string; denominator: string }>;
  readonly stateVersion: number;
  readonly quality: "draft" | "balanced" | "full";
  readonly fidelityEquivalent: boolean;
  readonly loopRange: PreviewRangeView | null;
  readonly inOutRange: PreviewRangeView | null;
  readonly bufferingStatus: "idle" | "ready" | "waiting" | "back-pressure" | "error";
  readonly mode: "interactive" | "rendered-fidelity";
  readonly source: "proxy" | "original";
  readonly engineState: "native" | "mixed" | "baked-fallback";
  readonly playback: "stopped" | "loading" | "paused" | "playing" | "seeking" | "buffering" | "error";
  readonly droppedFrames: number;
  readonly warnings: readonly PreviewWarningView[];
}

export interface PreviewRangeView {
  readonly startFrame: string;
  readonly endFrameExclusive: string;
}

export interface PreviewWarningView {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly layerId: string | null;
  readonly remedy: Readonly<{ label: string; action: string }>;
}

export interface RenderTruth {
  readonly status: "idle" | "queued" | "rendering" | "qa" | "failed" | "complete";
  readonly progress: number;
  readonly stage: string;
  readonly qa: "not-run" | "pending" | "passed" | "warning" | "failed";
  readonly approval: "not-requested" | "pending" | "approved" | "rejected";
}

export interface StudioSnapshot {
  readonly project: ProjectIdentity | null;
  readonly preview: PreviewTruth;
  readonly render: RenderTruth;
  readonly selection: {
    readonly clipIds: readonly string[];
    readonly assetIds: readonly string[];
  };
  readonly assets: readonly AssetRecord[];
  readonly timeline: TimelineSnapshotV1;
  readonly audioGraph: AudioGraphDocument;
  readonly transcripts: readonly TranscriptDocument[];
  readonly captionDocuments: readonly CaptionDocument[];
  readonly serverSequence: number;
}

export interface StudioDiagnostic {
  readonly category: string;
  readonly code: string;
  readonly stage: string;
  readonly entityId: string | null;
  readonly retryable: boolean;
  readonly message: string;
  readonly repairHint: string | null;
  readonly correlationId: string;
  readonly detail: Readonly<Record<string, unknown>> | null;
}

export interface StudioEvent {
  readonly id: number;
  readonly type: string;
  readonly correlationId: string | null;
  readonly occurredAt: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export type ConnectionPhase = "connecting" | "online" | "reconnecting" | "offline";

export interface ConnectionState {
  readonly phase: ConnectionPhase;
  readonly detail: string;
  readonly attempts: number;
  readonly lastEventId: number | null;
  readonly eventLagMs: number;
}

export interface ToastMessage {
  readonly id: string;
  readonly tone: "info" | "ready" | "attention" | "danger";
  readonly title: string;
  readonly detail: string;
  readonly correlationId: string | null;
}

export const defaultStudioSnapshot: StudioSnapshot = /* @__PURE__ */ createDefaultStudioSnapshot();

function createDefaultStudioSnapshot(): StudioSnapshot {
  return {
    project: {
      projectId: "launch-film",
      title: "Launch Film",
      revisionId: "revision-000428",
      revisionNumber: 428,
      saved: true,
      readOnly: false,
    },
    preview: {
      masterFrame: "444",
      durationFrames: "17982",
      timecode: "00:00:14;24",
      timelineFps: { numerator: "30000", denominator: "1001" },
      playRate: { numerator: "1", denominator: "1" },
      stateVersion: 1,
      quality: "balanced",
      fidelityEquivalent: false,
      loopRange: null,
      inOutRange: null,
      bufferingStatus: "ready",
      mode: "interactive",
      source: "proxy",
      engineState: "mixed",
      playback: "paused",
      droppedFrames: 2,
      warnings: [
        {
          code: "proxy-in-use",
          severity: "warning",
          message: "Interactive preview uses proxy media and is not final-render truth.",
          layerId: null,
          remedy: { label: "Switch to rendered fidelity", action: "preview.request-fidelity" },
        },
      ],
    },
    render: {
      status: "idle",
      progress: 0,
      stage: "Ready",
      qa: "not-run",
      approval: "not-requested",
    },
    selection: { clipIds: ["clip-studio-future-title"], assetIds: [] },
    assets: [],
    timeline: createStudioTimelineFixture(),
    audioGraph: createStudioAudioGraphFixture(),
    ...createStudioLanguageFixture(),
    serverSequence: 0,
  };
}

function createStudioLanguageFixture(): Pick<StudioSnapshot, "transcripts" | "captionDocuments"> {
  const imported = importTimedText({
    format: "srt",
    text: `1
00:00:13,800 --> 00:00:15,600
Pixels cross the boundary without losing time.

2
00:00:15,700 --> 00:00:18,100
One scheduler keeps every engine aligned.

3
00:00:18,300 --> 00:00:20,500
Preview and final captions share exact cues.

4
00:00:20,700 --> 00:00:23,200
Corrections remain linked to the source audio.
`,
    transcriptId: "transcript-launch-film-0001",
    captionDocumentId: "caption-document-launch-film-0001",
    captionTrackId: "track-studio-captions",
    sourceAudio: {
      assetId: "asset-voiceover-0001",
      streamIndex: 0,
      contentHash: "a".repeat(64),
      sampleRate: 48_000,
    },
    fps: { numerator: serializeBigInt(30_000n), denominator: serializeBigInt(1_001n) },
    language: "en-US",
    style: { ...defaultCaptionStyle(), maxCharactersPerSecond: 28 },
  });
  if (imported.transcript === null || imported.captions === null) {
    throw new Error("Studio transcript fixture failed validation.");
  }
  const speakerId = "speaker-chai-narrator-0001";
  return {
    transcripts: [
      {
        ...imported.transcript,
        speakers: [{ id: speakerId, name: "Chai narrator", color: "#8D87FF" }],
        words: imported.transcript.words.map((word, index) => ({
          ...word,
          confidence: 0.96 + (index % 4) * 0.01,
        })),
        phrases: imported.transcript.phrases.map((phrase, index) => ({
          ...phrase,
          speakerId,
          confidence: 0.96 + index * 0.01,
        })),
      },
    ],
    captionDocuments: [
      {
        ...imported.captions,
        cues: imported.captions.cues.map((cue) => ({ ...cue, speakerId })),
      },
    ],
  };
}

function createStudioAudioGraphFixture(): AudioGraphDocument {
  const graph = createDefaultAudioGraph({
    graphId: "audio-launch-film-0001",
    sampleRate: 48_000,
    channelLayout: "stereo",
  });
  return {
    ...graph,
    sources: [
      {
        id: "audio-source-voiceover-0001",
        assetId: "asset-voiceover-0001",
        streamIndex: 0,
        contentHash: "a".repeat(64),
        originalPath: "media/audio/voiceover_take03.wav",
        proxyPath: null,
        sourceSampleRate: 48_000,
        sourceChannels: 1,
        previewPolicy: "original-only",
      },
      {
        id: "audio-source-music-0001",
        assetId: "asset-music-0001",
        streamIndex: 0,
        contentHash: "b".repeat(64),
        originalPath: "media/audio/score_master.wav",
        proxyPath: "derived/audio/score_master-preview.wav",
        sourceSampleRate: 48_000,
        sourceChannels: 2,
        previewPolicy: "proxy-preferred",
      },
    ],
    channelMaps: [
      { id: "channel-map-mono-stereo-0001", inputChannels: 1, outputChannels: 2, matrix: [[1], [1]] },
      {
        id: "channel-map-stereo-0001",
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
        id: "audio-clip-voiceover-0001",
        timelineClipId: "clip-studio-interview-a",
        sourceId: "audio-source-voiceover-0001",
        busId: `${graph.graphId}:voiceover`,
        startFrame: bigintString("0"),
        endFrameExclusive: bigintString("820"),
        sourceStartSample: bigintString("0"),
        sourceEndSampleExclusive: bigintString("1313312"),
        gainDb: -1.5,
        pan: 0,
        muted: false,
        fadeInFrames: bigintString("8"),
        fadeOutFrames: bigintString("12"),
        fadeCurve: "equal-power",
        automationLaneIds: ["audio-lane-voiceover-gain-0001"],
        channelMapId: "channel-map-mono-stereo-0001",
        syncAnchorIds: ["audio-sync-voiceover-0001"],
        processingReferenceIds: [],
      },
      {
        id: "audio-clip-music-0001",
        timelineClipId: "clip-studio-score",
        sourceId: "audio-source-music-0001",
        busId: `${graph.graphId}:music`,
        startFrame: bigintString("24"),
        endFrameExclusive: bigintString("1260"),
        sourceStartSample: bigintString("0"),
        sourceEndSampleExclusive: bigintString("1979578"),
        gainDb: -12,
        pan: 0,
        muted: false,
        fadeInFrames: bigintString("48"),
        fadeOutFrames: bigintString("96"),
        fadeCurve: "equal-power",
        automationLaneIds: [],
        channelMapId: "channel-map-stereo-0001",
        syncAnchorIds: [],
        processingReferenceIds: [],
      },
    ],
    automationLanes: [
      {
        id: "audio-lane-voiceover-gain-0001",
        targetKind: "clip",
        targetId: "audio-clip-voiceover-0001",
        property: "gainDb",
        keyframes: [
          {
            id: "audio-key-voiceover-0001",
            frame: bigintString("0"),
            value: -6,
            interpolation: "ease-in-out",
          },
          {
            id: "audio-key-voiceover-0002",
            frame: bigintString("18"),
            value: -1.5,
            interpolation: "linear",
          },
        ],
      },
    ],
    crossfades: [
      {
        id: "audio-crossfade-voiceover-music-0001",
        fromClipId: "audio-clip-voiceover-0001",
        toClipId: "audio-clip-music-0001",
        startFrame: bigintString("24"),
        endFrameExclusive: bigintString("48"),
        curve: "equal-power",
      },
    ],
    duckingRules: [
      {
        id: "audio-duck-music-under-vo-0001",
        triggerBusId: `${graph.graphId}:voiceover`,
        targetBusId: `${graph.graphId}:music`,
        thresholdDb: -30,
        reductionDb: -8,
        attackFrames: bigintString("6"),
        releaseFrames: bigintString("18"),
        generatedAutomationLaneId: null,
      },
    ],
    syncAnchors: [
      {
        id: "audio-sync-voiceover-0001",
        label: "VO phrase: frame zero",
        frame: bigintString("444"),
        sourceSample: bigintString("711110"),
        toleranceSamples: bigintString("1"),
      },
    ],
  };
}

function bigintString(value: string) {
  return serializeBigInt(BigInt(value));
}
