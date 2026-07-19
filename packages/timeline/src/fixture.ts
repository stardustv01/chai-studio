import { normalizeRational } from "@chai-studio/schema/rational";
import { createFrameRange, masterFrame } from "./range.js";
import {
  createEmptyTimelineSnapshot,
  stableEntityId,
  type TimelinePropertyState,
  type TimelineSnapshotV1,
} from "./model.js";
import { assertValidTimelineCore } from "./validation.js";

export const createReferenceTimelineFixture = (): TimelineSnapshotV1 => {
  const videoTrackId = stableEntityId("track-reference-video-0001");
  const audioTrackId = stableEntityId("track-reference-audio-0001");
  const audioBusId = stableEntityId("bus-reference-master-0001");
  const videoClipId = stableEntityId("clip-reference-video-0001");
  const audioClipId = stableEntityId("clip-reference-audio-0001");
  const linkGroupId = stableEntityId("link-reference-av-0001");
  const keyframeId = stableEntityId("keyframe-reference-opacity-0001");
  const laneId = stableEntityId("lane-reference-opacity-0001");
  const noteMarkerId = stableEntityId("marker-reference-start-0001");
  const issueMarkerId = stableEntityId("marker-reference-issue-0001");
  const base = createEmptyTimelineSnapshot({
    id: stableEntityId("timeline-reference-0001"),
    projectId: stableEntityId("project-reference-0001"),
    revisionId: stableEntityId("revision-reference-0001"),
    name: "P05 reference timeline",
    fps: normalizeRational(30n, 1n),
  });
  const sharedClipFields = {
    nestedSequenceId: null,
    engine: "shared" as const,
    range: createFrameRange(masterFrame(0n), masterFrame(150n)),
    sourceRange: createFrameRange(masterFrame(0n), masterFrame(150n)),
    sourceRate: normalizeRational(30n, 1n),
    speed: normalizeRational(1n, 1n),
    availableSourceRange: createFrameRange(masterFrame(0n), masterFrame(300n)),
    linkGroupId,
    selectionGroupId: null,
    transitionInId: null,
    transitionOutId: null,
    metadata: {},
  };
  return assertValidTimelineCore({
    ...base,
    duration: masterFrame(300n),
    trackIds: [videoTrackId, audioTrackId],
    tracks: {
      [videoTrackId]: {
        id: videoTrackId,
        kind: "video",
        name: "V1",
        order: 0,
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        audioBusId: null,
        clipIds: [videoClipId],
      },
      [audioTrackId]: {
        id: audioTrackId,
        kind: "audio",
        name: "A1",
        order: 1,
        locked: false,
        hidden: false,
        muted: false,
        solo: false,
        audioBusId,
        clipIds: [audioClipId],
      },
    },
    audioBusIds: [audioBusId],
    audioBuses: {
      [audioBusId]: {
        id: audioBusId,
        name: "Master",
        order: 0,
        muted: false,
        solo: false,
        gain: 1,
      },
    },
    clips: {
      [videoClipId]: {
        ...sharedClipFields,
        id: videoClipId,
        trackId: videoTrackId,
        assetId: stableEntityId("asset-reference-video-0001"),
        name: "Reference picture",
        keyframeIds: [keyframeId],
      },
      [audioClipId]: {
        ...sharedClipFields,
        id: audioClipId,
        trackId: audioTrackId,
        assetId: stableEntityId("asset-reference-audio-0001"),
        name: "Reference sound",
        keyframeIds: [],
      },
    },
    keyframes: {
      [keyframeId]: {
        id: keyframeId,
        ownerEntityId: videoClipId,
        propertyPath: "opacity",
        frame: masterFrame(30n),
        value: 0.75,
        interpolation: "linear",
        inTangent: null,
        outTangent: null,
        authority: "shared",
        preserveNativeAnimation: false,
      },
    },
    automation: {
      [laneId]: {
        id: laneId,
        ownerEntityId: videoClipId,
        propertyPath: "opacity",
        keyframeIds: [keyframeId],
        authority: "shared",
      },
    },
    markers: {
      [noteMarkerId]: {
        id: noteMarkerId,
        frame: masterFrame(0n),
        duration: masterFrame(0n),
        label: "Program start",
        category: "chapter",
        issueSeverity: null,
        annotationReferenceIds: [],
        ripplePolicy: "anchored-content",
      },
      [issueMarkerId]: {
        id: issueMarkerId,
        frame: masterFrame(150n),
        duration: masterFrame(15n),
        label: "Review handoff",
        category: "issue",
        issueSeverity: "warning",
        annotationReferenceIds: [],
        ripplePolicy: "anchored-time",
      },
    },
  });
};

