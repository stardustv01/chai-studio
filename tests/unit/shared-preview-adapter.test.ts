import { describe, expect, it } from "vitest";
import { initialCapabilityRegistry } from "../../packages/engine-adapters/src/index.js";
import {
  activeSharedCaptionCues,
  activeSharedCaptionWords,
  createPreviewFrameRange,
  createSharedCaptionPlan,
  createSharedEffectsMetadata,
  createSharedFallbackProvenance,
  defaultPreviewTransform,
  emptyPreviewCrop,
  resolveSharedSourceAudioPolicy,
  runPreviewAdapterConformance,
  sampleSharedVideoSource,
  SharedPreviewAdapter,
  type SharedEffectsMetadata,
  type SharedFallbackClip,
  type SharedSolidClip,
  type SharedVideoClip,
} from "../../packages/preview/src/index.js";

describe("P12 shared preview adapter", () => {
  it("samples original and proxy video frames with exact rational arithmetic", () => {
    const clip = videoClip();
    expect(sampleSharedVideoSource(clip, "100")).toMatchObject({
      exactSourceFrame: { numerator: "2252", denominator: "25" },
      originalSourceFrame: "90",
      selectedAssetId: "asset-original-0001",
      selectedSourceFrame: "90",
      usedProxy: false,
    });
    expect(sampleSharedVideoSource(clip, "100", true)).toMatchObject({
      originalSourceFrame: "90",
      selectedAssetId: "asset-proxy-0001",
      selectedSourceFrame: "46",
      usedProxy: true,
    });
  });

  it("uses half-open caption and word boundaries with stable start-frame ordering", () => {
    const plan = createSharedCaptionPlan({
      planId: "caption-plan-0001",
      layerId: "layer-caption-0001",
      timelineRange: createPreviewFrameRange("0", "30"),
      width: 1920,
      height: 1080,
      fps: { numerator: "30000", denominator: "1001" },
      cues: [
        cue("cue-z-0001", "10", "20", "Second"),
        cue("cue-b-0001", "0", "10", "First B"),
        cue("cue-a-0001", "0", "10", "First A"),
      ],
    });
    expect(plan.cues.map((cue) => cue.cueId)).toEqual(["cue-a-0001", "cue-b-0001", "cue-z-0001"]);
    expect(activeSharedCaptionCues(plan, "9").map((cue) => cue.cueId)).toEqual(["cue-a-0001", "cue-b-0001"]);
    expect(activeSharedCaptionCues(plan, "10").map((cue) => cue.cueId)).toEqual(["cue-z-0001"]);
    expect(activeSharedCaptionCues(plan, "20")).toEqual([]);
    const first = plan.cues[0];
    if (first === undefined) throw new Error("Caption cue fixture is empty.");
    expect(activeSharedCaptionWords(first, "0").map((word) => word.wordId)).toEqual(["word-cue-a-0001"]);
    expect(activeSharedCaptionWords(first, "10")).toEqual([]);
  });

  it("freezes common effects, labels fallback provenance, and isolates all source audio", () => {
    const effects = createSharedEffectsMetadata({
      ...baseEffects(),
      adjustmentRefs: ["adjustment-b", "adjustment-a", "adjustment-b"],
    });
    expect(effects.adjustmentRefs).toEqual(["adjustment-a", "adjustment-b"]);
    const provenance = createSharedFallbackProvenance({
      sourceIdentity: "hyperframes:composition-0001",
      sourceContentHash: "source-hash-0001",
      cacheKey: "cache-key-0001",
      environmentClass: "macos-arm64-strict",
      producerVersion: "1.0.0",
      createdBy: "bake",
      fidelity: "approximation",
      approximationLimits: ["Live controls are unavailable."],
    });
    expect(provenance.provenanceId).toMatch(/^[a-f0-9]{64}$/);
    expect(resolveSharedSourceAudioPolicy("program", true)).toMatchObject({
      sourceAudio: "suppressed",
      nativeEngineAudioSuppressed: true,
      connectedToMasterProgramGraph: false,
    });
    expect(resolveSharedSourceAudioPolicy("source-inspection", false).sourceAudio).toBe("suppressed");
    expect(resolveSharedSourceAudioPolicy("source-inspection", true)).toMatchObject({
      sourceAudio: "isolated-audition",
      connectedToMasterProgramGraph: false,
    });
  });

  it("passes the common adapter conformance harness and repeats exact frame identity", async () => {
    const result = await runPreviewAdapterConformance(
      () =>
        new SharedPreviewAdapter({
          adapterId: "adapter-shared-solid-0001",
          clip: solidClip(),
        }),
    );
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
    expect(result.checks).toEqual({
      "preload-half-open-range": true,
      "exact-frame-presentation": true,
      "repeat-seek-determinism": true,
      "scheduler-owned-playback": true,
      "halt-and-suspend": true,
      disposal: true,
    });
  });

  it("reports proxy use without allowing source audio into the program graph", async () => {
    const adapter = new SharedPreviewAdapter({
      adapterId: "adapter-shared-video-0001",
      clip: videoClip(),
      preferProxy: true,
    });
    const presentation = await adapter.presentFrame({
      schedulerSessionId: "session-shared-0001",
      frame: "100",
      presentationTimestamp: { numerator: "1001", denominator: "300" },
      truthMode: "interactive-approximation",
      signal: new AbortController().signal,
    });
    expect(presentation.usedProxy).toBe(true);
    expect(presentation.usedBakedFallback).toBe(false);
    expect(presentation.warnings.map((warning) => warning.code)).toEqual(["proxy-in-use"]);
  });

  it("makes alpha, effects, registry warnings, and fallback provenance observable", async () => {
    const controller = new AbortController();
    const request = {
      schedulerSessionId: "session-shared-policy-0001",
      frame: "3",
      presentationTimestamp: { numerator: "1001", denominator: "10000" },
      truthMode: "interactive-approximation" as const,
      signal: controller.signal,
    };
    const policyClip: SharedSolidClip = {
      ...solidClip(),
      effects: {
        ...baseEffects(),
        capabilities: [
          {
            engine: "render-core",
            capabilityId: "render-core.distributed-rendering",
          },
        ],
      },
    };
    const policyPresentation = await new SharedPreviewAdapter({
      adapterId: "adapter-shared-policy-0001",
      clip: policyClip,
      capabilityRegistry: initialCapabilityRegistry,
    }).presentFrame(request);
    expect(policyPresentation.warnings.map((warning) => warning.code)).toEqual(["unsupported-effect"]);

    const opaqueIdentity = (
      await new SharedPreviewAdapter({
        adapterId: "adapter-shared-alpha-0001",
        clip: { ...solidClip(), alphaMode: "opaque" },
      }).presentFrame(request)
    ).artifactIdentity;
    const straightIdentity = (
      await new SharedPreviewAdapter({
        adapterId: "adapter-shared-alpha-0001",
        clip: { ...solidClip(), alphaMode: "straight" },
      }).presentFrame(request)
    ).artifactIdentity;
    expect(opaqueIdentity).not.toBe(straightIdentity);

    const provenance = createSharedFallbackProvenance({
      sourceIdentity: "hyperframes:composition-0002",
      sourceContentHash: "source-hash-0002",
      cacheKey: "cache-key-0002",
      environmentClass: "macos-arm64-strict",
      producerVersion: "1.0.0",
      createdBy: "bake",
      fidelity: "approximation",
      approximationLimits: ["Particle controls are flattened."],
    });
    const fallback: SharedFallbackClip = {
      kind: "fallback",
      clipId: "clip-fallback-0001",
      layerId: "layer-fallback-0001",
      timelineRange: createPreviewFrameRange("0", "10"),
      alphaMode: "straight",
      effects: baseEffects(),
      assetId: "asset-fallback-0001",
      contentHash: "fallback-hash-0001",
      provenance,
    };
    const fallbackPresentation = await new SharedPreviewAdapter({
      adapterId: "adapter-fallback-0001",
      clip: fallback,
    }).presentFrame(request);
    expect(fallbackPresentation).toMatchObject({
      usedBakedFallback: true,
      usedProxy: false,
    });
    expect(fallbackPresentation.warnings[0]).toMatchObject({
      code: "baked-fallback",
      severity: "warning",
    });
  });
});

