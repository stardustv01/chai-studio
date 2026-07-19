import { describe, expect, it } from "vitest";
import {
  createPreviewFrameRange,
  defaultPreviewTransform,
  emptyPreviewCrop,
  PreviewScheduler,
} from "../../packages/preview/src/index.js";
import {
  DeterministicAudioFollower,
  DeterministicFinalCompositor,
  DeterministicPreviewAdapter,
} from "../fixtures/preview-fixtures.js";

describe("P09 mixed-engine milestone fixture", () => {
  it("survives repeated transport, quality, fallback, failure, drift, and fidelity operations", async () => {
    const remotion = new DeterministicPreviewAdapter(
      "adapter-remotion-mixed",
      "layer-remotion-mixed",
      "remotion",
    );
    const hyperframes = new DeterministicPreviewAdapter(
      "adapter-hyperframes-mixed",
      "layer-hyperframes-mixed",
      "hyperframes",
    );
    const shared = new DeterministicPreviewAdapter("adapter-shared-mixed", "layer-shared-mixed", "shared");
    const audio = new DeterministicAudioFollower();
    const scheduler = new PreviewScheduler({
      projectId: "project-preview-mixed-0001",
      revisionId: "revision-preview-mixed-0001",
      timelineId: "timeline-preview-mixed-0001",
      durationFrames: "17982",
      timelineFps: { numerator: "30000", denominator: "1001" },
      adapters: [remotion, hyperframes, shared],
      layerGraph: [layer(shared, 0), layer(remotion, 10), layer(hyperframes, 20)],
      audio,
      finalCompositor: new DeterministicFinalCompositor(),
    });

    const identities: string[] = [];
    for (let iteration = 0; iteration < 25; iteration += 1) {
      identities.push((await scheduler.seek("300")).composite.identity);
      await scheduler.play();
      scheduler.advanceAuthoritativeFrames(3n);
      await scheduler.pause();
      await scheduler.stepFrames(-3);
    }
    expect(new Set(identities)).toHaveLength(1);
    expect(scheduler.snapshot().clock.masterFrame).toBe("300");

    scheduler.setLoopRange(createPreviewFrameRange("300", "330"));
    await scheduler.play();
    scheduler.advanceAuthoritativeFrames(90n);
    expect(scheduler.snapshot().clock.masterFrame).toBe("300");
    hyperframes.observedOffset = 1n;
    expect((await scheduler.reportDrift()).hardResyncRequired).toBe(true);
    hyperframes.observedOffset = 0n;
    await scheduler.pause();

    scheduler.setQuality({
      quality: "draft",
      truthMode: "interactive-approximation",
      hasBakedFallback: true,
      unsupportedEffects: true,
    });
    expect(scheduler.snapshot().qualityPolicy.fidelityEquivalent).toBe(false);
    expect(scheduler.snapshot().warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["proxy-in-use", "baked-fallback", "unsupported-effect"]),
    );

    hyperframes.failFrame = "301";
    const degraded = await scheduler.seek("301");
    expect(degraded.composite.degraded).toBe(true);
    expect(degraded.partialFailures).toHaveLength(1);
    expect(scheduler.snapshot().transport).toBe("paused");

    const fidelity = await scheduler.requestFidelityFrame("301");
    expect(fidelity).toMatchObject({
      frame: "301",
      compositorId: "final-compositor-fixture",
      strictEnvironmentFingerprint: "strict-environment-fixture-0001",
    });
    expect(audio.calls.filter((call) => call === "prepare:300").length).toBeGreaterThanOrEqual(25);
  });
});

const layer = (adapter: DeterministicPreviewAdapter, zIndex: number) => ({
  id: adapter.layerId,
  adapterId: adapter.adapterId,
  kind: adapter.kind,
  timelineRange: createPreviewFrameRange("0", "17982"),
  zIndex,
  sourceOrder: zIndex,
  opacity: 1,
  blendMode: "normal" as const,
  transform: defaultPreviewTransform,
  crop: emptyPreviewCrop,
  visible: true,
});