export const createStudioTimelineFixture = (): TimelineSnapshotV1 => {
  const reference = createReferenceTimelineFixture();
  const v1 = stableEntityId("track-studio-video-v1");
  const v2 = stableEntityId("track-studio-video-v2");
  const v3 = stableEntityId("track-studio-video-v3");
  const cc = stableEntityId("track-studio-caption-cc");
  const mus = stableEntityId("track-studio-audio-mus");
  const bus = stableEntityId("bus-studio-master-0001");
  const opacityKeyframeIds = [
    stableEntityId("keyframe-studio-title-opacity-0001"),
    stableEntityId("keyframe-studio-title-opacity-0002"),
    stableEntityId("keyframe-studio-title-opacity-0003"),
  ] as const;
  const opacityLaneId = stableEntityId("lane-studio-title-opacity-0001");
  const clip = (
    idValue: string,
    trackId: typeof v1,
    name: string,
    start: bigint,
    end: bigint,
    engine: "shared" | "remotion" | "hyperframes",
    metadata: Readonly<Record<string, string>> = {},
  ) => ({
    id: stableEntityId(idValue),
    trackId,
    assetId: stableEntityId(`asset-${idValue}`),
    nestedSequenceId: null,
    engine,
    name,
    range: createFrameRange(masterFrame(start), masterFrame(end)),
    sourceRange: createFrameRange(masterFrame(0n), masterFrame(end - start)),
    sourceRate: normalizeRational(30_000n, 1_001n),
    speed: normalizeRational(1n, 1n),
    availableSourceRange: createFrameRange(masterFrame(0n), masterFrame((end - start) * 2n)),
    linkGroupId: null,
    selectionGroupId: null,
    transitionInId: null,
    transitionOutId: null,
    keyframeIds: idValue === "clip-studio-future-title" ? opacityKeyframeIds : [],
    metadata,
    properties: studioClipProperties(engine),
  });
  const clips = [
    clip("clip-studio-interview-a", v1, "Interview A", 48n, 430n, "shared", {
      media: "video",
      cache: "proxy-ready",
    }),
    clip("clip-studio-product-macro", v1, "Product macro", 430n, 690n, "shared", {
      media: "video",
      cache: "original",
    }),
    clip("clip-studio-data-sequence", v1, "Data sequence", 690n, 1120n, "hyperframes", {
      bridge: "incoming",
      warning: "preview-baked",
    }),
    clip("clip-studio-future-title", v2, "FutureTitle_v04", 430n, 760n, "remotion", {
      keyframes: "3",
      cache: "valid",
      dependencies: "3 assets · 2 fonts · 1 React module",
      sourcePath: "src/remotion/FutureTitle.tsx",
      calculatedMetadata: "1920×1080 · 30000/1001 · 330f",
    }),
    clip("clip-studio-particle-bridge", v3, "Particle bridge", 720n, 990n, "hyperframes", {
      bridge: "engine-boundary",
      cache: "valid",
      dependencies: "1 HTML document · GSAP · Three.js",
      sourcePath: "src/hyperframes/particle-bridge.html",
      calculatedMetadata: "1920×1080 · 30000/1001 · 270f",
    }),
    clip("clip-studio-caption-one", cc, "The way we create…", 90n, 360n, "shared", {
      caption: "true",
    }),
    clip("clip-studio-caption-two", cc, "Every frame matters.", 390n, 650n, "shared", {
      caption: "true",
    }),
    clip("clip-studio-score", mus, "score_master.wav", 24n, 1260n, "shared", {
      waveform: "true",
      audio: "stereo",
    }),
  ];
  return assertValidTimelineCore({
    ...reference,
    id: stableEntityId("timeline-studio-launch-film"),
    projectId: stableEntityId("project-studio-launch-film"),
    revisionId: stableEntityId("revision-studio-000428"),
    name: "Launch Film",
    fps: normalizeRational(30_000n, 1_001n),
    duration: masterFrame(1800n),
    trackIds: [v3, v2, v1, cc, mus],
    tracks: {
      [v3]: track(v3, "video", "V3", 0, clips),
      [v2]: track(v2, "video", "V2", 1, clips),
      [v1]: track(v1, "video", "V1", 2, clips),
      [cc]: track(cc, "caption", "CC", 3, clips),
      [mus]: { ...track(mus, "audio", "MUS", 4, clips), audioBusId: bus },
    },
    audioBusIds: [bus],
    audioBuses: {
      [bus]: { id: bus, name: "Master", order: 0, muted: false, solo: false, gain: 1 },
    },
    clips: Object.fromEntries(clips.map((item) => [item.id, item])),
    keyframes: {
      [opacityKeyframeIds[0]]: keyframe(
        opacityKeyframeIds[0],
        stableEntityId("clip-studio-future-title"),
        430n,
        0,
        "ease-out",
      ),
      [opacityKeyframeIds[1]]: keyframe(
        opacityKeyframeIds[1],
        stableEntityId("clip-studio-future-title"),
        520n,
        100,
        "ease-in-out",
      ),
      [opacityKeyframeIds[2]]: keyframe(
        opacityKeyframeIds[2],
        stableEntityId("clip-studio-future-title"),
        700n,
        72,
        "bezier",
      ),
    },
    markers: {
      [stableEntityId("marker-studio-program-start")]: {
        id: stableEntityId("marker-studio-program-start"),
        frame: masterFrame(0n),
        duration: masterFrame(0n),
        label: "Program start",
        category: "chapter",
        issueSeverity: null,
        annotationReferenceIds: [],
        ripplePolicy: "anchored-content",
      },
      [stableEntityId("marker-studio-review-handoff")]: {
        id: stableEntityId("marker-studio-review-handoff"),
        frame: masterFrame(900n),
        duration: masterFrame(30n),
        label: "Review handoff",
        category: "issue",
        issueSeverity: "warning",
        annotationReferenceIds: [],
        ripplePolicy: "anchored-time",
      },
    },
    automation: {
      [opacityLaneId]: {
        id: opacityLaneId,
        ownerEntityId: stableEntityId("clip-studio-future-title"),
        propertyPath: "transform.opacity",
        keyframeIds: opacityKeyframeIds,
        authority: "shared",
      },
    },
    selection: {
      primaryId: stableEntityId("clip-studio-future-title"),
      selectedIds: [stableEntityId("clip-studio-future-title")],
      anchorId: stableEntityId("clip-studio-future-title"),
    },
  });
};

