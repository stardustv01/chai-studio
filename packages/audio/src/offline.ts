import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AudioGraphDocument, NormalizedRational } from "@chai-studio/schema";
import type { DecodedAudioBlock } from "./decode-cache.js";
import { evaluateAudioGraphAtFrame } from "./evaluation.js";
import { measurePcmAudio, type AudioMeasurements } from "./measurements.js";
import { sampleRangeForFrames } from "./sample-mapping.js";

export interface OfflineAudioMixArtifact {
  readonly schemaVersion: "1.0.0";
  readonly graphId: string;
  readonly range: Readonly<{ startFrame: string; endFrameExclusive: string }>;
  readonly sampleRange: Readonly<{ startSample: string; endSampleExclusive: string }>;
  readonly sampleRate: number;
  readonly channels: number;
  readonly codec: "pcm-f32le";
  readonly outputPath: string;
  readonly artifactHash: string;
  readonly graphIdentity: string;
  readonly measurements: AudioMeasurements;
}

export type OfflineAudioDecodeProvider = (input: {
  readonly sourceId: string;
  readonly startSample: bigint;
  readonly endSampleExclusive: bigint;
  readonly targetSampleRate: number;
  readonly targetChannels: number;
  readonly signal: AbortSignal;
}) => Promise<DecodedAudioBlock>;

