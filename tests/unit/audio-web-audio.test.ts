import { describe, expect, it } from "vitest";
import {
  audioScrubGrainDurationMs,
  sampleBoundaryForFrame,
  WebAudioGraphBackend,
} from "../../packages/audio/src/index.js";
import { audioTestFps, createAudioGraphFixture } from "../fixtures/audio-fixtures.js";

describe("P16 concrete Web Audio follower", () => {
  it("uses the project sample rate, explicit channel maps, bounded playback, and scrub grains", async () => {
    const context = new FakeAudioContext(48_000);
    let requestedContextRate = 0;
    const backend = new WebAudioGraphBackend({
      timelineFps: audioTestFps,
      contextFactory: (sampleRate) => {
        requestedContextRate = sampleRate;
        return context as unknown as AudioContext;
      },
      bufferProvider: () => Promise.resolve(new FakeAudioBuffer(48_000, 2, 12) as unknown as AudioBuffer),
    });
    const graph = createAudioGraphFixture();
    const signal = new AbortController().signal;
    await expect(backend.prepare({ graph, sample: 0n, signal })).resolves.toEqual({
      baseLatencyMs: 4,
      outputLatencyMs: 6,
    });
    expect(requestedContextRate).toBe(48_000);

    await backend.begin({
      graph,
      schedulerSessionId: "audio-web-session-test-0001",
      startSample: 0n,
      signal,
    });
    expect(context.sources.length).toBe(2);
    expect(context.sources[0]?.starts[0]?.duration).toBeCloseTo(10.01, 8);
    expect(context.splitterCount).toBeGreaterThan(0);
    expect(context.mergerCount).toBeGreaterThan(0);
    expect(backend.health()).toMatchObject({ droppedBufferCount: 0 });

    const scrubSample = sampleBoundaryForFrame(135n, audioTestFps, 48_000, "floor");
    const scrub = await backend.auditionScrub({
      graph,
      schedulerSessionId: "audio-web-scrub-test-0001",
      sample: scrubSample,
      signal,
    });
    expect(scrub.auditioned).toBe(true);
    expect(scrub.grainDurationMs).toBeGreaterThan(0);
    expect(scrub.grainDurationMs).toBeLessThanOrEqual(audioScrubGrainDurationMs);
    expect(context.sources.at(-1)?.starts[0]?.duration).toBeLessThanOrEqual(
      audioScrubGrainDurationMs / 1_000,
    );
    await backend.dispose();
    expect(context.closed).toBe(true);
  });

  it("refuses a browser audio context whose actual rate differs from the graph", async () => {
    const context = new FakeAudioContext(44_100);
    const backend = new WebAudioGraphBackend({
      timelineFps: audioTestFps,
      contextFactory: () => context as unknown as AudioContext,
      bufferProvider: () => Promise.resolve(new FakeAudioBuffer(48_000, 2, 1) as unknown as AudioBuffer),
    });
    await expect(
      backend.prepare({
        graph: createAudioGraphFixture(),
        sample: 0n,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow("Web Audio context is 44100 Hz; expected 48000 Hz");
  });
});

class FakeAudioParam {
  value = 0;

  setValueAtTime(value: number) {
    this.value = value;
    return this as unknown as AudioParam;
  }

  linearRampToValueAtTime(value: number) {
    this.value = value;
    return this as unknown as AudioParam;
  }

  setValueCurveAtTime(values: Float32Array) {
    this.value = values.at(-1) ?? this.value;
    return this as unknown as AudioParam;
  }
}

class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];

  connect<T>(destination: T): T {
    if (destination instanceof FakeAudioNode) this.connections.push(destination);
    return destination;
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

class FakeBufferSource extends FakeAudioNode {
  buffer: AudioBuffer | null = null;
  readonly starts: { when: number; offset: number; duration: number }[] = [];

  start(when = 0, offset = 0, duration = 0): void {
    this.starts.push({ when, offset, duration });
  }

  stop(): void {
    // The test double records scheduling, so stopping has no additional state.
  }

  addEventListener(): void {
    // Ended callbacks are unnecessary for this synchronous test double.
  }
}

class FakeGain extends FakeAudioNode {
  readonly gain = new FakeAudioParam();
}

class FakePanner extends FakeAudioNode {
  readonly pan = new FakeAudioParam();
}

class FakeAudioBuffer {
  constructor(
    readonly sampleRate: number,
    readonly numberOfChannels: number,
    readonly duration: number,
  ) {}
}

class FakeAudioContext {
  readonly baseLatency = 0.004;
  readonly outputLatency = 0.006;
  readonly destination = new FakeAudioNode() as unknown as AudioDestinationNode;
  readonly sources: FakeBufferSource[] = [];
  currentTime = 10;
  state: AudioContextState = "running";
  splitterCount = 0;
  mergerCount = 0;
  closed = false;

  constructor(readonly sampleRate: number) {}

  createBufferSource(): AudioBufferSourceNode {
    const source = new FakeBufferSource();
    this.sources.push(source);
    return source as unknown as AudioBufferSourceNode;
  }

  createGain(): GainNode {
    return new FakeGain() as unknown as GainNode;
  }

  createStereoPanner(): StereoPannerNode {
    return new FakePanner() as unknown as StereoPannerNode;
  }

  createChannelSplitter(): ChannelSplitterNode {
    this.splitterCount += 1;
    return new FakeAudioNode() as unknown as ChannelSplitterNode;
  }

  createChannelMerger(): ChannelMergerNode {
    this.mergerCount += 1;
    return new FakeAudioNode() as unknown as ChannelMergerNode;
  }

  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = "suspended";
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    this.state = "closed";
    return Promise.resolve();
  }
}
