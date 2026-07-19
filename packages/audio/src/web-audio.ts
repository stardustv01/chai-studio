import type {
  AudioAutomationLane,
  AudioGraphClip,
  AudioGraphDocument,
  NormalizedRational,
} from "@chai-studio/schema";
import {
  decibelsToLinear,
  clipEnvelopeGainAtFrame,
  evaluateAudioGraphAtFrame,
  evaluateAutomationLane,
} from "./evaluation.js";
import type { AudioPreviewBackend } from "./preview-follower.js";
import { sampleBoundaryForFrame } from "./sample-mapping.js";

export type AudioBufferProvider = (input: {
  readonly clipId: string;
  readonly signal: AbortSignal;
}) => Promise<AudioBuffer>;

export const audioScrubGrainDurationMs = 48;

export class WebAudioGraphBackend implements AudioPreviewBackend {
  readonly nativeEngineAudioSuppressed = true;
  readonly #timelineFps: NormalizedRational;
  readonly #bufferProvider: AudioBufferProvider;
  readonly #contextFactory: (sampleRate: number) => AudioContext;
  readonly #buffers = new Map<string, AudioBuffer>();
  readonly #activeSources = new Set<AudioBufferSourceNode>();
  #context: AudioContext | null = null;
  #sessionId: string | null = null;
  #startedAt = 0;
  #startSample = 0n;
  #droppedBufferCount = 0;

  constructor(input: {
    readonly timelineFps: NormalizedRational;
    readonly bufferProvider: AudioBufferProvider;
    readonly contextFactory?: (sampleRate: number) => AudioContext;
  }) {
    this.#timelineFps = input.timelineFps;
    this.#bufferProvider = input.bufferProvider;
    this.#contextFactory =
      input.contextFactory ?? ((sampleRate) => new AudioContext({ latencyHint: "interactive", sampleRate }));
  }

