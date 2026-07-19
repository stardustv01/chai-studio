export interface AudioMeterHistoryPoint {
  readonly frame: bigint;
  readonly busId: string;
  readonly peakDb: number;
  readonly rmsDb: number;
  readonly clippedSamples: number;
}

/** Bounded local preview history. It never becomes render authority. */
export class AudioMeterHistory {
  readonly #maximumPoints: number;
  #points: AudioMeterHistoryPoint[] = [];

  constructor(maximumPoints = 2_000) {
    if (!Number.isSafeInteger(maximumPoints) || maximumPoints < 1) {
      throw new Error("Audio meter history capacity must be a positive safe integer.");
    }
    this.#maximumPoints = maximumPoints;
  }

  append(point: AudioMeterHistoryPoint): void {
    if (!Number.isFinite(point.peakDb) || !Number.isFinite(point.rmsDb)) {
      throw new Error("Audio meter values must be finite.");
    }
    if (!Number.isSafeInteger(point.clippedSamples) || point.clippedSamples < 0) {
      throw new Error("Clipped sample count must be a non-negative safe integer.");
    }
    this.#points.push(point);
    if (this.#points.length > this.#maximumPoints) {
      this.#points.splice(0, this.#points.length - this.#maximumPoints);
    }
  }

  query(input: {
    readonly busId: string;
    readonly startFrame: bigint;
    readonly endFrameExclusive: bigint;
  }): readonly AudioMeterHistoryPoint[] {
    return this.#points.filter(
      (point) =>
        point.busId === input.busId &&
        point.frame >= input.startFrame &&
        point.frame < input.endFrameExclusive,
    );
  }

  clear(): void {
    this.#points = [];
  }
}
