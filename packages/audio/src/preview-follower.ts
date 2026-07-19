import type { AudioGraphDocument, NormalizedRational } from "@chai-studio/schema";
import { sampleBoundaryForFrame } from "./sample-mapping.js";

export interface AudioPreviewPlaybackSession {
  readonly schedulerSessionId: string;
  readonly startFrame: string;
  readonly timelineFps: Readonly<{ numerator: string; denominator: string }>;
  readonly playRate: Readonly<{ numerator: string; denominator: string }>;
  readonly nativeAudioSuppressed: true;
  readonly signal: AbortSignal;
}

export interface AudioPreviewBackend {
  prepare(input: {
    readonly graph: AudioGraphDocument;
    readonly sample: bigint;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ baseLatencyMs: number; outputLatencyMs: number }>>;
  begin(input: {
    readonly graph: AudioGraphDocument;
    readonly schedulerSessionId: string;
    readonly startSample: bigint;
    readonly signal: AbortSignal;
  }): Promise<void>;
  auditionScrub?(input: {
    readonly graph: AudioGraphDocument;
    readonly schedulerSessionId: string;
    readonly sample: bigint;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ auditioned: boolean; grainDurationMs: number }>>;
  halt(schedulerSessionId: string): Promise<void>;
  observedSample(schedulerSessionId: string): Promise<bigint>;
  health?(): Readonly<{
    droppedBufferCount: number;
    bufferedSampleRanges: readonly Readonly<{ startSample: string; endSampleExclusive: string }>[];
  }>;
  suspend(): Promise<void>;
  dispose(): Promise<void>;
}

export class AuthoritativeAudioPreviewFollower {
  readonly followerId = "chai-authoritative-audio-v1";
  readonly #graph: AudioGraphDocument;
  readonly #timelineFps: NormalizedRational;
  readonly #backend: AudioPreviewBackend;
  #expectedSample = 0n;
  #sessionId: string | null = null;
  #baseLatencyMs = 0;
  #outputLatencyMs = 0;

  constructor(input: {
    readonly graph: AudioGraphDocument;
    readonly timelineFps: NormalizedRational;
    readonly backend: AudioPreviewBackend;
  }) {
    this.#graph = input.graph;
    this.#timelineFps = input.timelineFps;
    this.#backend = input.backend;
  }

  async halt(schedulerSessionId: string): Promise<void> {
    await this.#backend.halt(schedulerSessionId);
    this.#sessionId = schedulerSessionId;
  }

  async prepare(input: {
    readonly schedulerSessionId: string;
    readonly frame: string;
    readonly signal: AbortSignal;
  }): Promise<
    Readonly<{ ready: true; expectedSample: string; baseLatencyMs: number; outputLatencyMs: number }>
  > {
    this.#expectedSample = sampleBoundaryForFrame(
      BigInt(input.frame),
      this.#timelineFps,
      this.#graph.sampleRate,
      "floor",
    );
    const latency = await this.#backend.prepare({
      graph: this.#graph,
      sample: this.#expectedSample,
      signal: input.signal,
    });
    this.#sessionId = input.schedulerSessionId;
    this.#baseLatencyMs = latency.baseLatencyMs;
    this.#outputLatencyMs = latency.outputLatencyMs;
    return {
      ready: true,
      expectedSample: this.#expectedSample.toString(10),
      baseLatencyMs: this.#baseLatencyMs,
      outputLatencyMs: this.#outputLatencyMs,
    };
  }

  async begin(session: AudioPreviewPlaybackSession): Promise<void> {
    if (
      session.playRate.numerator !== session.playRate.denominator ||
      BigInt(session.playRate.numerator) <= 0n
    ) {
      return;
    }
    const startSample = sampleBoundaryForFrame(
      BigInt(session.startFrame),
      this.#timelineFps,
      this.#graph.sampleRate,
      "floor",
    );
    this.#expectedSample = startSample;
    this.#sessionId = session.schedulerSessionId;
    await this.#backend.begin({
      graph: this.#graph,
      schedulerSessionId: session.schedulerSessionId,
      startSample,
      signal: session.signal,
    });
  }

  auditionScrub(input: {
    readonly schedulerSessionId: string;
    readonly frame: string;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ auditioned: boolean; grainDurationMs: number }>> {
    if (this.#backend.auditionScrub === undefined) {
      return Promise.resolve({ auditioned: false, grainDurationMs: 0 });
    }
    const sample = sampleBoundaryForFrame(
      BigInt(input.frame),
      this.#timelineFps,
      this.#graph.sampleRate,
      "floor",
    );
    this.#expectedSample = sample;
    this.#sessionId = input.schedulerSessionId;
    return this.#backend.auditionScrub({
      graph: this.#graph,
      schedulerSessionId: input.schedulerSessionId,
      sample,
      signal: input.signal,
    });
  }

  async report(schedulerSessionId: string) {
    if (this.#sessionId !== schedulerSessionId) {
      throw new Error("Audio preview backend reported a stale scheduler session.");
    }
    const observed = await this.#backend.observedSample(schedulerSessionId);
    return {
      observedSample: observed.toString(10),
      expectedSample: this.#expectedSample.toString(10),
      baseLatencyMs: this.#baseLatencyMs,
      outputLatencyMs: this.#outputLatencyMs,
    } as const;
  }

  reportBufferHealth() {
    return (
      this.#backend.health?.() ?? {
        droppedBufferCount: 0,
        bufferedSampleRanges: [],
      }
    );
  }

  suspend(): Promise<void> {
    return this.#backend.suspend();
  }

  dispose(): Promise<void> {
    return this.#backend.dispose();
  }
}
