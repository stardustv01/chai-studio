import type { AudioGraphSource } from "@chai-studio/schema";

export interface DecodedAudioBlock {
  readonly sourceId: string;
  readonly startSample: bigint;
  readonly endSampleExclusive: bigint;
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
  readonly gaps: readonly Readonly<{ startSample: bigint; endSampleExclusive: bigint }>[];
}

export interface AudioDecodeRequest {
  readonly source: AudioGraphSource;
  readonly startSample: bigint;
  readonly endSampleExclusive: bigint;
  readonly targetSampleRate: number;
  readonly targetChannels: number;
  readonly signal: AbortSignal;
}

export type AudioBlockDecoder = (request: AudioDecodeRequest) => Promise<DecodedAudioBlock>;
export type AudioDecodePurpose = "preview" | "final";

export class AudioDecodeCache {
  readonly #decode: AudioBlockDecoder;
  readonly #entries = new Map<string, Promise<DecodedAudioBlock>>();

  constructor(decode: AudioBlockDecoder) {
    this.#decode = decode;
  }

  decode(request: AudioDecodeRequest): Promise<DecodedAudioBlock> {
    if (request.endSampleExclusive <= request.startSample) {
      return Promise.reject(new Error("Audio decode range must be non-empty and half-open."));
    }
    if (request.signal.aborted)
      return Promise.reject(new DOMException("Audio decode cancelled.", "AbortError"));
    const key = decodeCacheKey(request);
    const existing = this.#entries.get(key);
    if (existing !== undefined) return existing;
    const pending = this.#decode(request)
      .then((block) => normalizeDecodedAudioBlock(block, request))
      .catch((cause: unknown) => {
        this.#entries.delete(key);
        const message = cause instanceof Error ? cause.message : String(cause);
        throw new Error(
          `Audio decode failed for ${request.source.id} samples ${request.startSample.toString()}-${request.endSampleExclusive.toString()}: ${message}`,
          { cause },
        );
      });
    this.#entries.set(key, pending);
    return pending;
  }

  invalidateSource(sourceId: string): void {
    for (const key of this.#entries.keys()) if (key.startsWith(`${sourceId}|`)) this.#entries.delete(key);
  }

  clear(): void {
    this.#entries.clear();
  }
}

export const decodeCacheKey = (request: Omit<AudioDecodeRequest, "signal">): string =>
  [
    request.source.id,
    request.source.contentHash,
    request.source.previewPolicy,
    request.startSample.toString(10),
    request.endSampleExclusive.toString(10),
    request.targetSampleRate.toString(),
    request.targetChannels.toString(),
  ].join("|");

export const selectAudioDecodeInputPath = (
  source: AudioGraphSource,
  purpose: AudioDecodePurpose,
): Readonly<{ path: string; quality: "original" | "proxy" }> =>
  purpose === "preview" && source.previewPolicy === "proxy-preferred" && source.proxyPath !== null
    ? { path: source.proxyPath, quality: "proxy" }
    : { path: source.originalPath, quality: "original" };

export const normalizeDecodedAudioBlock = (
  block: DecodedAudioBlock,
  request: Omit<AudioDecodeRequest, "signal">,
): DecodedAudioBlock => {
  const expectedLength = Number(request.endSampleExclusive - request.startSample);
  if (
    !Number.isSafeInteger(expectedLength) ||
    expectedLength < 0 ||
    block.sourceId !== request.source.id ||
    block.startSample !== request.startSample ||
    block.endSampleExclusive !== request.endSampleExclusive ||
    block.sampleRate !== request.targetSampleRate ||
    block.channels.length !== request.targetChannels ||
    block.channels.some((channel) => channel.length !== expectedLength)
  ) {
    throw new Error("Decoder returned a block that does not match the exact requested range/format.");
  }
  const channels = block.channels.map((channel) => channel.slice());
  for (const gap of block.gaps) {
    if (
      gap.startSample < block.startSample ||
      gap.endSampleExclusive > block.endSampleExclusive ||
      gap.endSampleExclusive < gap.startSample
    ) {
      throw new Error("Decoder reported a gap outside the requested sample range.");
    }
    const start = Number(gap.startSample - block.startSample);
    const end = Number(gap.endSampleExclusive - block.startSample);
    for (const channel of channels) channel.fill(0, start, end);
  }
  return { ...block, channels };
};