const baseEffects = (): SharedEffectsMetadata => ({
  transform: defaultPreviewTransform,
  opacity: 1,
  crop: emptyPreviewCrop,
  blendMode: "normal",
  adjustmentRefs: [],
  capabilities: [],
});

const solidClip = (): SharedSolidClip => ({
  kind: "solid",
  clipId: "clip-shared-solid-0001",
  layerId: "layer-shared-solid-0001",
  timelineRange: createPreviewFrameRange("0", "10"),
  alphaMode: "straight",
  effects: baseEffects(),
  color: { red: 0.1, green: 0.2, blue: 0.3, alpha: 0.5 },
});

const videoClip = (): SharedVideoClip => ({
  kind: "video",
  clipId: "clip-shared-video-0001",
  layerId: "layer-shared-video-0001",
  timelineRange: createPreviewFrameRange("0", "300"),
  alphaMode: "straight",
  effects: baseEffects(),
  assetId: "asset-original-0001",
  contentHash: "original-hash-0001",
  sourceStartFrame: "10",
  timelineFps: { numerator: "30000", denominator: "1001" },
  sourceFps: { numerator: "24", denominator: "1" },
  speed: { numerator: "1", denominator: "1" },
  proxy: {
    assetId: "asset-proxy-0001",
    contentHash: "proxy-hash-0001",
    sourceToProxyScale: { numerator: "1", denominator: "2" },
    sourceToProxyOffset: { numerator: "1", denominator: "1" },
  },
});

const cue = (cueId: string, startFrame: string, endFrameExclusive: string, text: string) => ({
  cueId,
  range: createPreviewFrameRange(startFrame, endFrameExclusive),
  text,
  lines: [text],
  speaker: null,
  styleId: "caption-style-0001",
  fontFileHash: "font-hash-0001",
  glyphHash: `glyph-hash-${cueId}`,
  words: [
    {
      wordId: `word-${cueId}`,
      text,
      range: createPreviewFrameRange(startFrame, endFrameExclusive),
    },
  ],
});
