import { createHash } from "node:crypto";
import { pinnedRemotionVersion } from "./contracts.js";

interface PlayerRational {
  readonly numerator: string;
  readonly denominator: string;
}

export interface RemotionPlayerHandle {
  preload(
    range: Readonly<{ startFrame: string; endFrameExclusive: string }>,
    signal: AbortSignal,
  ): Promise<void>;
  pause(): Promise<void>;
  seekTo(frame: number): Promise<void>;
  waitUntilReady(frame: number, signal: AbortSignal): Promise<void>;
  play(input: { readonly playbackRate: number; readonly muted: true }): Promise<void>;
  currentFrame(): Promise<number>;
  droppedFrames(): Promise<number>;
  destroy(): Promise<void>;
}

export interface RemotionPlayerFactory {
  create(input: {
    readonly compositionId: string;
    readonly componentPath: string;
    readonly inputProps: Readonly<Record<string, unknown>>;
  }): Promise<RemotionPlayerHandle>;
}

export interface RemotionPlayerHostOptions {
  readonly adapterId: string;
  readonly layerId: string;
  readonly compositionId: string;
  readonly componentPath: string;
  readonly inputProps: Readonly<Record<string, unknown>>;
  readonly factory: RemotionPlayerFactory;
}

export class RemotionPlayerHost {
  readonly adapterId: string;
  readonly layerId: string;
  readonly kind = "remotion" as const;
  readonly version = pinnedRemotionVersion;
  readonly #compositionId: string;
  readonly #componentPath: string;
  readonly #inputProps: Readonly<Record<string, unknown>>;
  readonly #factory: RemotionPlayerFactory;
  readonly #artifactPrefix: string;
  #handle: RemotionPlayerHandle | null = null;
  #activeSchedulerSessionId = "remotion-not-started";
  #disposed = false;

  constructor(options: RemotionPlayerHostOptions) {
    this.adapterId = assertIdentifier(options.adapterId, "adapterId");
    this.layerId = assertIdentifier(options.layerId, "layerId");
    this.#compositionId = assertIdentifier(options.compositionId, "compositionId");
    this.#componentPath = options.componentPath;
    this.#inputProps = structuredClone(options.inputProps);
    this.#factory = options.factory;
    this.#artifactPrefix = createHash("sha256")
      .update(
        JSON.stringify({
          adapter: pinnedRemotionVersion,
          compositionId: this.#compositionId,
          componentPath: this.#componentPath,
          inputProps: this.#inputProps,
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
    this.#activeSchedulerSessionId = schedulerSessionId;
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
    this.#activeSchedulerSessionId = request.schedulerSessionId;
    await handle.pause();
    throwIfAborted(request.signal);
    await handle.seekTo(frame);
    await handle.waitUntilReady(frame, request.signal);
    throwIfAborted(request.signal);
    if ((await handle.currentFrame()) !== frame) {
      throw new Error(`Remotion Player reported a different frame after seek to ${request.frame}.`);
    }
    if (request.schedulerSessionId !== this.#activeSchedulerSessionId) {
      throw new DOMException("Remotion Player readiness belongs to a stale scheduler session.", "AbortError");
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
    this.#activeSchedulerSessionId = session.schedulerSessionId;
    const startFrame = safeFrame(session.startFrame);
    await handle.pause();
    await handle.seekTo(startFrame);
    await handle.waitUntilReady(startFrame, session.signal);
    await handle.play({
      playbackRate: Number(session.playRate.numerator) / Number(session.playRate.denominator),
      muted: true,
    });
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
    if (schedulerSessionId !== this.#activeSchedulerSessionId) {
      throw new Error("Remotion Player report requested for a stale scheduler session.");
    }
    const frame = await handle.currentFrame();
    const droppedFrames = await handle.droppedFrames();
    if (
      !Number.isSafeInteger(frame) ||
      frame < 0 ||
      !Number.isSafeInteger(droppedFrames) ||
      droppedFrames < 0
    ) {
      throw new Error("Remotion Player returned invalid playback diagnostics.");
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
    await this.#handle?.pause();
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const handle = this.#handle;
    this.#handle = null;
    await handle?.destroy();
  }

  async #requireHandle(): Promise<RemotionPlayerHandle> {
    this.#assertUsable();
    this.#handle ??= await this.#factory.create({
      compositionId: this.#compositionId,
      componentPath: this.#componentPath,
      inputProps: this.#inputProps,
    });
    return this.#handle;
  }

  #assertUsable(): void {
    if (this.#disposed) throw new Error("Remotion Player host is disposed.");
  }
}

const assertIdentifier = (value: string, field: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error(`Remotion ${field} is invalid.`);
  return value;
};

const safeFrame = (value: string): number => {
  if (!/^(?:0|[1-9][0-9]{0,15})$/.test(value)) throw new Error("Remotion Player frame is invalid.");
  const frame = Number(value);
  if (!Number.isSafeInteger(frame)) throw new Error("Remotion Player frame exceeds safe integer limits.");
  return frame;
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException("Remotion Player operation was cancelled.", "AbortError");
};
