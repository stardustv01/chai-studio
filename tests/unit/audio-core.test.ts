import { describe, expect, it, vi } from "vitest";
import {
  assertValidAudioGraph,
  AudioDecodeCache,
  AuthoritativeAudioPreviewFollower,
  audioDriftAtFrame,
  completeAudioPreprocessingPlan,
  createAudioPreprocessingPlan,
  crossfadeGainAtFrame,
  evaluateAudioGraphAtFrame,
  executeAudioGraphCommand,
  generateDuckingAutomation,
  measurePcmAudio,
  sampleBoundaryForFrame,
  sampleRangeForFrames,
  selectAudioDecodeInputPath,
  validateAudioGraph,
  type AudioPreviewBackend,
} from "../../packages/audio/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";
import { audioTestFps, createAudioGraphFixture } from "../fixtures/audio-fixtures.js";

describe("P16 authoritative audio core", () => {
  it("maps exact rational frame ranges and a 24-hour boundary without integer drift", () => {
    expect(sampleRangeForFrames(0n, 300n, audioTestFps, 48_000)).toEqual({
      startSample: 0n,
      endSampleExclusive: 480_480n,
    });
    expect(sampleBoundaryForFrame(1n, audioTestFps, 48_000, "floor")).toBe(1_601n);
    expect(sampleBoundaryForFrame(1n, audioTestFps, 48_000, "ceil")).toBe(1_602n);
    const dayFrame = 2_589_408n;
    const expected = sampleBoundaryForFrame(dayFrame, audioTestFps, 48_000, "floor");
    expect(
      audioDriftAtFrame({
        frame: dayFrame,
        observedSample: expected,
        fps: audioTestFps,
        sampleRate: 48_000,
        thresholdFrames: normalizeRational(1n, 2n),
      }),
    ).toMatchObject({ deltaSamples: 0n, hardResyncRequired: false, thresholdSamples: 801n });
  });

  it("validates graph references, route ownership, ranges, and automation frames", () => {
    const graph = createAudioGraphFixture();
    const firstClip = required(graph.clips[0]);
    const firstChannelMap = required(graph.channelMaps[0]);
    expect(validateAudioGraph(graph)).toEqual([]);
    expect(assertValidAudioGraph(graph)).toBe(graph);
    const broken = {
      ...graph,
      clips: [{ ...firstClip, busId: "bus-missing-test-0001" }, ...graph.clips.slice(1)],
    };
    expect(validateAudioGraph(broken).map((issue) => issue.code)).toContain("audio.clip.bus-missing");
    const invalidChannelMap = {
      ...graph,
      channelMaps: [{ ...firstChannelMap, matrix: [[1, 0]] }],
    };
    expect(validateAudioGraph(invalidChannelMap).map((issue) => issue.code)).toContain(
      "audio.channel-map.invalid",
    );
  });

  it("evaluates shared automation, fades, equal-power crossfades, buses, and solo/mute", () => {
    const graph = createAudioGraphFixture();
    const atStart = required(evaluateAudioGraphAtFrame(graph, 0n).clips[0]);
    const atSixty = required(evaluateAudioGraphAtFrame(graph, 60n).clips[0]);
    expect(atStart.linearGain).toBe(0);
    expect(atSixty.gainDb).toBe(0);
    const crossfade = required(graph.crossfades[0]);
    expect(crossfadeGainAtFrame(crossfade, "from", 120n)).toBeCloseTo(1, 8);
    expect(crossfadeGainAtFrame(crossfade, "to", 135n)).toBeCloseTo(Math.SQRT1_2, 6);
    const musicBusId = `${graph.graphId}:music`;
    const muted = executeAudioGraphCommand(graph, {
      kind: "audio.bus.update",
      busId: musicBusId,
      patch: { muted: true },
    }).graph;
    expect(
      evaluateAudioGraphAtFrame(muted, 135n).clips.find((clip) => clip.clipId.endsWith("0002"))?.audible,
    ).toBe(false);
  });

  it("returns exact inverse commands for bus, clip, automation, and preprocessing edits", () => {
    const graph = createAudioGraphFixture();
    const command = {
      kind: "audio.clip.update" as const,
      clipId: "audio-clip-test-0001",
      patch: { gainDb: -4.5, fadeInFrames: "24" as (typeof graph.clips)[0]["fadeInFrames"] },
    };
    const changed = executeAudioGraphCommand(graph, command);
    const restored = executeAudioGraphCommand(changed.graph, changed.inverse);
    expect(restored.graph).toEqual(graph);
    const plan = createAudioPreprocessingPlan({
      referenceId: "audio-processing-test-0001",
      kind: "normalize",
      sourceId: "audio-source-test-0001",
      generatedAssetId: "asset-generated-audio-test-0001",
      inputContentHash: "c".repeat(64),
      settingsHash: "e".repeat(64),
      outputRelativePath: "derived/audio/normalized.wav",
    });
    expect(plan).toMatchObject({ preservesOriginal: true, attributable: true });
    expect(completeAudioPreprocessingPlan(plan, "f".repeat(64)).reference).toMatchObject({
      status: "ready",
      outputContentHash: "f".repeat(64),
    });
  });

  it("generates explicit deterministic ducking automation without destructive processing", () => {
    const graph = createAudioGraphFixture();
    const lane = generateDuckingAutomation({
      rule: required(graph.duckingRules[0]),
      laneId: "audio-lane-ducking-test-0001",
      keyframeIdPrefix: "audio-key-ducking-test",
      windows: [
        { startFrame: "100", endFrameExclusive: "140", peakDb: -12 },
        { startFrame: "200", endFrameExclusive: "220", peakDb: -40 },
      ],
    });
    expect(lane.keyframes.map((keyframe) => [keyframe.frame, keyframe.value])).toEqual([
      ["94", 0],
      ["100", -8],
      ["140", -8],
      ["158", 0],
    ]);
  });

  it("deduplicates decode/cache work and reports the exact failing source range", async () => {
    const graph = createAudioGraphFixture();
    const firstSource = required(graph.sources[0]);
    const secondSource = required(graph.sources[1]);
    const decoder = vi.fn(() =>
      Promise.resolve({
        sourceId: firstSource.id,
        startSample: 0n,
        endSampleExclusive: 10n,
        sampleRate: 48_000,
        channels: [new Float32Array(10)],
        gaps: [],
      }),
    );
    const cache = new AudioDecodeCache(decoder);
    const request = {
      source: firstSource,
      startSample: 0n,
      endSampleExclusive: 10n,
      targetSampleRate: 48_000,
      targetChannels: 1,
      signal: new AbortController().signal,
    };
    await Promise.all([cache.decode(request), cache.decode(request)]);
    expect(decoder).toHaveBeenCalledTimes(1);
    expect(selectAudioDecodeInputPath(secondSource, "preview")).toMatchObject({
      quality: "proxy",
      path: "derived/audio/music-preview.wav",
    });
    expect(selectAudioDecodeInputPath(secondSource, "final")).toMatchObject({
      quality: "original",
      path: "media/audio/music.wav",
    });
    const gapCache = new AudioDecodeCache(() =>
      Promise.resolve({
        sourceId: firstSource.id,
        startSample: 0n,
        endSampleExclusive: 10n,
        sampleRate: 48_000,
        channels: [new Float32Array(10).fill(1)],
        gaps: [{ startSample: 2n, endSampleExclusive: 5n }],
      }),
    );
    expect(Array.from(required((await gapCache.decode(request)).channels[0]))).toEqual([
      1, 1, 0, 0, 0, 1, 1, 1, 1, 1,
    ]);
    const failing = new AudioDecodeCache(() => Promise.reject(new Error("corrupt packet")));
    await expect(failing.decode(request)).rejects.toThrow(
      "audio-source-test-0001 samples 0-10: corrupt packet",
    );
  });

  it("measures loudness, true peak, clipping, silence, channels, and exact duration", () => {
    const left = Float32Array.from([0, 0.5, 1.1, 0]);
    const right = Float32Array.from([0, -0.25, -1.2, 0]);
    const measurement = measurePcmAudio({ sampleRate: 48_000, channels: [left, right] });
    expect(measurement).toMatchObject({
      sampleRate: 48_000,
      channels: 2,
      sampleCountPerChannel: 4,
      durationSamples: 4n,
      clippedSampleCount: 2,
      silentSampleCount: 4,
    });
    expect(measurement.truePeakDbtp).toBeGreaterThan(0);
    expect(measurement.integratedLufs).not.toBeNull();
  });

  it("follows scheduler sessions and never becomes the master clock", async () => {
    const graph = createAudioGraphFixture();
    const backend = new FakeAudioPreviewBackend();
    const follower = new AuthoritativeAudioPreviewFollower({
      graph,
      timelineFps: audioTestFps,
      backend,
    });
    const prepared = await follower.prepare({
      schedulerSessionId: "audio-session-test-0001",
      frame: "300",
      signal: new AbortController().signal,
    });
    expect(prepared.expectedSample).toBe("480480");
    await follower.begin({
      schedulerSessionId: "audio-session-test-0001",
      startFrame: "300",
      timelineFps: audioTestFps,
      playRate: normalizeRational(1n, 1n),
      nativeAudioSuppressed: true,
      signal: new AbortController().signal,
    });
    expect(await follower.report("audio-session-test-0001")).toMatchObject({
      expectedSample: "480480",
      observedSample: "480480",
    });
    expect(backend.calls).toEqual(["prepare:480480", "begin:480480"]);
  });
});

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Required audio test fixture value is missing.");
  return value;
};

class FakeAudioPreviewBackend implements AudioPreviewBackend {
  readonly calls: string[] = [];
  observed = 480_480n;

  prepare(input: { readonly sample: bigint }) {
    this.calls.push(`prepare:${input.sample.toString()}`);
    return Promise.resolve({ baseLatencyMs: 4, outputLatencyMs: 8 });
  }
  begin(input: { readonly startSample: bigint }) {
    this.calls.push(`begin:${input.startSample.toString()}`);
    this.observed = input.startSample;
    return Promise.resolve();
  }
  halt(sessionId: string) {
    this.calls.push(`halt:${sessionId}`);
    return Promise.resolve();
  }
  observedSample() {
    return Promise.resolve(this.observed);
  }
  suspend() {
    return Promise.resolve();
  }
  dispose() {
    return Promise.resolve();
  }
}
