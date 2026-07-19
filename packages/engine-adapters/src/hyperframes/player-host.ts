import { createHash } from "node:crypto";
import type { HyperframesWorkerPolicy } from "./contracts.js";
import { pinnedHyperframesVersion } from "./contracts.js";

interface PlayerRational {
  readonly numerator: string;
  readonly denominator: string;
}

export interface HyperframesPlayerHandle {
  preload(
    range: Readonly<{ startFrame: string; endFrameExclusive: string }>,
    signal: AbortSignal,
  ): Promise<void>;
  pause(): Promise<void>;
  seekToFrame(frame: number, fps: number): Promise<void>;
  waitUntilReady(frame: number, signal: AbortSignal): Promise<void>;
  play(input: { readonly playbackRate: number; readonly muted: true }): Promise<void>;
  currentFrame(fps: number): Promise<number>;
  droppedFrames(): Promise<number>;
  suspend(): Promise<void>;
  destroy(): Promise<void>;
}

export interface HyperframesPlayerFactory {
  create(input: {
    readonly projectRoot: string;
    readonly entryFile: string;
    readonly compositionId: string;
    readonly variables: Readonly<Record<string, unknown>>;
    readonly policy: HyperframesWorkerPolicy;
    readonly nativeAudioSuppressed: true;
    readonly autoplay: false;
  }): Promise<HyperframesPlayerHandle>;
}

export interface HyperframesPlayerHostOptions {
  readonly adapterId: string;
  readonly layerId: string;
  readonly projectRoot: string;
  readonly entryFile: string;
  readonly compositionId: string;
  readonly variables: Readonly<Record<string, unknown>>;
  readonly fps: PlayerRational;
  readonly policy: HyperframesWorkerPolicy;
  readonly factory: HyperframesPlayerFactory;
}

export class HyperframesPlayerHost {
  readonly adapterId: string;
  readonly layerId: string;
  readonly kind = "hyperframes" as const;
  readonly version = pinnedHyperframesVersion;
  readonly #options: HyperframesPlayerHostOptions;
  readonly #fps: number;
  readonly #artifactPrefix: string;
  #handle: HyperframesPlayerHandle | null = null;
  #schedulerSessionId = "hyperframes-not-started";
  #disposed = false;

  constructor(options: HyperframesPlayerHostOptions) {
    this.adapterId = assertIdentifier(options.adapterId, "adapterId");
    this.layerId = assertIdentifier(options.layerId, "layerId");
    assertIdentifier(options.compositionId, "compositionId");
    this.#fps = rationalNumber(options.fps, "fps");
    this.#options = options;
    this.#artifactPrefix = createHash("sha256")
      .update(
        JSON.stringify({
          version: pinnedHyperframesVersion,
          projectRoot: options.projectRoot,
          entryFile: options.entryFile,
          compositionId: options.compositionId,
          variables: options.variables,
          fps: options.fps,
          cacheNamespace: options.policy.cacheNamespace,
        }),
      )
      .digest("hex");
  }

  async preload(
    range: Readonly<{ startFrame: string; endFrameExclusive: string }>,
    signal: AbortSignal,
  ): Promise<
    Readonly<{
      adapterId: string;
      layerId: string;
      range: Readonly<{ startFrame: string; endFrameExclusive: string }>;
      freshness: "fresh";
      waitingFor: "none";
    }>
  > {
    const handle = await this.#requireHandle();
    throwIfAborted(signal);
    await handle.preload(range, signal);
    throwIfAborted(signal);
    return {
      adapterId: this.adapterId,
      layerId: this.layerId,
      range,
      freshness: "fresh",
      waitingFor: "none",
    };
  }

  async halt(schedulerSessionId: string): Promise<void> {
    this.#assertUsable();
    this.#schedulerSessionId = schedulerSessionId;
    await this.#handle?.pause();
  }