export const renderOfflineAudioMix = async (input: {
  readonly graph: AudioGraphDocument;
  readonly timelineFps: NormalizedRational;
  readonly startFrame: bigint;
  readonly endFrameExclusive: bigint;
  readonly outputPath: string;
  readonly decode: OfflineAudioDecodeProvider;
  readonly signal: AbortSignal;
  readonly onProgress?: (progress: Readonly<{ stage: string; progress: number }>) => void;
}): Promise<OfflineAudioMixArtifact> => {
  assertAudioMixNotCancelled(input.signal);
  const range = sampleRangeForFrames(
    input.startFrame,
    input.endFrameExclusive,
    input.timelineFps,
    input.graph.sampleRate,
  );
  const sampleCount = range.endSampleExclusive - range.startSample;
  if (sampleCount > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Offline audio range exceeds the in-memory deterministic mixer limit.");
  }
  const channelCount = channelsForLayout(input.graph.channelLayout);
  const channels = Array.from({ length: channelCount }, () => new Float32Array(Number(sampleCount)));
  input.onProgress?.({ stage: "decoding", progress: 0 });
  const activeClips = input.graph.clips.filter(
    (clip) =>
      BigInt(clip.endFrameExclusive) > input.startFrame && BigInt(clip.startFrame) < input.endFrameExclusive,
  );
  const decoded = new Map<string, DecodedAudioBlock>();
  for (const [index, clip] of activeClips.entries()) {
    assertAudioMixNotCancelled(input.signal);
    const source = input.graph.sources.find((item) => item.id === clip.sourceId);
    if (source === undefined) throw new Error(`Offline audio source ${clip.sourceId} is missing.`);
    const channelMap = input.graph.channelMaps.find((item) => item.id === clip.channelMapId);
    if (channelMap === undefined) throw new Error(`Offline channel map ${clip.channelMapId} is missing.`);
    const block = normalizeOfflineDecodedBlock(
      await input.decode({
        sourceId: source.id,
        startSample: BigInt(clip.sourceStartSample),
        endSampleExclusive: BigInt(clip.sourceEndSampleExclusive),
        targetSampleRate: input.graph.sampleRate,
        targetChannels: channelMap.inputChannels,
        signal: input.signal,
      }),
      {
        sourceId: source.id,
        startSample: BigInt(clip.sourceStartSample),
        endSampleExclusive: BigInt(clip.sourceEndSampleExclusive),
        targetSampleRate: input.graph.sampleRate,
        targetChannels: channelMap.inputChannels,
      },
    );
    decoded.set(clip.id, block);
    input.onProgress?.({
      stage: "decoding",
      progress: (index + 1) / activeClips.length,
    });
  }

  input.onProgress?.({ stage: "mixing", progress: 0 });
  for (let outputIndex = 0; outputIndex < Number(sampleCount); outputIndex += 1) {
    if (outputIndex % 4096 === 0) {
      assertAudioMixNotCancelled(input.signal);
      input.onProgress?.({
        stage: "mixing",
        progress: outputIndex / Number(sampleCount),
      });
    }
    const timelineSample = range.startSample + BigInt(outputIndex);
    const frame = frameForSample(timelineSample, input.timelineFps, input.graph.sampleRate);
    const evaluated = evaluateAudioGraphAtFrame(input.graph, frame);
    for (const clipState of evaluated.clips) {
      const clip = activeClips.find((item) => item.id === clipState.clipId);
      const block = decoded.get(clipState.clipId);
      if (clip === undefined || block === undefined || !clipState.audible) continue;
      const clipTimelineStart = sampleRangeForFrames(
        BigInt(clip.startFrame),
        BigInt(clip.startFrame),
        input.timelineFps,
        input.graph.sampleRate,
      ).startSample;
      const sourceIndex = Number(timelineSample - clipTimelineStart);
      const firstChannel = block.channels[0];
      if (firstChannel === undefined || sourceIndex < 0 || sourceIndex >= firstChannel.length) continue;
      const channelMap = input.graph.channelMaps.find((item) => item.id === clip.channelMapId);
      if (channelMap === undefined) continue;
      for (let outputChannelIndex = 0; outputChannelIndex < channelCount; outputChannelIndex += 1) {
        const row = channelMap.matrix[outputChannelIndex] ?? [];
        const mapped = row.reduce(
          (sum, coefficient, inputChannelIndex) =>
            sum + (block.channels[inputChannelIndex]?.[sourceIndex] ?? 0) * coefficient,
          0,
        );
        const channelGain =
          outputChannelIndex === 0
            ? clipState.leftGain
            : outputChannelIndex === 1
              ? clipState.rightGain
              : clipState.linearGain;
        const outputChannel = channels[outputChannelIndex];
        if (outputChannel === undefined) throw new Error("Offline output channel allocation failed.");
        outputChannel[outputIndex] = (outputChannel[outputIndex] ?? 0) + mapped * channelGain;
      }
    }
  }
  input.onProgress?.({ stage: "mixing", progress: 1 });
  const bytes = encodeFloat32Wave(channels, input.graph.sampleRate);
  const temporaryPath = `${input.outputPath}.partial`;
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  try {
    await writeFile(temporaryPath, bytes);
    assertAudioMixNotCancelled(input.signal);
    await rename(temporaryPath, input.outputPath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  const artifactBytes = await readFile(input.outputPath);
  const artifactHash = sha256(artifactBytes);
  const graphIdentity = sha256(Buffer.from(stableStringify(input.graph), "utf8"));
  const measurements = measurePcmAudio({ sampleRate: input.graph.sampleRate, channels });
  input.onProgress?.({ stage: "committing", progress: 1 });
  return {
    schemaVersion: "1.0.0",
    graphId: input.graph.graphId,
    range: {
      startFrame: input.startFrame.toString(10),
      endFrameExclusive: input.endFrameExclusive.toString(10),
    },
    sampleRange: {
      startSample: range.startSample.toString(10),
      endSampleExclusive: range.endSampleExclusive.toString(10),
    },
    sampleRate: input.graph.sampleRate,
    channels: channelCount,
    codec: "pcm-f32le",
    outputPath: input.outputPath,
    artifactHash,
    graphIdentity,
    measurements,
  };
};

export const buildFfmpegAudioGraph = (input: {
  readonly graph: AudioGraphDocument;
  readonly timelineFps: NormalizedRational;
}): Readonly<{
  filterComplex: string;
  outputLabel: "program_audio";
  inputContract: "authoritative-pcm-f32le";
  dependencyInput: string;
}> => {
  const filterComplex =
    `[0:a]aformat=sample_fmts=flt:sample_rates=${input.graph.sampleRate.toString()}:` +
    `channel_layouts=${ffmpegLayout(input.graph.channelLayout)},` +
    "asetpts=PTS-STARTPTS[program_audio]";
  return {
    filterComplex,
    outputLabel: "program_audio",
    inputContract: "authoritative-pcm-f32le",
    dependencyInput: stableStringify({
      evaluator: "renderOfflineAudioMix",
      graph: input.graph,
      timelineFps: input.timelineFps,
    }),
  };
};

const frameForSample = (sample: bigint, fps: NormalizedRational, sampleRate: number): bigint =>
  (sample * BigInt(fps.numerator)) / (BigInt(sampleRate) * BigInt(fps.denominator));

const channelsForLayout = (layout: AudioGraphDocument["channelLayout"]): number =>
  layout === "mono" ? 1 : layout === "stereo" ? 2 : layout === "5.1" ? 6 : 8;

const ffmpegLayout = (layout: AudioGraphDocument["channelLayout"]): string =>
  layout === "5.1" ? "5.1" : layout === "7.1" ? "7.1" : layout;

const assertAudioMixNotCancelled = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException("Offline audio mix cancelled.", "AbortError");
};

const normalizeOfflineDecodedBlock = (
  block: DecodedAudioBlock,
  request: Readonly<{
    sourceId: string;
    startSample: bigint;
    endSampleExclusive: bigint;
    targetSampleRate: number;
    targetChannels: number;
  }>,
): DecodedAudioBlock => {
  const expectedLength = Number(request.endSampleExclusive - request.startSample);
  if (
    !Number.isSafeInteger(expectedLength) ||
    expectedLength < 0 ||
    block.sourceId !== request.sourceId ||
    block.startSample !== request.startSample ||
    block.endSampleExclusive !== request.endSampleExclusive ||
    block.sampleRate !== request.targetSampleRate ||
    block.channels.length !== request.targetChannels ||
    block.channels.some((channel) => channel.length !== expectedLength)
  ) {
    throw new Error(
      `Offline decoder returned the wrong range/format for ${request.sourceId} samples ${request.startSample.toString()}-${request.endSampleExclusive.toString()}.`,
    );
  }
  const channels = block.channels.map((channel) => channel.slice());
  for (const gap of block.gaps) {
    if (
      gap.startSample < block.startSample ||
      gap.endSampleExclusive > block.endSampleExclusive ||
      gap.endSampleExclusive < gap.startSample
    ) {
      throw new Error(`Offline decoder reported an invalid gap for ${request.sourceId}.`);
    }
    const start = Number(gap.startSample - block.startSample);
    const end = Number(gap.endSampleExclusive - block.startSample);
    for (const channel of channels) channel.fill(0, start, end);
  }
  return { ...block, channels };
};

const encodeFloat32Wave = (channels: readonly Float32Array[], sampleRate: number): Buffer => {
  const channelCount = channels.length;
  const sampleCount = channels[0]?.length ?? 0;
  const dataLength = sampleCount * channelCount * 4;
  const buffer = Buffer.allocUnsafe(44 + dataLength);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataLength, 4);
  buffer.write("WAVEfmt ", 8, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(3, 20);
  buffer.writeUInt16LE(channelCount, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channelCount * 4, 28);
  buffer.writeUInt16LE(channelCount * 4, 32);
  buffer.writeUInt16LE(32, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataLength, 40);
  let offset = 44;
  for (let sample = 0; sample < sampleCount; sample += 1) {
    for (const channel of channels) {
      buffer.writeFloatLE(channel[sample] ?? 0, offset);
      offset += 4;
    }
  }
  return buffer;
};

const stableStringify = (value: unknown): string => JSON.stringify(sortValue(value));

const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right, "en"))
        .map(([key, item]) => [key, sortValue(item)]),
    );
  }
  return value;
};

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");
