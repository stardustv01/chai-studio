import { describe, expect, it } from "vitest";
import {
  AuthoritativeAudioPreviewFollower,
  type AudioPreviewBackend,
} from "../../packages/audio/src/index.js";
import {
  createPreviewFrameRange,
  defaultPreviewTransform,
  emptyPreviewCrop,
  PreviewScheduler,
} from "../../packages/preview/src/index.js";
import { DeterministicPreviewAdapter } from "../fixtures/preview-fixtures.js";
import { audioTestFps, createAudioGraphFixture } from "../fixtures/audio-fixtures.js";

describe("P16 scheduler-owned audio preview", () => {
  it("prepares behind seek barriers, starts only at +1x, pauses cleanly, and reports sample drift", async () => {
    const graph = createAudioGraphFixture();
    const backend = new PreviewBackendFixture();
    const follower = new AuthoritativeAudioPreviewFollower({
      graph,
      timelineFps: audioTestFps,
      backend,
    });
    const adapter = new DeterministicPreviewAdapter(
      "adapter-audio-preview-test-0001",
      "layer-audio-preview-test-0001",
      "shared",
    );
    const scheduler = new PreviewScheduler({
      projectId: "project-audio-preview-test-0001",
      revisionId: "revision-audio-preview-test-0001",
      timelineId: "timeline-audio-preview-test-0001",
      durationFrames: "17982",
      timelineFps: audioTestFps,
      adapters: [adapter],
      layerGraph: [
        {
          id: adapter.layerId,
          adapterId: adapter.adapterId,
          kind: adapter.kind,
          timelineRange: createPreviewFrameRange("0", "17982"),
          zIndex: 0,
          sourceOrder: 0,
          opacity: 1,
          blendMode: "normal",
          transform: defaultPreviewTransform,
          crop: emptyPreviewCrop,
          visible: true,
        },
      ],
      audio: follower,
      audioSampleRate: 48_000,
    });

    const seek = await scheduler.seek("300");
    expect(seek.audioReady).toBe(true);
    expect(backend.calls).toEqual(expect.arrayContaining(["halt", "prepare:480480"]));
    await scheduler.play();
    expect(backend.calls).toContain("begin:480480");
    await scheduler.pause();
    expect(backend.calls.at(-1)).toBe("halt");

    const scrub = await scheduler.scrub("301");
    expect(scrub).toMatchObject({ audioAuditioned: true, grainDurationMs: 48 });
    expect(backend.calls.at(-1)).toBe("audition:482081");

    scheduler.setPlayRate({ numerator: "2", denominator: "1" });
    const beginCount = backend.calls.filter((call) => call.startsWith("begin:")).length;
    await scheduler.play();
    expect(backend.calls.filter((call) => call.startsWith("begin:")).length).toBe(beginCount);
    await scheduler.pause();

    scheduler.setPlayRate({ numerator: "1", denominator: "1" });
    await scheduler.seek("300");
    backend.observed = 480_480n + 802n;
    expect(await scheduler.reportAudioSync()).toMatchObject({
      expectedSample: "480480",
      deltaSamples: "802",
      hardResyncRequired: true,
      correction: "barrier-required",
    });
    await scheduler.dispose();
  });
});

class PreviewBackendFixture implements AudioPreviewBackend {
  readonly calls: string[] = [];
  observed = 0n;

  prepare(input: { readonly sample: bigint }) {
    this.calls.push(`prepare:${input.sample.toString(10)}`);
    this.observed = input.sample;
    return Promise.resolve({ baseLatencyMs: 5, outputLatencyMs: 9 });
  }
  begin(input: { readonly startSample: bigint }) {
    this.calls.push(`begin:${input.startSample.toString(10)}`);
    this.observed = input.startSample;
    return Promise.resolve();
  }
  auditionScrub(input: { readonly sample: bigint }) {
    this.calls.push(`audition:${input.sample.toString(10)}`);
    this.observed = input.sample;
    return Promise.resolve({ auditioned: true, grainDurationMs: 48 });
  }
  halt() {
    this.calls.push("halt");
    return Promise.resolve();
  }
  observedSample() {
    return Promise.resolve(this.observed);
  }
  suspend() {
    this.calls.push("suspend");
    return Promise.resolve();
  }
  dispose() {
    this.calls.push("dispose");
    return Promise.resolve();
  }
}
