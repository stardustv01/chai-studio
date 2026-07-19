import type {
  FidelityFrameArtifact,
  FidelityRangeArtifact,
  PreviewAudioFollower,
  PreviewFinalCompositor,
  PreviewFrameRange,
  PreviewLayerAdapter,
  PreviewLayerKind,
  PreviewPlaybackReport,
  PreviewPlaybackSession,
  PreviewPreloadResult,
  PreviewPresentationRequest,
  PreviewPresentedLayer,
} from "../../packages/preview/src/index.js";

export class DeterministicPreviewAdapter implements PreviewLayerAdapter {
  readonly adapterId: string;
  readonly layerId: string;
  readonly kind: PreviewLayerKind;
  readonly version = "fixture-1.0.0";
  readonly calls: string[] = [];
  failFrame: string | null = null;
  observedOffset = 0n;
  observedFrameOverride: string | null = null;
  droppedFrames = 0;
  waitingFor: PreviewPreloadResult["waitingFor"] = "none";
  freshness: PreviewPreloadResult["freshness"] = "fresh";
  #frame = "0";
  #sessionId = "fixture-unstarted";

  constructor(adapterId: string, layerId: string, kind: PreviewLayerKind) {
    this.adapterId = adapterId;
    this.layerId = layerId;
    this.kind = kind;
  }

  preload(range: PreviewFrameRange, signal: AbortSignal): Promise<PreviewPreloadResult> {
    this.calls.push(`preload:${range.startFrame}-${range.endFrameExclusive}`);
    if (signal.aborted) return Promise.reject(new Error("fixture preload aborted"));
    return Promise.resolve({
      adapterId: this.adapterId,
      layerId: this.layerId,
      range,
      freshness: this.freshness,
      waitingFor: this.waitingFor,
    });
  }

  halt(schedulerSessionId: string): Promise<void> {
    this.calls.push(`halt:${schedulerSessionId}`);
    this.#sessionId = schedulerSessionId;
    return Promise.resolve();
  }

  presentFrame(request: PreviewPresentationRequest): Promise<PreviewPresentedLayer> {
    this.calls.push(`present:${request.frame}`);
    if (request.signal.aborted) return Promise.reject(new Error("fixture presentation aborted"));
    if (request.frame === this.failFrame) return Promise.reject(new Error(`${this.layerId} fixture failure`));
    this.#frame = request.frame;
    this.#sessionId = request.schedulerSessionId;
    return Promise.resolve({
      adapterId: this.adapterId,
      layerId: this.layerId,
      frame: request.frame,
      ready: true,
      artifactIdentity: `${this.adapterId}:${this.version}:${request.frame}`,
      usedProxy: request.truthMode === "interactive-approximation",
      usedBakedFallback: this.kind === "baked-fallback",
      warnings: [],
    });
  }

  beginSynchronizedPlayback(session: PreviewPlaybackSession): Promise<void> {
    this.calls.push(`play:${session.schedulerSessionId}`);
    this.#frame = session.startFrame;
    this.#sessionId = session.schedulerSessionId;
    return Promise.resolve();
  }

  reportPlaybackState(schedulerSessionId: string): Promise<PreviewPlaybackReport> {
    this.calls.push(`report:${schedulerSessionId}`);
    return Promise.resolve({
      adapterId: this.adapterId,
      schedulerSessionId: this.#sessionId,
      observedFrame: (BigInt(this.observedFrameOverride ?? this.#frame) + this.observedOffset).toString(10),
      droppedFrames: this.droppedFrames,
      reportedAtMonotonicMs: 1_000,
    });
  }

  suspend(): Promise<void> {
    this.calls.push("suspend");
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.calls.push("dispose");
    return Promise.resolve();
  }
}

export class DeterministicAudioFollower implements PreviewAudioFollower {
  readonly followerId = "program-audio-fixture";
  readonly calls: string[] = [];
  observedSampleOffset = 0n;
  #expectedSample = "0";

  halt(schedulerSessionId: string): Promise<void> {
    this.calls.push(`halt:${schedulerSessionId}`);
    return Promise.resolve();
  }

  prepare(input: {
    readonly schedulerSessionId: string;
    readonly frame: string;
    readonly signal: AbortSignal;
  }): Promise<
    Readonly<{ ready: true; expectedSample: string; baseLatencyMs: number; outputLatencyMs: number }>
  > {
    if (input.signal.aborted) return Promise.reject(new Error("fixture audio prepare aborted"));
    this.#expectedSample = ((BigInt(input.frame) * 48_048n) / 30n).toString(10);
    this.calls.push(`prepare:${input.frame}`);
    return Promise.resolve({
      ready: true,
      expectedSample: this.#expectedSample,
      baseLatencyMs: 5,
      outputLatencyMs: 8,
    });
  }

  begin(session: PreviewPlaybackSession): Promise<void> {
    this.calls.push(`begin:${session.startFrame}`);
    return Promise.resolve();
  }

  report(_schedulerSessionId: string): Promise<
    Readonly<{
      observedSample: string;
      expectedSample: string;
      baseLatencyMs: number;
      outputLatencyMs: number;
    }>
  > {
    return Promise.resolve({
      observedSample: (BigInt(this.#expectedSample) + this.observedSampleOffset).toString(10),
      expectedSample: this.#expectedSample,
      baseLatencyMs: 5,
      outputLatencyMs: 8,
    });
  }

  suspend(): Promise<void> {
    this.calls.push("suspend");
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.calls.push("dispose");
    return Promise.resolve();
  }
}

export class DeterministicFinalCompositor implements PreviewFinalCompositor {
  renderFrame(input: {
    readonly frame: string;
    readonly signal: AbortSignal;
  }): Promise<FidelityFrameArtifact> {
    if (input.signal.aborted) return Promise.reject(new Error("fixture fidelity frame aborted"));
    return Promise.resolve({
      ...fidelityIdentity,
      frame: input.frame,
      artifactPath: `renders/frame-${input.frame}.png`,
      artifactHash: `artifact-frame-${input.frame}`,
      normalizedPixelHash: `pixels-frame-${input.frame}`,
    });
  }

  renderRange(input: {
    readonly range: PreviewFrameRange;
    readonly signal: AbortSignal;
  }): Promise<FidelityRangeArtifact> {
    if (input.signal.aborted) return Promise.reject(new Error("fixture fidelity range aborted"));
    return Promise.resolve({
      ...fidelityIdentity,
      range: input.range,
      artifactPath: `renders/range-${input.range.startFrame}-${input.range.endFrameExclusive}.mov`,
      artifactHash: `artifact-range-${input.range.startFrame}-${input.range.endFrameExclusive}`,
    });
  }
}

export const fidelityIdentity = {
  strictEnvironmentFingerprint: "strict-environment-fixture-0001",
  compositorId: "final-compositor-fixture",
  compositorVersion: "1.0.0",
  dependencyGraphHash: "dependency-graph-fixture-0001",
  settingsHash: "render-settings-fixture-0001",
  colorContractId: "chai-preview-rgba8-rec709-straight-v1",
  alphaMode: "straight" as const,
};
