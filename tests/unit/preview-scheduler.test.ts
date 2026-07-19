import { describe, expect, it } from "vitest";
import {
  createPreviewFrameRange,
  defaultPreviewTransform,
  emptyPreviewCrop,
  PreviewScheduler,
  runPreviewAdapterConformance,
  type PreviewLayerAdapter,
  type PreviewLayerNode,
} from "../../packages/preview/src/index.js";
import {
  DeterministicAudioFollower,
  DeterministicFinalCompositor,
  DeterministicPreviewAdapter,
} from "../fixtures/preview-fixtures.js";

describe("P09 authoritative preview scheduler", () => {
  it("uses an atomic seek barrier and repeats an exact composite", async () => {
    const fixture = createMixedFixture();
    const first = await fixture.scheduler.seek("42");
    const second = await fixture.scheduler.seek("42");
    expect(first.stale).toBe(false);
    expect(first.composite.identity).toBe(second.composite.identity);
    expect(first.composite.layers.map(({ node }) => node.id)).toEqual([
      "layer-shared-0001",
      "layer-remotion-0001",
      "layer-hyperframes-0001",
    ]);
    expect(fixture.scheduler.snapshot()).toMatchObject({
      transport: "paused",
      clock: {
        masterFrame: "42",
        presentationTimestamp: { numerator: "7007", denominator: "5000" },
      },
      lastError: null,
    });
    expect(fixture.audio.calls).toContain("prepare:42");
  });

  it("surfaces one failing layer without corrupting transport or hiding degradation", async () => {
    const fixture = createMixedFixture();
    fixture.hyperframes.failFrame = "20";
    const result = await fixture.scheduler.seek("20");
    expect(result.partialFailures).toEqual([
      expect.objectContaining({
        adapterId: "adapter-hyperframes-0001",
        layerId: "layer-hyperframes-0001",
      }),
    ]);
    expect(result.composite.layers.map(({ node }) => node.id)).toEqual([
      "layer-shared-0001",
      "layer-remotion-0001",
    ]);
    expect(result.composite.degraded).toBe(true);
    expect(fixture.scheduler.snapshot()).toMatchObject({
      transport: "paused",
      clock: { masterFrame: "20" },
    });
    expect(fixture.scheduler.snapshot().warnings.map((item) => item.code)).toContain("layer-failed");
  });

  it("owns play, pause, loop, rate, drift, dropped frames, and hard resync", async () => {
    const fixture = createMixedFixture();
    await fixture.scheduler.seek("9");
    fixture.scheduler.setLoopRange(createPreviewFrameRange("10", "13"));
    await fixture.scheduler.play();
    expect(fixture.scheduler.advanceAuthoritativeFrames(1n).clock.masterFrame).toBe("10");
    expect(fixture.scheduler.advanceAuthoritativeFrames(3n).clock.masterFrame).toBe("10");
    fixture.remotion.observedFrameOverride = "10";
    fixture.hyperframes.observedFrameOverride = "10";
    fixture.shared.observedFrameOverride = "10";
    fixture.hyperframes.observedOffset = 1n;
    fixture.hyperframes.droppedFrames = 2;
    const drift = await fixture.scheduler.reportDrift();
    expect(drift).toMatchObject({
      hardResyncRequired: true,
      thresholdFrames: { numerator: "1", denominator: "2" },
      totalDroppedFrames: 2,
    });
    expect(drift.items.find((item) => item.adapterId === "adapter-hyperframes-0001")).toMatchObject({
      deltaFrames: "1",
      hardResyncRequired: true,
    });
    const resync = await fixture.scheduler.hardResynchronizeIfRequired();
    expect(resync.resynchronized).toBe(true);
    expect(resync.presentation?.frame).toBe("10");
    fixture.hyperframes.observedOffset = 0n;
    fixture.hyperframes.droppedFrames = 0;
    await fixture.scheduler.play();
    await fixture.scheduler.pause();
    expect(fixture.scheduler.snapshot().transport).toBe("paused");
    expect(await fixture.scheduler.reportAudioSync()).toMatchObject({
      deltaSamples: "0",
      baseLatencyMs: 5,
      outputLatencyMs: 8,
      hardResyncRequired: false,
      correction: "none",
    });
    fixture.audio.observedSampleOffset = 1_000n;
    expect(await fixture.scheduler.reportAudioSync()).toMatchObject({
      deltaSamples: "1000",
      hardResyncRequired: true,
      correction: "barrier-required",
    });
    fixture.scheduler.setPlayRate({ numerator: "2", denominator: "1" });
    expect(fixture.scheduler.snapshot().warnings.map((item) => item.code)).toContain("audio-muted-for-rate");
  });

  it("reports preload freshness and waiting categories", async () => {
    const fixture = createMixedFixture();
    fixture.remotion.freshness = "stale";
    fixture.hyperframes.waitingFor = "engine";
    const buffering = await fixture.scheduler.preload(12, 48);
    expect(buffering).toMatchObject({
      status: "waiting",
      bufferedRange: { startFrame: "0", endFrameExclusive: "49" },
      waitingFor: ["engine"],
      staleAdapterIds: ["adapter-remotion-0001"],
    });
    expect(fixture.scheduler.snapshot().warnings.map((item) => item.code)).toEqual(
      expect.arrayContaining(["buffering", "stale-cache"]),
    );
  });

  it("routes exact frame and short range through final-compositor identity", async () => {
    const fixture = createMixedFixture();
    const frame = await fixture.scheduler.requestFidelityFrame("45");
    expect(frame).toMatchObject({
      frame: "45",
      compositorId: "final-compositor-fixture",
      colorContractId: "chai-preview-rgba8-rec709-straight-v1",
      alphaMode: "straight",
      dependencyGraphHash: "dependency-graph-fixture-0001",
    });
    const range = await fixture.scheduler.requestFidelityRange(createPreviewFrameRange("45", "50"));
    expect(range.range).toEqual({ startFrame: "45", endFrameExclusive: "50" });
  });

  it("publishes a reusable adapter compatibility harness", async () => {
    const result = await runPreviewAdapterConformance(
      () => new DeterministicPreviewAdapter("adapter-conformance-0001", "layer-conformance-0001", "remotion"),
    );
    expect(result.passed).toBe(true);
    expect(result.checks).toEqual({
      "preload-half-open-range": true,
      "exact-frame-presentation": true,
      "repeat-seek-determinism": true,
      "scheduler-owned-playback": true,
      "halt-and-suspend": true,
      disposal: true,
    });
  });

  it("disposes every layer and permanently rejects later work", async () => {
    const fixture = createMixedFixture();
    await fixture.scheduler.dispose();
    expect(fixture.scheduler.snapshot().transport).toBe("disposed");
    expect(fixture.scheduler.snapshot().layers.every((layer) => layer.state === "disposed")).toBe(true);
    await expect(fixture.scheduler.seek("1")).rejects.toThrow(/disposed/);
  });
});

