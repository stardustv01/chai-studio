export class MasterScheduler {
  #adapters;
  #session = 0;
  #frame = 0n;
  #state = "paused";
  #loop = null;

  constructor(adapters) {
    if (!Array.isArray(adapters) || adapters.length === 0) throw new TypeError("at least one adapter is required");
    this.#adapters = [...adapters];
  }

  get masterFrame() {
    return this.#frame;
  }

  get state() {
    return this.#state;
  }

  async seek(frame) {
    if (typeof frame !== "bigint" || frame < 0n) throw new RangeError("frame must be a non-negative bigint");
    const sessionId = `seek-${++this.#session}`;
    await Promise.all(this.#adapters.map((adapter) => adapter.halt?.(sessionId)));
    const presented = await Promise.all(this.#adapters.map((adapter) => adapter.presentFrame({ frame, sessionId })));
    for (const result of presented) {
      if (result.frame !== frame) throw new Error(`${result.adapterId} presented ${result.frame} instead of ${frame}`);
      if (result.ready !== true) throw new Error(`${result.adapterId} was not ready`);
    }
    this.#frame = frame;
    return Object.freeze({ sessionId, frame, layers: presented });
  }

  async play() {
    const sessionId = `play-${++this.#session}`;
    await Promise.all(this.#adapters.map((adapter) => adapter.play?.({ frame: this.#frame, sessionId })));
    this.#state = "playing";
    return Object.freeze({ sessionId, frame: this.#frame, state: this.#state });
  }

  async pause() {
    const sessionId = `pause-${++this.#session}`;
    await Promise.all(this.#adapters.map((adapter) => adapter.halt?.(sessionId)));
    this.#state = "paused";
    return Object.freeze({ sessionId, frame: this.#frame, state: this.#state });
  }

  async step(delta) {
    if (typeof delta !== "bigint" || delta === 0n) throw new TypeError("step delta must be a non-zero bigint");
    const target = this.#frame + delta;
    return this.seek(target < 0n ? 0n : target);
  }

  setLoop(startFrame, endFrameExclusive) {
    if (typeof startFrame !== "bigint" || typeof endFrameExclusive !== "bigint" || startFrame < 0n || endFrameExclusive <= startFrame) {
      throw new RangeError("loop must be a non-empty half-open bigint range");
    }
    this.#loop = Object.freeze({ startFrame, endFrameExclusive });
    return this.#loop;
  }

  clearLoop() {
    this.#loop = null;
  }

  async advance(frameCount = 1n) {
    if (this.#state !== "playing") return Object.freeze({ frame: this.#frame, advanced: false });
    if (typeof frameCount !== "bigint" || frameCount < 0n) throw new RangeError("frameCount must be a non-negative bigint");
    let target = this.#frame + frameCount;
    if (this.#loop && target >= this.#loop.endFrameExclusive) {
      const length = this.#loop.endFrameExclusive - this.#loop.startFrame;
      target = this.#loop.startFrame + ((target - this.#loop.startFrame) % length);
    }
    return this.seek(target);
  }

  driftReport(observations) {
    return observations.map(({ adapterId, frame }) => {
      const observedFrame = BigInt(frame);
      const deltaFrames = observedFrame - this.#frame;
      return Object.freeze({ adapterId, expectedFrame: this.#frame, observedFrame, deltaFrames, hardResyncRequired: deltaFrames !== 0n });
    });
  }

  async hardResynchronize(observations) {
    const report = this.driftReport(observations);
    if (!report.some((item) => item.hardResyncRequired)) return Object.freeze({ resynchronized: false, report });
    const presentation = await this.seek(this.#frame);
    return Object.freeze({ resynchronized: true, report, presentation });
  }
}

export class DeterministicFixtureAdapter {
  constructor(adapterId, fingerprint) {
    this.adapterId = adapterId;
    this.fingerprint = fingerprint;
  }

  async halt() {}

  async play() {}

  async presentFrame({ frame }) {
    return Object.freeze({
      adapterId: this.adapterId,
      frame,
      ready: true,
      artifactIdentity: `${this.fingerprint}:${frame}`,
    });
  }
}