  async presentFrame(request: {
    readonly schedulerSessionId: string;
    readonly frame: string;
    readonly presentationTimestamp: PlayerRational;
    readonly truthMode: "interactive-approximation" | "rendered-fidelity";
    readonly signal: AbortSignal;
  }): Promise<
    Readonly<{
      adapterId: string;
      layerId: string;
      frame: string;
      ready: true;
      artifactIdentity: string;
      usedProxy: boolean;
      usedBakedFallback: false;
      warnings: readonly [];
    }>
  > {
    const handle = await this.#requireHandle();
    const frame = safeFrame(request.frame);
    this.#schedulerSessionId = request.schedulerSessionId;
    await handle.pause();
    throwIfAborted(request.signal);
    await handle.seekToFrame(frame, this.#fps);
    await handle.waitUntilReady(frame, request.signal);
    throwIfAborted(request.signal);
    if ((await handle.currentFrame(this.#fps)) !== frame) {
      throw new Error(`HyperFrames Player reported a different frame after seek to ${request.frame}.`);
    }
    if (request.schedulerSessionId !== this.#schedulerSessionId) {
      throw new DOMException("HyperFrames readiness belongs to a stale scheduler session.", "AbortError");
    }
    return {
      adapterId: this.adapterId,
      layerId: this.layerId,
      frame: request.frame,
      ready: true,
      artifactIdentity: `${this.#artifactPrefix}:${request.frame}`,
      usedProxy: request.truthMode === "interactive-approximation",
      usedBakedFallback: false,
      warnings: [],
    };
  }

  async beginSynchronizedPlayback(session: {
    readonly schedulerSessionId: string;
    readonly startFrame: string;
    readonly playRate: PlayerRational;
    readonly nativeAudioSuppressed: true;
    readonly signal: AbortSignal;
  }): Promise<void> {
    const handle = await this.#requireHandle();
    throwIfAborted(session.signal);
    this.#schedulerSessionId = session.schedulerSessionId;
    const frame = safeFrame(session.startFrame);
    await handle.pause();
    await handle.seekToFrame(frame, this.#fps);
    await handle.waitUntilReady(frame, session.signal);
    await handle.play({ playbackRate: rationalNumber(session.playRate, "playRate"), muted: true });
  }

  async reportPlaybackState(schedulerSessionId: string): Promise<
    Readonly<{
      adapterId: string;
      schedulerSessionId: string;
      observedFrame: string;
      droppedFrames: number;
      reportedAtMonotonicMs: number;
    }>
  > {
    const handle = await this.#requireHandle();
    if (schedulerSessionId !== this.#schedulerSessionId)
      throw new Error("HyperFrames report requested for a stale scheduler session.");
    const frame = await handle.currentFrame(this.#fps);
    const droppedFrames = await handle.droppedFrames();
    if (
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      !Number.isSafeInteger(droppedFrames) ||
      droppedFrames < 0
    ) {
      throw new Error("HyperFrames Player returned invalid playback diagnostics.");
    }
    return {
      adapterId: this.adapterId,
      schedulerSessionId,
      observedFrame: frame.toString(10),
      droppedFrames,
      reportedAtMonotonicMs: performance.now(),
    };
  }

  async suspend(): Promise<void> {
    this.#assertUsable();
    await this.#handle?.suspend();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const handle = this.#handle;
    this.#handle = null;
    await handle?.destroy();
  }

  async #requireHandle(): Promise<HyperframesPlayerHandle> {
    this.#assertUsable();
    this.#handle ??= await this.#options.factory.create({
      projectRoot: this.#options.projectRoot,
      entryFile: this.#options.entryFile,
      compositionId: this.#options.compositionId,
      variables: structuredClone(this.#options.variables),
      policy: this.#options.policy,
      nativeAudioSuppressed: true,
      autoplay: false,
    });
    return this.#handle;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("HyperFrames Player host is disposed.");
  }
}

const safeFrame = (value: string): number => {
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(value)) throw new Error("HyperFrames frame is invalid.");
  const frame = Number(value);
  if (!Number.isSafeInteger(frame)) throw new Error("HyperFrames frame exceeds safe integer limits.");
  return frame;
};

const rationalNumber = (value: PlayerRational, field: string): number => {
  if (!/^-?(?:0|[1-9][0-9]*)$/.test(value.numerator) || !/^[1-9][0-9]*$/.test(value.denominator)) {
    throw new Error(`HyperFrames ${field} rational is invalid.`);
  }
  const number = Number(value.numerator) / Number(value.denominator);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`HyperFrames ${field} must be positive.`);
  return number;
};

const assertIdentifier = (value: string, field: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error(`HyperFrames ${field} is invalid.`);
  return value;
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException("HyperFrames Player operation was cancelled.", "AbortError");
};
