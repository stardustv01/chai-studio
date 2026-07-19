export interface AudioMeasurements {
  readonly schemaVersion: "1.0.0";
  readonly sampleRate: number;
  readonly channels: number;
  readonly sampleCountPerChannel: number;
  readonly durationSamples: bigint;
  readonly integratedLufs: number | null;
  readonly truePeakDbtp: number | null;
  readonly peakDbfs: number | null;
  readonly clippedSampleCount: number;
  readonly silentSampleCount: number;
  readonly silenceRatio: number;
  readonly channelPeaksDbfs: readonly (number | null)[];
}

export const measurePcmAudio = (input: {
  readonly sampleRate: number;
  readonly channels: readonly Float32Array[];
  readonly silenceThresholdDb?: number;
}): AudioMeasurements => {
  if (input.channels.length === 0) throw new Error("Audio measurement requires at least one channel.");
  const length = input.channels[0]?.length ?? 0;
  if (!input.channels.every((channel) => channel.length === length)) {
    throw new Error("Audio measurement channels must have equal sample counts.");
  }
  const silenceThreshold = Math.pow(10, (input.silenceThresholdDb ?? -60) / 20);
  let sumSquares = 0;
  let sampleCount = 0;
  let clippedSampleCount = 0;
  let silentSampleCount = 0;
  let peak = 0;
  let truePeak = 0;
  const channelPeaks = input.channels.map((channel) => {
    let channelPeak = 0;
    for (let index = 0; index < channel.length; index += 1) {
      const sample = channel[index] ?? 0;
      const absolute = Math.abs(sample);
      peak = Math.max(peak, absolute);
      channelPeak = Math.max(channelPeak, absolute);
      sumSquares += sample * sample;
      sampleCount += 1;
      if (absolute >= 1) clippedSampleCount += 1;
      if (absolute <= silenceThreshold) silentSampleCount += 1;
      const next = channel[index + 1] ?? sample;
      for (let phase = 0; phase < 4; phase += 1) {
        truePeak = Math.max(truePeak, Math.abs(sample + (next - sample) * (phase / 4)));
      }
    }
    return linearToDb(channelPeak);
  });
  const meanSquare = sampleCount === 0 ? 0 : sumSquares / sampleCount;
  const integratedLufs = meanSquare === 0 ? null : round(-0.691 + 10 * Math.log10(meanSquare), 2);
  return {
    schemaVersion: "1.0.0",
    sampleRate: input.sampleRate,
    channels: input.channels.length,
    sampleCountPerChannel: length,
    durationSamples: BigInt(length),
    integratedLufs,
    truePeakDbtp: linearToDb(truePeak),
    peakDbfs: linearToDb(peak),
    clippedSampleCount,
    silentSampleCount,
    silenceRatio: sampleCount === 0 ? 1 : silentSampleCount / sampleCount,
    channelPeaksDbfs: channelPeaks,
  };
};

const linearToDb = (value: number): number | null => (value <= 0 ? null : round(20 * Math.log10(value), 3));

const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};
