import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFfmpegAudioGraph, renderOfflineAudioMix } from "../../packages/audio/src/offline.js";
import { normalizeRational } from "../../packages/schema/src/index.js";
import { createAudioGraphFixture } from "../fixtures/audio-fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P16 deterministic offline audio mix", () => {
  it("renders a lossless sample-exact artifact with stable identity, progress, and measurements", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chai-audio-mix-"));
    directories.push(directory);
    const graph = createAudioGraphFixture();
    const fps = normalizeRational(30_000n, 1_001n);
    const progress: string[] = [];
    const render = (outputPath: string) =>
      renderOfflineAudioMix({
        graph,
        timelineFps: fps,
        startFrame: 0n,
        endFrameExclusive: 10n,
        outputPath,
        decode: (request) => {
          const length = Number(request.endSampleExclusive - request.startSample);
          const left = Float32Array.from({ length }, (_, index) => Math.sin(index / 13) * 0.1);
          const right = Float32Array.from({ length }, (_, index) => Math.cos(index / 17) * 0.1);
          return Promise.resolve({
            sourceId: request.sourceId,
            startSample: request.startSample,
            endSampleExclusive: request.endSampleExclusive,
            sampleRate: request.targetSampleRate,
            channels: [left, right],
            gaps: [],
          });
        },
        signal: new AbortController().signal,
        onProgress: (update) => progress.push(update.stage),
      });
    const first = await render(path.join(directory, "mix-a.wav"));
    const second = await render(path.join(directory, "mix-b.wav"));
    await access(first.outputPath);
    expect(first).toMatchObject({
      sampleRange: { startSample: "0", endSampleExclusive: "16016" },
      sampleRate: 48_000,
      channels: 2,
      codec: "pcm-f32le",
    });
    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.graphIdentity).toBe(second.graphIdentity);
    expect(first.measurements.durationSamples).toBe(16_016n);
    expect(progress).toEqual(expect.arrayContaining(["decoding", "mixing", "committing"]));
    expect((await readFile(first.outputPath)).subarray(0, 4).toString("ascii")).toBe("RIFF");
    const ffmpeg = buildFfmpegAudioGraph({ graph, timelineFps: fps });
    expect(ffmpeg).toMatchObject({ inputContract: "authoritative-pcm-f32le" });
    expect(ffmpeg.filterComplex).toContain("sample_rates=48000");
    expect(ffmpeg.filterComplex).toContain("channel_layouts=stereo");
    expect(ffmpeg.filterComplex).not.toContain("amix=");
    expect(ffmpeg.dependencyInput).toContain("renderOfflineAudioMix");
  });

  it("removes partial artifacts when cancellation is observed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chai-audio-cancel-"));
    directories.push(directory);
    const controller = new AbortController();
    controller.abort();
    const outputPath = path.join(directory, "cancelled.wav");
    await expect(
      renderOfflineAudioMix({
        graph: createAudioGraphFixture(),
        timelineFps: normalizeRational(30_000n, 1_001n),
        startFrame: 0n,
        endFrameExclusive: 10n,
        outputPath,
        decode: () => Promise.reject(new Error("must not decode")),
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(access(outputPath)).rejects.toThrow();
  });

  it("applies explicit channel maps and accepts a clean retry after cancellation", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chai-audio-channel-map-"));
    directories.push(directory);
    const fixture = createAudioGraphFixture();
    const firstClip = required(fixture.clips[0]);
    const graph = {
      ...fixture,
      sources: [{ ...required(fixture.sources[0]), sourceChannels: 1 }],
      clips: [
        {
          ...firstClip,
          endFrameExclusive: "1" as typeof firstClip.endFrameExclusive,
          sourceEndSampleExclusive: "1602" as typeof firstClip.sourceEndSampleExclusive,
          fadeInFrames: "0" as typeof firstClip.fadeInFrames,
          fadeOutFrames: "0" as typeof firstClip.fadeOutFrames,
          automationLaneIds: [],
          syncAnchorIds: [],
        },
      ],
      automationLanes: [],
      crossfades: [],
      channelMaps: [
        {
          id: firstClip.channelMapId,
          inputChannels: 1,
          outputChannels: 2,
          matrix: [[1], [0.5]],
        },
      ],
    };
    const decode = (request: {
      readonly sourceId: string;
      readonly startSample: bigint;
      readonly endSampleExclusive: bigint;
      readonly targetSampleRate: number;
    }) =>
      Promise.resolve({
        sourceId: request.sourceId,
        startSample: request.startSample,
        endSampleExclusive: request.endSampleExclusive,
        sampleRate: request.targetSampleRate,
        channels: [new Float32Array(Number(request.endSampleExclusive - request.startSample)).fill(1)],
        gaps: [],
      });
    const outputPath = path.join(directory, "mapped.wav");
    const cancelled = new AbortController();
    await expect(
      renderOfflineAudioMix({
        graph,
        timelineFps: normalizeRational(30_000n, 1_001n),
        startFrame: 0n,
        endFrameExclusive: 1n,
        outputPath,
        decode,
        signal: cancelled.signal,
        onProgress: (update) => {
          if (update.stage === "mixing" && update.progress === 0) cancelled.abort();
        },
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    await expect(access(outputPath)).rejects.toThrow();

    const result = await renderOfflineAudioMix({
      graph,
      timelineFps: normalizeRational(30_000n, 1_001n),
      startFrame: 0n,
      endFrameExclusive: 1n,
      outputPath,
      decode,
      signal: new AbortController().signal,
    });
    const bytes = await readFile(result.outputPath);
    expect(bytes.readFloatLE(44)).toBeCloseTo(Math.SQRT1_2, 5);
    expect(bytes.readFloatLE(48)).toBeCloseTo(Math.SQRT1_2 * 0.5, 5);
  });

  it("rejects decoder output that does not match the requested range and channel format", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chai-audio-invalid-decode-"));
    directories.push(directory);
    await expect(
      renderOfflineAudioMix({
        graph: createAudioGraphFixture(),
        timelineFps: normalizeRational(30_000n, 1_001n),
        startFrame: 0n,
        endFrameExclusive: 1n,
        outputPath: path.join(directory, "invalid.wav"),
        decode: (request) =>
          Promise.resolve({
            sourceId: request.sourceId,
            startSample: request.startSample,
            endSampleExclusive: request.endSampleExclusive,
            sampleRate: request.targetSampleRate,
            channels: [new Float32Array(1)],
            gaps: [],
          }),
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Offline decoder returned the wrong range/format");
  });
});

const required = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error("Required audio test fixture value is missing.");
  return value;
};