const createMixedFixture = (): {
  readonly scheduler: PreviewScheduler;
  readonly remotion: DeterministicPreviewAdapter;
  readonly hyperframes: DeterministicPreviewAdapter;
  readonly shared: DeterministicPreviewAdapter;
  readonly audio: DeterministicAudioFollower;
} => {
  const remotion = new DeterministicPreviewAdapter(
    "adapter-remotion-0001",
    "layer-remotion-0001",
    "remotion",
  );
  const hyperframes = new DeterministicPreviewAdapter(
    "adapter-hyperframes-0001",
    "layer-hyperframes-0001",
    "hyperframes",
  );
  const shared = new DeterministicPreviewAdapter("adapter-shared-0001", "layer-shared-0001", "shared");
  const adapters: readonly PreviewLayerAdapter[] = [remotion, hyperframes, shared];
  const audio = new DeterministicAudioFollower();
  return {
    scheduler: new PreviewScheduler({
      projectId: "project-preview-scheduler-0001",
      revisionId: "revision-preview-scheduler-0001",
      timelineId: "timeline-preview-scheduler-0001",
      durationFrames: "120",
      timelineFps: { numerator: "30000", denominator: "1001" },
      adapters,
      layerGraph: [layer(shared, 0, 0), layer(remotion, 10, 1), layer(hyperframes, 20, 2)],
      audio,
      finalCompositor: new DeterministicFinalCompositor(),
      sessionIdFactory: (sequence, purpose) => `fixture-${purpose}-${sequence.toString().padStart(4, "0")}`,
    }),
    remotion,
    hyperframes,
    shared,
    audio,
  };
};

const layer = (adapter: PreviewLayerAdapter, zIndex: number, sourceOrder: number): PreviewLayerNode => ({
  id: adapter.layerId,
  adapterId: adapter.adapterId,
  kind: adapter.kind,
  timelineRange: createPreviewFrameRange("0", "120"),
  zIndex,
  sourceOrder,
  opacity: 1,
  blendMode: "normal",
  transform: defaultPreviewTransform,
  crop: emptyPreviewCrop,
  visible: true,
});