const studioClipProperties = (
  engine: "shared" | "remotion" | "hyperframes",
): Readonly<Record<string, TimelinePropertyState>> => ({
  "transform.position": property([128, 216], [0, 0], "px", -32_768, 32_768, 0.1),
  "transform.scale": property([100, 100], [100, 100], "percent", 0, 1_000, 0.1),
  "transform.rotation": {
    ...property(0, 0, "degrees", -360_000, 360_000, 0.1),
    ownership: engine === "shared" ? "shared" : "engine-native",
    safeToEdit: engine === "shared",
    nativeAnimation: engine !== "shared",
    supportsSharedConversion: engine !== "shared",
  },
  "transform.anchor": property([50, 50], [50, 50], "percent", -1_000, 1_000, 0.1),
  "transform.opacity": property(100, 100, "percent", 0, 100, 0.1),
  "transform.crop": property([0, 0, 0, 0], [0, 0, 0, 0], "percent", 0, 100, 0.1),
  "composite.blendMode": property("normal", "normal", "enum", null, null, null, false),
  "time.speed": property(1, 1, "ratio", 0.01, 100, 0.01),
  "audio.volume": property(-3, 0, "decibels", -96, 12, 0.1),
  "audio.fadeIn": property(0, 0, "frames", 0, 100_000, 1),
  "audio.fadeOut": property(12, 0, "frames", 0, 100_000, 1),
  ...(engine === "remotion"
    ? {
        "native.remotion.headline": nativeProperty("The future starts at frame zero.", "text"),
        "native.remotion.theme": nativeProperty("Midnight", "enum"),
        "native.remotion.accent": nativeProperty("#8B94FF", "color"),
      }
    : {}),
  ...(engine === "hyperframes"
    ? {
        "native.hyperframes.particleScale": nativeProperty(1.2, "ratio", 0, 8, 0.1),
        "native.hyperframes.accent": nativeProperty("#61DBE7", "color"),
      }
    : {}),
});

const property = (
  value: TimelinePropertyState["value"],
  defaultValue: TimelinePropertyState["defaultValue"],
  unit: TimelinePropertyState["unit"],
  minimum: number | null,
  maximum: number | null,
  step: number | null,
  keyframeable = true,
): TimelinePropertyState => ({
  value,
  defaultValue,
  unit,
  minimum,
  maximum,
  step,
  ownership: "shared",
  keyframeable,
  capability: "unified",
  safeToEdit: true,
  nativeAnimation: false,
  supportsSharedConversion: false,
});

const nativeProperty = (
  value: TimelinePropertyState["value"],
  unit: TimelinePropertyState["unit"],
  minimum: number | null = null,
  maximum: number | null = null,
  step: number | null = null,
): TimelinePropertyState => ({
  ...property(value, value, unit, minimum, maximum, step, false),
  ownership: "engine-native",
  capability: "native",
  safeToEdit: true,
});

const keyframe = (
  id: ReturnType<typeof stableEntityId>,
  ownerEntityId: ReturnType<typeof stableEntityId>,
  frame: bigint,
  value: number,
  interpolation: "ease-out" | "ease-in-out" | "bezier",
) => ({
  id,
  ownerEntityId,
  propertyPath: "transform.opacity",
  frame: masterFrame(frame),
  value,
  interpolation,
  inTangent: interpolation === "bezier" ? ([0.58, 1] as const) : null,
  outTangent: interpolation === "bezier" ? ([0.42, 0] as const) : null,
  authority: "shared" as const,
  preserveNativeAnimation: false,
});

const track = (
  id: ReturnType<typeof stableEntityId>,
  kind: "video" | "audio" | "caption" | "data",
  name: string,
  order: number,
  clips: readonly {
    readonly id: ReturnType<typeof stableEntityId>;
    readonly trackId: ReturnType<typeof stableEntityId>;
  }[],
) => ({
  id,
  kind,
  name,
  order,
  locked: false,
  hidden: false,
  muted: false,
  solo: false,
  audioBusId: null,
  clipIds: clips.filter((clip) => clip.trackId === id).map((clip) => clip.id),
});
