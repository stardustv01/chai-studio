import { describe, expect, it } from "vitest";
import {
  aggregatePreviewBuffering,
  calculatePreviewViewportFit,
  compareNormalizedPreviewPixels,
  createPreviewIntegrityWarnings,
  createPreviewFrameRange,
  createPreviewLayerGraph,
  defaultPreviewTransform,
  deterministicPreviewPixelHash,
  emptyPreviewCrop,
  normalizePreviewPixelBuffer,
  resolvePreviewQualityPolicy,
  resolvePreviewAudioPolicy,
  strictPreviewPixelContract,
} from "../../packages/preview/src/index.js";

describe("P09 compositor, quality, buffering, and color contracts", () => {
  it("orders layers deterministically and computes fit bars", () => {
    const graph = createPreviewLayerGraph([
      layer("layer-guide-0001", "adapter-guide-0001", "guide", 20, 2),
      layer("layer-remotion-0001", "adapter-remotion-0001", "remotion", 10, 1),
      layer("layer-shared-0001", "adapter-shared-0001", "shared", 10, 0),
    ]);
    expect(graph.map((node) => node.id)).toEqual([
      "layer-shared-0001",
      "layer-remotion-0001",
      "layer-guide-0001",
    ]);
    expect(
      calculatePreviewViewportFit({
        sourceWidth: 1920,
        sourceHeight: 1080,
        viewportWidth: 1000,
        viewportHeight: 1000,
        mode: "fit",
      }).bars,
    ).toBe("letterbox");
  });

  it("never relabels interactive degradation as fidelity", () => {
    const interactive = resolvePreviewQualityPolicy({
      quality: "full",
      truthMode: "interactive-approximation",
      loadClass: "critical",
      hasBakedFallback: true,
      unsupportedEffects: true,
    });
    expect(interactive).toMatchObject({
      quality: "full",
      resolutionScale: 0.25,
      mediaSource: "proxy",
      fidelityEquivalent: false,
    });
    expect(interactive.warnings.map((item) => item.code)).toEqual([
      "proxy-in-use",
      "render-required-difference",
      "baked-fallback",
      "unsupported-effect",
    ]);
    expect(resolvePreviewQualityPolicy({ quality: "draft", truthMode: "rendered-fidelity" })).toMatchObject({
      quality: "full",
      resolutionScale: 1,
      mediaSource: "original",
      fidelityEquivalent: true,
      warnings: [],
    });
  });

  it("catalogs direct remedies and enforces shared-audio ownership", () => {
    const warnings = createPreviewIntegrityWarnings({
      missingAssetIds: ["asset-missing-0001"],
      missingFontIds: ["font-missing-0001"],
      staleCacheAdapterIds: ["adapter-stale-0001"],
      bufferingFor: ["audio"],
      droppedFrames: 3,
      renderRequiredDifference: true,
    });
    expect(warnings.map((item) => item.code)).toEqual([
      "missing-asset",
      "missing-font",
      "stale-cache",
      "buffering",
      "dropped-frames",
      "render-required-difference",
    ]);
    expect(warnings.every((item) => item.remedy.label.length > 0 && item.remedy.action.length > 0)).toBe(
      true,
    );
    expect(resolvePreviewAudioPolicy({ numerator: "1", denominator: "1" }, "playback")).toMatchObject({
      programAudio: "audible",
      nativeEngineAudioSuppressed: true,
    });
    expect(resolvePreviewAudioPolicy({ numerator: "2", denominator: "1" }, "playback")).toMatchObject({
      programAudio: "muted",
      nativeEngineAudioSuppressed: true,
    });
    expect(resolvePreviewAudioPolicy({ numerator: "1", denominator: "1" }, "scrub")).toMatchObject({
      programAudio: "bounded-grain",
      deterministicStretch: "none",
      nativeEngineAudioSuppressed: true,
    });
    expect(resolvePreviewAudioPolicy({ numerator: "1", denominator: "1" }, "frame-step")).toMatchObject({
      programAudio: "silent-scrub",
    });
  });

  it("aggregates buffering reasons, cache freshness, and back-pressure", () => {
    const requestedRange = createPreviewFrameRange("10", "50");
    const buffering = aggregatePreviewBuffering({
      requestedRange,
      inFlightRequests: 4,
      maximumInFlightRequests: 4,
      results: [
        {
          adapterId: "adapter-remotion-0001",
          layerId: "layer-remotion-0001",
          range: createPreviewFrameRange("0", "60"),
          freshness: "fresh",
          waitingFor: "engine",
        },
        {
          adapterId: "adapter-hyperframes-0001",
          layerId: "layer-hyperframes-0001",
          range: createPreviewFrameRange("5", "55"),
          freshness: "stale",
          waitingFor: "media",
        },
      ],
    });
    expect(buffering).toMatchObject({
      status: "back-pressure",
      bufferedRange: { startFrame: "5", endFrameExclusive: "55" },
      waitingFor: ["engine", "media"],
      staleAdapterIds: ["adapter-hyperframes-0001"],
    });
  });

  it("normalizes premultiplied alpha before exact comparison and hashing", () => {
    const normalized = normalizePreviewPixelBuffer({
      width: 1,
      height: 1,
      pixels: Uint8Array.from([64, 32, 0, 128]),
      contract: { ...strictPreviewPixelContract, alphaMode: "premultiplied" },
    });
    const expected = normalizePreviewPixelBuffer({
      width: 1,
      height: 1,
      pixels: Uint8Array.from([128, 64, 0, 128]),
      contract: strictPreviewPixelContract,
    });
    expect([...normalized.pixels]).toEqual([128, 64, 0, 128]);
    expect(compareNormalizedPreviewPixels(normalized, expected)).toEqual({
      equal: true,
      differingBytes: 0,
      maximumChannelDelta: 0,
    });
    expect(deterministicPreviewPixelHash(normalized)).toBe(deterministicPreviewPixelHash(expected));
  });
});

const layer = (
  id: string,
  adapterId: string,
  kind: "remotion" | "shared" | "guide",
  zIndex: number,
  sourceOrder: number,
) => ({
  id,
  adapterId,
  kind,
  timelineRange: createPreviewFrameRange("0", "100"),
  zIndex,
  sourceOrder,
  opacity: 1,
  blendMode: "normal" as const,
  transform: defaultPreviewTransform,
  crop: emptyPreviewCrop,
  visible: true,
});