  async prepare(input: {
    readonly graph: AudioGraphDocument;
    readonly sample: bigint;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ baseLatencyMs: number; outputLatencyMs: number }>> {
    const context = this.#requireContext(input.graph.sampleRate);
    const relevant = input.graph.clips.filter((clip) => {
      const end = sampleBoundaryForFrame(
        BigInt(clip.endFrameExclusive),
        this.#timelineFps,
        input.graph.sampleRate,
        "ceil",
      );
      return end > input.sample;
    });
    await Promise.all(
      relevant.map(async (clip) => {
        if (this.#buffers.has(clip.id)) return;
        const buffer = await this.#bufferProvider({ clipId: clip.id, signal: input.signal });
        if (buffer.sampleRate !== input.graph.sampleRate) {
          throw new Error(
            `Web Audio buffer ${clip.id} is ${buffer.sampleRate.toString()} Hz; expected ${input.graph.sampleRate.toString()} Hz.`,
          );
        }
        const channelMap = input.graph.channelMaps.find((item) => item.id === clip.channelMapId);
        if (channelMap === undefined) {
          throw new Error(`Web Audio buffer ${clip.id} requires a valid explicit channel map.`);
        }
        if (buffer.numberOfChannels !== channelMap.inputChannels) {
          throw new Error(
            `Web Audio buffer ${clip.id} has ${buffer.numberOfChannels.toString()} channels; its explicit channel map requires ${channelMap.inputChannels.toString()}.`,
          );
        }
        this.#buffers.set(clip.id, buffer);
      }),
    );
    return {
      baseLatencyMs: context.baseLatency * 1_000,
      outputLatencyMs: context.outputLatency * 1_000,
    };
  }

  async begin(input: {
    readonly graph: AudioGraphDocument;
    readonly schedulerSessionId: string;
    readonly startSample: bigint;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const context = this.#requireContext(input.graph.sampleRate);
    if (context.state === "suspended") await context.resume();
    await this.halt(input.schedulerSessionId);
    const now = context.currentTime + Math.max(context.baseLatency, 0.005);
    const busNodes = createBusNodes({
      graph: input.graph,
      context,
      contextStartAt: now,
      playbackStartSample: input.startSample,
      fps: this.#timelineFps,
    });
    for (const clip of input.graph.clips) {
      const buffer = this.#buffers.get(clip.id);
      if (buffer === undefined) {
        this.#droppedBufferCount += 1;
        continue;
      }
      if (clip.muted) continue;
      const clipStartSample = sampleBoundaryForFrame(
        BigInt(clip.startFrame),
        this.#timelineFps,
        input.graph.sampleRate,
        "floor",
      );
      const clipEndSample = sampleBoundaryForFrame(
        BigInt(clip.endFrameExclusive),
        this.#timelineFps,
        input.graph.sampleRate,
        "ceil",
      );
      if (clipEndSample <= input.startSample) continue;
      const source = context.createBufferSource();
      const gain = context.createGain();
      const envelope = context.createGain();
      const pan = context.createStereoPanner();
      const channelMap = input.graph.channelMaps.find((item) => item.id === clip.channelMapId);
      if (channelMap === undefined) {
        this.#droppedBufferCount += 1;
        continue;
      }
      source.buffer = buffer;
      gain.gain.value = decibelsToLinear(clip.gainDb);
      pan.pan.value = clip.pan;
      connectExplicitChannelMap(source, context, channelMap)
        .connect(gain)
        .connect(envelope)
        .connect(pan)
        .connect(busNodes.get(clip.busId) ?? context.destination);
      const delaySamples = clipStartSample > input.startSample ? clipStartSample - input.startSample : 0n;
      const skippedSamples = input.startSample > clipStartSample ? input.startSample - clipStartSample : 0n;
      const when = now + Number(delaySamples) / input.graph.sampleRate;
      const offset = Number(BigInt(clip.sourceStartSample) + skippedSamples) / input.graph.sampleRate;
      const activeStartSample = clipStartSample + skippedSamples;
      const sourceSamplesRemaining =
        BigInt(clip.sourceEndSampleExclusive) - BigInt(clip.sourceStartSample) - skippedSamples;
      const timelineSamplesRemaining = clipEndSample - activeStartSample;
      const durationSamples = minimumBigInt(sourceSamplesRemaining, timelineSamplesRemaining);
      if (durationSamples <= 0n) continue;
      scheduleClipAutomation({
        graph: input.graph,
        clipId: clip.id,
        gain: gain.gain,
        pan: pan.pan,
        contextStartAt: now,
        clipStartAt: when,
        playbackStartSample: input.startSample,
        activeStartSample,
        activeEndSampleExclusive: activeStartSample + durationSamples,
        fps: this.#timelineFps,
      });
      scheduleClipEnvelope({
        graph: input.graph,
        clip,
        parameter: envelope.gain,
        contextStartAt: now,
        clipStartAt: when,
        playbackStartSample: input.startSample,
        activeStartSample,
        activeEndSampleExclusive: activeStartSample + durationSamples,
        fps: this.#timelineFps,
      });
      source.start(when, offset, Number(durationSamples) / input.graph.sampleRate);
      source.addEventListener("ended", () => this.#activeSources.delete(source), { once: true });
      this.#activeSources.add(source);
    }
    this.#sessionId = input.schedulerSessionId;
    this.#startedAt = now;
    this.#startSample = input.startSample;
  }

  async auditionScrub(input: {
    readonly graph: AudioGraphDocument;
    readonly schedulerSessionId: string;
    readonly sample: bigint;
    readonly signal: AbortSignal;
  }): Promise<Readonly<{ auditioned: boolean; grainDurationMs: number }>> {
    if (input.signal.aborted) throw new DOMException("Audio scrub cancelled.", "AbortError");
    const context = this.#requireContext(input.graph.sampleRate);
    if (context.state === "suspended") await context.resume();
    await this.halt(input.schedulerSessionId);
    const frame = frameForSample(input.sample, this.#timelineFps, input.graph.sampleRate);
    const evaluated = evaluateAudioGraphAtFrame(input.graph, frame);
    const now = context.currentTime + Math.max(context.baseLatency, 0.005);
    const requestedSamples = BigInt(
      Math.max(1, Math.round((input.graph.sampleRate * audioScrubGrainDurationMs) / 1_000)),
    );
    let longestGrainSamples = 0n;
    let auditioned = false;
    for (const clipState of evaluated.clips) {
      if (!clipState.audible) continue;
      const clip = input.graph.clips.find((item) => item.id === clipState.clipId);
      const buffer = this.#buffers.get(clipState.clipId);
      if (clip === undefined || buffer === undefined) {
        this.#droppedBufferCount += 1;
        continue;
      }
      const channelMap = input.graph.channelMaps.find((item) => item.id === clip.channelMapId);
      if (channelMap === undefined) {
        this.#droppedBufferCount += 1;
        continue;
      }
      const clipStartSample = sampleBoundaryForFrame(
        BigInt(clip.startFrame),
        this.#timelineFps,
        input.graph.sampleRate,
        "floor",
      );
      const clipEndSample = sampleBoundaryForFrame(
        BigInt(clip.endFrameExclusive),
        this.#timelineFps,
        input.graph.sampleRate,
        "ceil",
      );
      const skippedSamples = input.sample - clipStartSample;
      const sourceSamplesRemaining =
        BigInt(clip.sourceEndSampleExclusive) - BigInt(clip.sourceStartSample) - skippedSamples;
      const timelineSamplesRemaining = clipEndSample - input.sample;
      const grainSamples = minimumBigInt(
        requestedSamples,
        minimumBigInt(sourceSamplesRemaining, timelineSamplesRemaining),
      );
      if (grainSamples <= 0n) continue;
      const source = context.createBufferSource();
      const envelope = context.createGain();
      const pan = context.createStereoPanner();
      source.buffer = buffer;
      pan.pan.value = clipState.pan;
      connectExplicitChannelMap(source, context, channelMap)
        .connect(envelope)
        .connect(pan)
        .connect(context.destination);
      const durationSeconds = Number(grainSamples) / input.graph.sampleRate;
      const rampSeconds = Math.min(0.006, durationSeconds / 2);
      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(clipState.linearGain, now + rampSeconds);
      envelope.gain.setValueAtTime(
        clipState.linearGain,
        now + Math.max(rampSeconds, durationSeconds - rampSeconds),
      );
      envelope.gain.linearRampToValueAtTime(0, now + durationSeconds);
      const offset = Number(BigInt(clip.sourceStartSample) + skippedSamples) / input.graph.sampleRate;
      source.start(now, offset, durationSeconds);
      source.addEventListener("ended", () => this.#activeSources.delete(source), { once: true });
      this.#activeSources.add(source);
      auditioned = true;
      if (grainSamples > longestGrainSamples) longestGrainSamples = grainSamples;
    }
    this.#sessionId = input.schedulerSessionId;
    this.#startedAt = now;
    this.#startSample = input.sample;
    return {
      auditioned,
      grainDurationMs: auditioned ? (Number(longestGrainSamples) * 1_000) / input.graph.sampleRate : 0,
    };
  }

  halt(schedulerSessionId: string): Promise<void> {
    for (const source of this.#activeSources) {
      try {
        source.stop();
      } catch {
        // An already-ended source is equivalent to halted.
      }
      source.disconnect();
    }
    this.#activeSources.clear();
    this.#sessionId = schedulerSessionId;
    return Promise.resolve();
  }

  observedSample(schedulerSessionId: string): Promise<bigint> {
    if (schedulerSessionId !== this.#sessionId) {
      return Promise.reject(new Error("Web Audio reported a stale scheduler session."));
    }
    const context = this.#requireContext();
    const elapsed = Math.max(0, context.currentTime - this.#startedAt);
    return Promise.resolve(this.#startSample + BigInt(Math.floor(elapsed * context.sampleRate)));
  }

  health() {
    return {
      droppedBufferCount: this.#droppedBufferCount,
      bufferedSampleRanges: [...this.#buffers.values()].map((buffer) => ({
        startSample: "0",
        endSampleExclusive: Math.floor(buffer.duration * buffer.sampleRate).toString(10),
      })),
    } as const;
  }

  async suspend(): Promise<void> {
    await this.#context?.suspend();
  }

  async dispose(): Promise<void> {
    await this.halt(this.#sessionId ?? "disposed");
    await this.#context?.close();
    this.#context = null;
    this.#buffers.clear();
  }

  #requireContext(sampleRate?: number): AudioContext {
    if (this.#context === null) {
      if (sampleRate === undefined) throw new Error("Web Audio context has not been prepared.");
      this.#context = this.#contextFactory(sampleRate);
    }
    if (sampleRate !== undefined && this.#context.sampleRate !== sampleRate) {
      throw new Error(
        `Web Audio context is ${this.#context.sampleRate.toString()} Hz; expected ${sampleRate.toString()} Hz.`,
      );
    }
    return this.#context;
  }
}

const createBusNodes = (input: {
  readonly graph: AudioGraphDocument;
  readonly context: AudioContext;
  readonly contextStartAt: number;
  readonly playbackStartSample: bigint;
  readonly fps: NormalizedRational;
}): ReadonlyMap<string, GainNode> => {
  const nodes = new Map(input.graph.buses.map((bus) => [bus.id, input.context.createGain()]));
  const pans = new Map(input.graph.buses.map((bus) => [bus.id, input.context.createStereoPanner()]));
  const playbackStartFrame = frameForSample(input.playbackStartSample, input.fps, input.graph.sampleRate);
  const evaluatedBuses = new Map(
    evaluateAudioGraphAtFrame(input.graph, playbackStartFrame).buses.map((bus) => [bus.busId, bus]),
  );
  for (const bus of input.graph.buses) {
    const node = nodes.get(bus.id);
    const pan = pans.get(bus.id);
    if (node === undefined || pan === undefined) {
      throw new Error(`Web Audio bus node allocation failed for ${bus.id}.`);
    }
    const audible = evaluatedBuses.get(bus.id)?.audible === true;
    node.gain.value = audible ? decibelsToLinear(bus.gainDb) : 0;
    pan.pan.value = bus.pan;
    if (audible) {
      for (const laneId of bus.automationLaneIds) {
        const lane = input.graph.automationLanes.find((item) => item.id === laneId);
        if (lane === undefined) continue;
        scheduleAutomationLane({
          lane,
          parameter: lane.property === "gainDb" ? node.gain : pan.pan,
          fallback: lane.property === "gainDb" ? bus.gainDb : bus.pan,
          contextStartAt: input.contextStartAt,
          initialAt: input.contextStartAt,
          playbackStartSample: input.playbackStartSample,
          activeStartSample: input.playbackStartSample,
          activeEndSampleExclusive: null,
          fps: input.fps,
          sampleRate: input.graph.sampleRate,
          initialFrame: playbackStartFrame,
        });
      }
    }
    node.connect(pan);
    if (bus.parentBusId === null) pan.connect(input.context.destination);
    else pan.connect(nodes.get(bus.parentBusId) ?? input.context.destination);
  }
  return nodes;
};

const connectExplicitChannelMap = (
  source: AudioBufferSourceNode,
  context: AudioContext,
  channelMap: AudioGraphDocument["channelMaps"][number],
): AudioNode => {
  const splitter = context.createChannelSplitter(channelMap.inputChannels);
  const merger = context.createChannelMerger(channelMap.outputChannels);
  source.connect(splitter);
  for (const [outputIndex, row] of channelMap.matrix.entries()) {
    for (const [inputIndex, coefficient] of row.entries()) {
      if (coefficient === 0) continue;
      const coefficientGain = context.createGain();
      coefficientGain.gain.value = coefficient;
      splitter.connect(coefficientGain, inputIndex);
      coefficientGain.connect(merger, 0, outputIndex);
    }
  }
  return merger;
};

const scheduleClipAutomation = (input: {
  readonly graph: AudioGraphDocument;
  readonly clipId: string;
  readonly gain: AudioParam;
  readonly pan: AudioParam;
  readonly contextStartAt: number;
  readonly clipStartAt: number;
  readonly playbackStartSample: bigint;
  readonly activeStartSample: bigint;
  readonly activeEndSampleExclusive: bigint;
  readonly fps: NormalizedRational;
}): void => {
  const clip = input.graph.clips.find((item) => item.id === input.clipId);
  if (clip === undefined) return;
  const lanes = input.graph.automationLanes.filter(
    (lane) => lane.targetKind === "clip" && lane.targetId === input.clipId,
  );
  for (const lane of lanes) {
    const activeStartFrame = frameForSample(input.activeStartSample, input.fps, input.graph.sampleRate);
    scheduleAutomationLane({
      lane,
      parameter: lane.property === "gainDb" ? input.gain : input.pan,
      fallback: lane.property === "gainDb" ? clip.gainDb : clip.pan,
      contextStartAt: input.contextStartAt,
      initialAt: input.clipStartAt,
      playbackStartSample: input.playbackStartSample,
      activeStartSample: input.activeStartSample,
      activeEndSampleExclusive: input.activeEndSampleExclusive,
      fps: input.fps,
      sampleRate: input.graph.sampleRate,
      initialFrame: activeStartFrame,
    });
  }
};

const scheduleClipEnvelope = (input: {
  readonly graph: AudioGraphDocument;
  readonly clip: AudioGraphClip;
  readonly parameter: AudioParam;
  readonly contextStartAt: number;
  readonly clipStartAt: number;
  readonly playbackStartSample: bigint;
  readonly activeStartSample: bigint;
  readonly activeEndSampleExclusive: bigint;
  readonly fps: NormalizedRational;
}): void => {
  const activeStartFrame = frameForSample(input.activeStartSample, input.fps, input.graph.sampleRate);
  const activeEndFrameExclusive =
    frameForSample(input.activeEndSampleExclusive - 1n, input.fps, input.graph.sampleRate) + 1n;
  input.parameter.setValueAtTime(
    clipEnvelopeGainAtFrame(input.graph, input.clip, activeStartFrame),
    input.clipStartAt,
  );
  for (const range of envelopeFrameRanges(input.graph, input.clip)) {
    const start = maximumBigInt(range.start, activeStartFrame);
    const end = minimumBigInt(range.end, activeEndFrameExclusive);
    if (end <= start) continue;
    const durationFrames = end - start;
    const pointCount = Number(durationFrames < 2_047n ? durationFrames + 1n : 2_048n);
    const values = Float32Array.from({ length: pointCount }, (_, index) => {
      const frame = start + (durationFrames * BigInt(index)) / BigInt(pointCount - 1);
      return clipEnvelopeGainAtFrame(input.graph, input.clip, frame);
    });
    const rangeStartSample = sampleBoundaryForFrame(start, input.fps, input.graph.sampleRate, "floor");
    const startAt =
      input.contextStartAt + Number(rangeStartSample - input.playbackStartSample) / input.graph.sampleRate;
    const durationSeconds =
      (Number(durationFrames) * Number(BigInt(input.fps.denominator))) / Number(BigInt(input.fps.numerator));
    input.parameter.setValueCurveAtTime(values, startAt, durationSeconds);
  }
};

const envelopeFrameRanges = (
  graph: AudioGraphDocument,
  clip: AudioGraphClip,
): readonly Readonly<{ start: bigint; end: bigint }>[] => {
  const clipStart = BigInt(clip.startFrame);
  const clipEnd = BigInt(clip.endFrameExclusive);
  const ranges: { start: bigint; end: bigint }[] = [];
  const fadeIn = BigInt(clip.fadeInFrames);
  const fadeOut = BigInt(clip.fadeOutFrames);
  if (fadeIn > 0n) ranges.push({ start: clipStart, end: minimumBigInt(clipStart + fadeIn, clipEnd) });
  if (fadeOut > 0n) ranges.push({ start: maximumBigInt(clipStart, clipEnd - fadeOut), end: clipEnd });
  for (const crossfade of graph.crossfades) {
    if (crossfade.fromClipId === clip.id || crossfade.toClipId === clip.id) {
      ranges.push({ start: BigInt(crossfade.startFrame), end: BigInt(crossfade.endFrameExclusive) });
    }
  }
  ranges.sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));
  const merged: { start: bigint; end: bigint }[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous === undefined || range.start > previous.end) merged.push({ ...range });
    else previous.end = maximumBigInt(previous.end, range.end);
  }
  return merged;
};

const scheduleAutomationLane = (input: {
  readonly lane: AudioAutomationLane;
  readonly parameter: AudioParam;
  readonly fallback: number;
  readonly contextStartAt: number;
  readonly initialAt: number;
  readonly playbackStartSample: bigint;
  readonly activeStartSample: bigint;
  readonly activeEndSampleExclusive: bigint | null;
  readonly fps: NormalizedRational;
  readonly sampleRate: number;
  readonly initialFrame: bigint;
}): void => {
  const transform = (value: number) => (input.lane.property === "gainDb" ? decibelsToLinear(value) : value);
  input.parameter.setValueAtTime(
    transform(evaluateAutomationLane(input.lane, input.initialFrame, input.fallback)),
    input.initialAt,
  );
  const keyframes = [...input.lane.keyframes].sort((left, right) => {
    const a = BigInt(left.frame);
    const b = BigInt(right.frame);
    return a < b ? -1 : a > b ? 1 : left.id.localeCompare(right.id, "en");
  });
  for (const [index, keyframe] of keyframes.entries()) {
    const keySample = sampleBoundaryForFrame(BigInt(keyframe.frame), input.fps, input.sampleRate, "floor");
    if (
      keySample <= input.activeStartSample ||
      (input.activeEndSampleExclusive !== null && keySample >= input.activeEndSampleExclusive)
    )
      continue;
    const seconds = Number(keySample - input.playbackStartSample) / input.sampleRate;
    const value = transform(keyframe.value);
    const previous = keyframes[index - 1];
    if (previous === undefined || previous.interpolation === "hold") {
      input.parameter.setValueAtTime(value, input.contextStartAt + seconds);
    } else if (previous.interpolation === "linear") {
      input.parameter.linearRampToValueAtTime(value, input.contextStartAt + seconds);
    } else {
      const curveStartFrame = maximumBigInt(BigInt(previous.frame), input.initialFrame);
      const curveEndFrame = BigInt(keyframe.frame);
      if (curveEndFrame <= curveStartFrame) {
        input.parameter.setValueAtTime(value, input.contextStartAt + seconds);
        continue;
      }
      const curveFrames = curveEndFrame - curveStartFrame;
      const pointCount = Number(curveFrames < 511n ? curveFrames + 1n : 512n);
      const values = Float32Array.from({ length: pointCount }, (_, pointIndex) => {
        const frame = curveStartFrame + (curveFrames * BigInt(pointIndex)) / BigInt(pointCount - 1);
        return transform(evaluateAutomationLane(input.lane, frame, input.fallback));
      });
      const curveStartSample = sampleBoundaryForFrame(curveStartFrame, input.fps, input.sampleRate, "floor");
      const curveStartAt =
        input.contextStartAt + Number(curveStartSample - input.playbackStartSample) / input.sampleRate;
      const curveDurationSeconds =
        (Number(curveFrames) * Number(BigInt(input.fps.denominator))) / Number(BigInt(input.fps.numerator));
      input.parameter.setValueCurveAtTime(values, curveStartAt, curveDurationSeconds);
    }
  }
};

const frameForSample = (sample: bigint, fps: NormalizedRational, sampleRate: number): bigint =>
  (sample * BigInt(fps.numerator)) / (BigInt(sampleRate) * BigInt(fps.denominator));

const minimumBigInt = (left: bigint, right: bigint): bigint => (left < right ? left : right);

const maximumBigInt = (left: bigint, right: bigint): bigint => (left > right ? left : right);
