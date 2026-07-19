import { aggregatePreviewBuffering, type PreviewBufferingSnapshot } from "./buffering.js";
import {
  activePreviewLayers,
  compositePreviewLayers,
  createPreviewLayerGraph,
  type PreviewCompositeFrame,
  type PreviewLayerNode,
} from "./layer-compositor.js";
import { PreviewLayerLifecycle, type PreviewLayerLifecycleSnapshot } from "./layer-lifecycle.js";
import {
  createPreviewFrameRange,
  framesForSecondStep,
  presentationTimestampForFrame,
  PreviewMasterClock,
  type MasterClockSnapshot,
  type PreviewFrameRange,
  type PreviewRational,
} from "./master-clock.js";
import type {
  FidelityFrameArtifact,
  FidelityRangeArtifact,
  PreviewAudioFollower,
  PreviewFinalCompositor,
  PreviewLayerAdapter,
  PreviewPlaybackReport,
  PreviewPresentedLayer,
  PreviewWarning,
} from "./preview-contract.js";
import {
  resolvePreviewQualityPolicy,
  warning,
  type PreviewLoadClass,
  type PreviewQuality,
  type PreviewQualityPolicy,
  type PreviewTruthMode,
} from "./quality-policy.js";
import {
  canTransitionPreviewTransport,
  transitionPreviewTransport,
  type PreviewTransportEvent,
  type PreviewTransportState,
} from "./transport-machine.js";

export interface PreviewDriftItem {
  readonly adapterId: string;
  readonly schedulerSessionId: string;
  readonly expectedFrame: string;
  readonly observedFrame: string;
  readonly deltaFrames: string;
  readonly hardResyncRequired: boolean;
  readonly droppedFrames: number;
}

export interface PreviewDriftReport {
  readonly schedulerSessionId: string;
  readonly thresholdFrames: PreviewRational;
  readonly items: readonly PreviewDriftItem[];
  readonly hardResyncRequired: boolean;
  readonly totalDroppedFrames: number;
}

export interface PreviewAudioSyncReport {
  readonly schedulerSessionId: string;
  readonly expectedSample: string;
  readonly observedSample: string;
  readonly deltaSamples: string;
  readonly baseLatencyMs: number;
  readonly outputLatencyMs: number;
  readonly hardResyncRequired: boolean;
  readonly correction: "none" | "barrier-required";
}

export interface PreviewSeekBarrierResult {
  readonly schedulerSessionId: string;
  readonly frame: string;
  readonly composite: PreviewCompositeFrame;
  readonly partialFailures: readonly Readonly<{ adapterId: string; layerId: string; message: string }>[];
  readonly audioReady: boolean;
  readonly stale: boolean;
}

export interface PreviewScrubResult {
  readonly presentation: PreviewSeekBarrierResult;
  readonly audioAuditioned: boolean;
  readonly grainDurationMs: number;
}

export interface PreviewSchedulerSnapshot {
  readonly schemaVersion: "1.0.0";
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly schedulerSessionId: string;
  readonly transport: PreviewTransportState;
  readonly clock: MasterClockSnapshot;
  readonly qualityPolicy: PreviewQualityPolicy;
  readonly buffering: PreviewBufferingSnapshot | null;
  readonly layers: readonly PreviewLayerLifecycleSnapshot[];
  readonly warnings: readonly PreviewWarning[];
  readonly droppedFrames: number;
  readonly lastComposite: PreviewCompositeFrame | null;
  readonly lastError: string | null;
  readonly stateVersion: number;
}

export interface PreviewSchedulerOptions {
  readonly projectId: string;
  readonly revisionId: string;
  readonly timelineId: string;
  readonly durationFrames: string;
  readonly timelineFps: PreviewRational;
  readonly adapters: readonly PreviewLayerAdapter[];
  readonly layerGraph: readonly PreviewLayerNode[];
  readonly audio?: PreviewAudioFollower;
  readonly finalCompositor?: PreviewFinalCompositor;
  readonly sessionIdFactory?: (sequence: number, purpose: string) => string;
  readonly maximumPreloadConcurrency?: number;
  readonly audioSampleRate?: 44_100 | 48_000 | 96_000;
}

export class PreviewScheduler {
  readonly #projectId: string;
  readonly #revisionId: string;
  readonly #timelineId: string;
  readonly #durationFrames: bigint;
  readonly #clock: PreviewMasterClock;
  readonly #adapters: readonly PreviewLayerAdapter[];
  readonly #adapterByLayer: ReadonlyMap<string, PreviewLayerAdapter>;
  readonly #layerGraph: readonly PreviewLayerNode[];
  readonly #lifecycles: ReadonlyMap<string, PreviewLayerLifecycle>;
  readonly #audio: PreviewAudioFollower | undefined;
  readonly #finalCompositor: PreviewFinalCompositor | undefined;
  readonly #sessionIdFactory: (sequence: number, purpose: string) => string;
  readonly #maximumPreloadConcurrency: number;
  readonly #audioSampleRate: 44_100 | 48_000 | 96_000;
  readonly #listeners = new Set<(snapshot: PreviewSchedulerSnapshot) => void>();
  #transport: PreviewTransportState = "stopped";
  #qualityPolicy = resolvePreviewQualityPolicy({
    quality: "balanced",
    truthMode: "interactive-approximation",
  });
  #buffering: PreviewBufferingSnapshot | null = null;
  #warnings: readonly PreviewWarning[] = this.#qualityPolicy.warnings;
  #droppedFrames = 0;
  #lastComposite: PreviewCompositeFrame | null = null;
  #lastError: string | null = null;
  #stateVersion = 1;
  #sessionSequence = 0;
  #schedulerSessionId: string;
  #activeController: AbortController;
  #inFlightPreloads = 0;

  constructor(options: PreviewSchedulerOptions) {
    this.#projectId = assertIdentifier(options.projectId, "projectId");
    this.#revisionId = assertIdentifier(options.revisionId, "revisionId");
    this.#timelineId = assertIdentifier(options.timelineId, "timelineId");
    this.#durationFrames = parseDuration(options.durationFrames);
    this.#clock = new PreviewMasterClock({
      timelineFps: options.timelineFps,
      durationFrames: options.durationFrames,
    });
    this.#adapters = [...options.adapters];
    this.#layerGraph = createPreviewLayerGraph(options.layerGraph);
    const adapterByLayer = new Map<string, PreviewLayerAdapter>();
    const lifecycles = new Map<string, PreviewLayerLifecycle>();
    for (const adapter of this.#adapters) {
      if (adapterByLayer.has(adapter.layerId))
        throw new Error(`Preview layer ${adapter.layerId} has multiple adapters.`);
      adapterByLayer.set(adapter.layerId, adapter);
      lifecycles.set(adapter.layerId, new PreviewLayerLifecycle(adapter));
    }
    for (const node of this.#layerGraph) {
      if (!adapterByLayer.has(node.id)) throw new Error(`Preview layer ${node.id} has no adapter.`);
      if (adapterByLayer.get(node.id)?.adapterId !== node.adapterId) {
        throw new Error(`Preview layer ${node.id} adapter identity does not match its graph node.`);
      }
    }
    this.#adapterByLayer = adapterByLayer;
    this.#lifecycles = lifecycles;
    this.#audio = options.audio;
    this.#finalCompositor = options.finalCompositor;
    this.#sessionIdFactory =
      options.sessionIdFactory ?? ((sequence, purpose) => `preview-${purpose}-${sequence.toString()}`);
    this.#maximumPreloadConcurrency = options.maximumPreloadConcurrency ?? 4;
    this.#audioSampleRate = options.audioSampleRate ?? 48_000;
    if (
      !Number.isSafeInteger(this.#maximumPreloadConcurrency) ||
      this.#maximumPreloadConcurrency < 1 ||
      this.#maximumPreloadConcurrency > 32
    ) {
      throw new Error("Preview maximum preload concurrency is invalid.");
    }
    this.#schedulerSessionId = this.#sessionIdFactory(0, "created");
    this.#activeController = new AbortController();
    this.#transition("load");
    this.#transition("ready");
  }

  snapshot(): PreviewSchedulerSnapshot {
    return structuredClone({
      schemaVersion: "1.0.0",
      projectId: this.#projectId,
      revisionId: this.#revisionId,
      timelineId: this.#timelineId,
      schedulerSessionId: this.#schedulerSessionId,
      transport: this.#transport,
      clock: this.#clock.snapshot(),
      qualityPolicy: this.#qualityPolicy,
      buffering: this.#buffering,
      layers: [...this.#lifecycles.values()].map((lifecycle) => lifecycle.snapshot()),
      warnings: this.#warnings,
      droppedFrames: this.#droppedFrames,
      lastComposite: this.#lastComposite,
      lastError: this.#lastError,
      stateVersion: this.#stateVersion,
    });
  }

  subscribe(listener: (snapshot: PreviewSchedulerSnapshot) => void): () => void {
    this.#listeners.add(listener);
    listener(this.snapshot());
    return () => this.#listeners.delete(listener);
  }

  setPlayRate(playRate: PreviewRational): PreviewSchedulerSnapshot {
    this.#assertUsable();
    this.#clock.setPlayRate(playRate);
    this.#warnings = this.#qualityPolicy.warnings;
    if (playRate.numerator !== playRate.denominator) {
      this.#warnings = [
        ...this.#warnings,
        warning(
          "audio-muted-for-rate",
          "Program audio is muted outside +1x playback.",
          "Return to +1x",
          "preview.set-rate-1x",
          null,
          "info",
        ),
      ];
    }
    return this.#commit();
  }

  setLoopRange(range: PreviewFrameRange | null): PreviewSchedulerSnapshot {
    this.#assertUsable();
    this.#clock.setLoopRange(range);
    return this.#commit();
  }

  setInOutRange(range: PreviewFrameRange | null): PreviewSchedulerSnapshot {
    this.#assertUsable();
    this.#clock.setInOutRange(range);
    return this.#commit();
  }

  setQuality(input: {
    readonly quality: PreviewQuality;
    readonly truthMode: PreviewTruthMode;
    readonly loadClass?: PreviewLoadClass;
    readonly hasBakedFallback?: boolean;
    readonly unsupportedEffects?: boolean;
  }): PreviewSchedulerSnapshot {
    this.#assertUsable();
    this.#qualityPolicy = resolvePreviewQualityPolicy(input);
    this.#warnings = this.#qualityPolicy.warnings;
    return this.#commit();
  }

  async preload(beforeFrames: number, afterFrames: number): Promise<PreviewBufferingSnapshot> {
    this.#assertUsable();
    assertPreloadWindow(beforeFrames, "beforeFrames");
    assertPreloadWindow(afterFrames, "afterFrames");
    if (this.#inFlightPreloads >= this.#maximumPreloadConcurrency) {
      const requestedRange = this.#preloadRange(beforeFrames, afterFrames);
      this.#buffering = aggregatePreviewBuffering({
        requestedRange,
        results: [],
        inFlightRequests: this.#inFlightPreloads,
        maximumInFlightRequests: this.#maximumPreloadConcurrency,
      });
      this.#commit();
      return this.#buffering;
    }
    const session = this.#newSession("preload");
    const requestedRange = this.#preloadRange(beforeFrames, afterFrames);
    this.#inFlightPreloads += 1;
    const failedAdapterIds: string[] = [];
    const results = await Promise.all(
      this.#adapters.map(async (adapter) => {
        const lifecycle = this.#requireLifecycle(adapter.layerId);
        transitionLifecycleForPreload(lifecycle);
        try {
          const result = await adapter.preload(requestedRange, session.controller.signal);
          lifecycle.transition("ready");
          return result;
        } catch (error) {
          failedAdapterIds.push(adapter.adapterId);
          lifecycle.transition("error", errorMessage(error));
          return null;
        }
      }),
    );
    this.#inFlightPreloads -= 1;
    this.#buffering = aggregatePreviewBuffering({
      requestedRange,
      results: results.filter((result) => result !== null),
      failedAdapterIds,
      inFlightRequests: this.#inFlightPreloads,
      maximumInFlightRequests: this.#maximumPreloadConcurrency,
    });
    this.#warnings = warningsForBuffering(this.#qualityPolicy.warnings, this.#buffering);
    this.#commit();
    return this.#buffering;
  }

  async seek(frameInput: string): Promise<PreviewSeekBarrierResult> {
    this.#assertUsable();
    const targetFrame = parseTargetFrame(frameInput, this.#durationFrames);
    const session = this.#newSession("seek");
    this.#transition("seek");
    const activeLayers = activePreviewLayers(this.#layerGraph, targetFrame);
    const activeAdapters = activeLayers.map((node) => this.#requireAdapter(node.id));
    await Promise.allSettled([
      ...this.#adapters.map((adapter) => adapter.halt(session.id)),
      ...(this.#audio === undefined ? [] : [this.#audio.halt(session.id)]),
    ]);
    const presentationTimestamp = presentationTimestampForFrame(
      targetFrame,
      this.#clock.snapshot().timelineFps,
    );
    const partialFailures: { adapterId: string; layerId: string; message: string }[] = [];
    const presentations = await Promise.all(
      activeAdapters.map(async (adapter): Promise<PreviewPresentedLayer | null> => {
        const lifecycle = this.#requireLifecycle(adapter.layerId);
        try {
          if (lifecycle.snapshot().state === "unloaded" || lifecycle.snapshot().state === "error") {
            transitionLifecycleForPreload(lifecycle);
            await adapter.preload(
              createPreviewFrameRange(targetFrame, (BigInt(targetFrame) + 1n).toString(10)),
              session.controller.signal,
            );
            lifecycle.transition("ready");
          }
          if (lifecycle.snapshot().state === "suspended") lifecycle.transition("presenting");
          else lifecycle.transition("presenting");
          const presentation = await adapter.presentFrame({
            schedulerSessionId: session.id,
            frame: targetFrame,
            presentationTimestamp,
            truthMode: this.#qualityPolicy.truthMode,
            signal: session.controller.signal,
          });
          if (presentation.frame !== targetFrame) {
            throw new Error(`Adapter presented frame ${presentation.frame} instead of ${targetFrame}.`);
          }
          lifecycle.transition("ready");
          return presentation;
        } catch (error) {
          const message = errorMessage(error);
          partialFailures.push({ adapterId: adapter.adapterId, layerId: adapter.layerId, message });
          if (lifecycle.snapshot().state !== "disposed") lifecycle.transition("error", message);
          return null;
        }
      }),
    );
    let audioReady = this.#audio === undefined;
    if (this.#audio !== undefined) {
      try {
        await this.#audio.prepare({
          schedulerSessionId: session.id,
          frame: targetFrame,
          presentationTimestamp,
          signal: session.controller.signal,
        });
        audioReady = true;
      } catch (error) {
        partialFailures.push({
          adapterId: this.#audio.followerId,
          layerId: "program-audio",
          message: errorMessage(error),
        });
      }
    }
    const stale = session.id !== this.#schedulerSessionId || session.controller.signal.aborted;
    if (stale) {
      return {
        schedulerSessionId: session.id,
        frame: targetFrame,
        composite: compositePreviewLayers(targetFrame, this.#layerGraph, []),
        partialFailures,
        audioReady,
        stale: true,
      };
    }
    const validPresentations = presentations.filter((presentation) => presentation !== null);
    if (activeAdapters.length > 0 && validPresentations.length === 0) {
      this.#lastError = "Every active preview layer failed the seek barrier.";
      this.#transition("fail");
      throw new Error(this.#lastError);
    }
    this.#clock.seek(targetFrame);
    const failureWarnings = partialFailures.map((failure) =>
      warning(
        "layer-failed",
        `${failure.layerId}: ${failure.message}`,
        "Inspect layer",
        "preview.inspect-layer",
        failure.layerId,
        "error",
      ),
    );
    this.#warnings = [...this.#qualityPolicy.warnings, ...failureWarnings];
    this.#lastComposite = compositePreviewLayers(
      targetFrame,
      this.#layerGraph,
      validPresentations,
      failureWarnings,
    );
    this.#lastError = null;
    this.#transition("ready");
    return {
      schedulerSessionId: session.id,
      frame: targetFrame,
      composite: this.#lastComposite,
      partialFailures,
      audioReady,
      stale: false,
    };
  }

  stepFrames(delta: number): Promise<PreviewSeekBarrierResult> {
    if (!Number.isSafeInteger(delta) || delta === 0 || Math.abs(delta) > 1_000) {
      throw new Error("Preview frame-step delta is outside bounded safe limits.");
    }
    const target = this.#boundedTarget(BigInt(this.#clock.snapshot().masterFrame) + BigInt(delta));
    return this.seek(target.toString(10));
  }

  async scrub(frameInput: string): Promise<PreviewScrubResult> {
    const presentation = await this.seek(frameInput);
    if (
      presentation.stale ||
      this.#audio?.auditionScrub === undefined ||
      this.#activeController.signal.aborted
    ) {
      return { presentation, audioAuditioned: false, grainDurationMs: 0 };
    }
    const audition = await this.#audio.auditionScrub({
      schedulerSessionId: presentation.schedulerSessionId,
      frame: presentation.frame,
      presentationTimestamp: this.#clock.snapshot().presentationTimestamp,
      signal: this.#activeController.signal,
    });
    return {
      presentation,
      audioAuditioned: audition.auditioned,
      grainDurationMs: audition.grainDurationMs,
    };
  }

  stepSeconds(seconds: number): Promise<PreviewSeekBarrierResult> {
    const target = this.#boundedTarget(
      BigInt(this.#clock.snapshot().masterFrame) +
        framesForSecondStep(seconds, this.#clock.snapshot().timelineFps),
    );
    return this.seek(target.toString(10));
  }

  async play(): Promise<PreviewSchedulerSnapshot> {
    this.#assertUsable();
    if (this.#durationFrames === 0n) throw new Error("Cannot play an empty preview timeline.");
    const session = this.#newSession("play");
    const clock = this.#clock.snapshot();
    const playbackSession = {
      schedulerSessionId: session.id,
      startFrame: clock.masterFrame,
      startPresentationTimestamp: clock.presentationTimestamp,
      timelineFps: clock.timelineFps,
      playRate: clock.playRate,
      nativeAudioSuppressed: true as const,
      signal: session.controller.signal,
    };
    await Promise.all(this.#adapters.map((adapter) => adapter.beginSynchronizedPlayback(playbackSession)));
    if (
      this.#audio !== undefined &&
      clock.playRate.numerator === clock.playRate.denominator &&
      BigInt(clock.playRate.numerator) > 0n
    ) {
      await this.#audio.begin(playbackSession);
    }
    this.#transition("play");
    return this.snapshot();
  }

  async pause(): Promise<PreviewSchedulerSnapshot> {
    this.#assertUsable();
    const session = this.#newSession("pause");
    await Promise.allSettled([
      ...this.#adapters.map((adapter) => adapter.halt(session.id)),
      ...(this.#audio === undefined ? [] : [this.#audio.halt(session.id)]),
    ]);
    this.#transition("pause");
    return this.snapshot();
  }

  async stop(): Promise<PreviewSchedulerSnapshot> {
    this.#assertUsable();
    const session = this.#newSession("stop");
    await Promise.allSettled([
      ...this.#adapters.map((adapter) => adapter.halt(session.id)),
      ...(this.#audio === undefined ? [] : [this.#audio.halt(session.id)]),
    ]);
    this.#clock.seek("0");
    this.#transition("stop");
    return this.snapshot();
  }

  advanceAuthoritativeFrames(frameCount: bigint): PreviewSchedulerSnapshot {
    this.#assertUsable();
    if (this.#transport !== "playing") throw new Error("Preview clock can advance only while playing.");
    this.#clock.advance(frameCount);
    return this.#commit();
  }

  async reportDrift(): Promise<PreviewDriftReport> {
    this.#assertUsable();
    const expectedFrame = this.#clock.snapshot().masterFrame;
    const reports = await Promise.all(
      this.#adapters.map((adapter) => adapter.reportPlaybackState(this.#schedulerSessionId)),
    );
    return this.#createDriftReport(expectedFrame, reports);
  }

  async hardResynchronizeIfRequired(): Promise<
    Readonly<{
      resynchronized: boolean;
      report: PreviewDriftReport;
      presentation: PreviewSeekBarrierResult | null;
    }>
  > {
    const report = await this.reportDrift();
    if (!report.hardResyncRequired) return { resynchronized: false, report, presentation: null };
    const presentation = await this.seek(this.#clock.snapshot().masterFrame);
    return { resynchronized: true, report, presentation };
  }

  async reportAudioSync(): Promise<PreviewAudioSyncReport | null> {
    this.#assertUsable();
    if (this.#audio === undefined) return null;
    const report = await this.#audio.report(this.#schedulerSessionId);
    const expected = BigInt(report.expectedSample);
    const observed = BigInt(report.observedSample);
    const delta = observed - expected;
    const fps = this.#clock.snapshot().timelineFps;
    const hardResyncRequired =
      absoluteBigInt(delta) * 2n * BigInt(fps.numerator) >
      BigInt(this.#audioSampleRate) * BigInt(fps.denominator);
    return {
      schedulerSessionId: this.#schedulerSessionId,
      expectedSample: report.expectedSample,
      observedSample: report.observedSample,
      deltaSamples: delta.toString(10),
      baseLatencyMs: report.baseLatencyMs,
      outputLatencyMs: report.outputLatencyMs,
      hardResyncRequired,
      correction: hardResyncRequired ? "barrier-required" : "none",
    };
  }

  async requestFidelityFrame(frameInput: string): Promise<FidelityFrameArtifact> {
    this.#assertUsable();
    const compositor = this.#requireFinalCompositor();
    const frame = parseTargetFrame(frameInput, this.#durationFrames);
    const session = this.#newSession("fidelity-frame");
    const artifact = await compositor.renderFrame({
      projectId: this.#projectId,
      revisionId: this.#revisionId,
      timelineId: this.#timelineId,
      frame,
      signal: session.controller.signal,
    });
    assertFidelityIdentity(artifact);
    if (artifact.frame !== frame) throw new Error("Fidelity compositor returned the wrong frame.");
    return artifact;
  }

  async requestFidelityRange(range: PreviewFrameRange): Promise<FidelityRangeArtifact> {
    this.#assertUsable();
    const compositor = this.#requireFinalCompositor();
    const normalizedRange = createPreviewFrameRange(range.startFrame, range.endFrameExclusive);
    if (BigInt(normalizedRange.endFrameExclusive) > this.#durationFrames) {
      throw new Error("Fidelity range is outside the timeline.");
    }
    const session = this.#newSession("fidelity-range");
    const artifact = await compositor.renderRange({
      projectId: this.#projectId,
      revisionId: this.#revisionId,
      timelineId: this.#timelineId,
      range: normalizedRange,
      signal: session.controller.signal,
    });
    assertFidelityIdentity(artifact);
    if (
      artifact.range.startFrame !== normalizedRange.startFrame ||
      artifact.range.endFrameExclusive !== normalizedRange.endFrameExclusive
    ) {
      throw new Error("Fidelity compositor returned the wrong range.");
    }
    return artifact;
  }

  async dispose(): Promise<PreviewSchedulerSnapshot> {
    if (this.#transport === "disposed") return this.snapshot();
    this.#activeController.abort("Preview scheduler disposed.");
    await Promise.allSettled([
      ...this.#adapters.map(async (adapter) => {
        await adapter.suspend();
        await adapter.dispose();
      }),
      ...(this.#audio === undefined
        ? []
        : [
            (async () => {
              await this.#audio?.suspend();
              await this.#audio?.dispose();
            })(),
          ]),
    ]);
    for (const lifecycle of this.#lifecycles.values()) {
      if (lifecycle.snapshot().state !== "disposed") lifecycle.transition("disposed");
    }
    this.#transition("dispose");
    return this.snapshot();
  }

  #createDriftReport(expectedFrame: string, reports: readonly PreviewPlaybackReport[]): PreviewDriftReport {
    const items = reports.map((report): PreviewDriftItem => {
      if (report.schedulerSessionId !== this.#schedulerSessionId) {
        throw new Error(`Preview adapter ${report.adapterId} reported a stale scheduler session.`);
      }
      if (!Number.isSafeInteger(report.droppedFrames) || report.droppedFrames < 0) {
        throw new Error(`Preview adapter ${report.adapterId} reported invalid dropped frames.`);
      }
      const delta = BigInt(report.observedFrame) - BigInt(expectedFrame);
      return {
        adapterId: report.adapterId,
        schedulerSessionId: report.schedulerSessionId,
        expectedFrame,
        observedFrame: report.observedFrame,
        deltaFrames: delta.toString(10),
        hardResyncRequired: delta !== 0n,
        droppedFrames: report.droppedFrames,
      };
    });
    const newlyDropped = items.reduce((sum, item) => sum + item.droppedFrames, 0);
    this.#droppedFrames += newlyDropped;
    if (newlyDropped > 0) {
      this.#warnings = [
        ...this.#warnings.filter((item) => item.code !== "dropped-frames"),
        warning(
          "dropped-frames",
          `${this.#droppedFrames.toString()} preview frames have been dropped in this session.`,
          "Inspect sync diagnostics",
          "preview.open-sync-diagnostics",
        ),
      ];
      this.#commit();
    }
    return {
      schedulerSessionId: this.#schedulerSessionId,
      thresholdFrames: { numerator: "1", denominator: "2" },
      items,
      hardResyncRequired: items.some((item) => item.hardResyncRequired),
      totalDroppedFrames: this.#droppedFrames,
    };
  }

  #preloadRange(beforeFrames: number, afterFrames: number): PreviewFrameRange {
    const frame = BigInt(this.#clock.snapshot().masterFrame);
    const start = frame - BigInt(beforeFrames) < 0n ? 0n : frame - BigInt(beforeFrames);
    const end =
      this.#durationFrames === 0n ? 1n : minBigInt(this.#durationFrames, frame + BigInt(afterFrames) + 1n);
    return createPreviewFrameRange(start, end);
  }

  #boundedTarget(frame: bigint): bigint {
    if (frame < 0n || this.#durationFrames === 0n) return 0n;
    return frame >= this.#durationFrames ? this.#durationFrames - 1n : frame;
  }

  #newSession(purpose: string): Readonly<{ id: string; controller: AbortController }> {
    this.#activeController.abort(`Superseded by preview ${purpose}.`);
    this.#sessionSequence += 1;
    this.#schedulerSessionId = this.#sessionIdFactory(this.#sessionSequence, purpose);
    this.#activeController = new AbortController();
    return { id: this.#schedulerSessionId, controller: this.#activeController };
  }

  #transition(event: PreviewTransportEvent): void {
    this.#transport = transitionPreviewTransport(this.#transport, event);
    this.#commit();
  }

  #commit(): PreviewSchedulerSnapshot {
    this.#stateVersion += 1;
    const snapshot = this.snapshot();
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  #assertUsable(): void {
    if (this.#transport === "disposed") throw new Error("Preview scheduler is disposed.");
    if (this.#transport === "error")
      throw new Error("Preview scheduler must recover before further commands.");
  }

  #requireAdapter(layerId: string): PreviewLayerAdapter {
    const adapter = this.#adapterByLayer.get(layerId);
    if (adapter === undefined) throw new Error(`Preview layer ${layerId} has no adapter.`);
    return adapter;
  }

  #requireLifecycle(layerId: string): PreviewLayerLifecycle {
    const lifecycle = this.#lifecycles.get(layerId);
    if (lifecycle === undefined) throw new Error(`Preview layer ${layerId} has no lifecycle.`);
    return lifecycle;
  }

  #requireFinalCompositor(): PreviewFinalCompositor {
    if (this.#finalCompositor === undefined) {
      throw new Error(
        "Rendered fidelity requires the final-compositor contract; no compositor is connected.",
      );
    }
    return this.#finalCompositor;
  }
}

const transitionLifecycleForPreload = (lifecycle: PreviewLayerLifecycle): void => {
  const state = lifecycle.snapshot().state;
  if (state === "ready" || state === "suspended" || state === "error" || state === "unloaded") {
    lifecycle.transition("preloading");
    return;
  }
  if (state !== "preloading") throw new Error(`Preview layer cannot preload while ${state}.`);
};

const warningsForBuffering = (
  baseWarnings: readonly PreviewWarning[],
  buffering: PreviewBufferingSnapshot,
): readonly PreviewWarning[] => {
  const warnings = [...baseWarnings];
  if (buffering.status !== "ready") {
    warnings.push(
      warning(
        "buffering",
        buffering.waitingFor.length > 0
          ? `Preview is waiting for ${buffering.waitingFor.join(", ")}.`
          : "Preview preload is constrained by back-pressure or a layer failure.",
        "Inspect preload",
        "preview.open-buffering-diagnostics",
      ),
    );
  }
  if (buffering.staleAdapterIds.length > 0) {
    warnings.push(
      warning(
        "stale-cache",
        `Stale preview cache reported by ${buffering.staleAdapterIds.join(", ")}.`,
        "Refresh cache",
        "preview.refresh-cache",
      ),
    );
  }
  return warnings;
};

const assertFidelityIdentity = (artifact: {
  readonly strictEnvironmentFingerprint: string;
  readonly compositorId: string;
  readonly compositorVersion: string;
  readonly dependencyGraphHash: string;
  readonly settingsHash: string;
  readonly colorContractId: string;
  readonly alphaMode: string;
}): void => {
  const fields = [
    artifact.strictEnvironmentFingerprint,
    artifact.compositorId,
    artifact.compositorVersion,
    artifact.dependencyGraphHash,
    artifact.settingsHash,
    artifact.colorContractId,
  ];
  if (fields.some((field) => field.trim().length < 3)) {
    throw new Error("Fidelity artifact is missing required environment or dependency identity.");
  }
  if (artifact.alphaMode !== "straight" && artifact.alphaMode !== "premultiplied") {
    throw new Error("Fidelity artifact alpha mode is invalid.");
  }
};

const assertIdentifier = (value: string, field: string): string => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(value)) throw new Error(`Preview ${field} is invalid.`);
  return value;
};

const parseDuration = (value: string): bigint => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw new Error("Preview durationFrames is invalid.");
  return BigInt(value);
};

const parseTargetFrame = (value: string, duration: bigint): string => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw new Error("Preview target frame is invalid.");
  const frame = BigInt(value);
  if ((duration === 0n && frame !== 0n) || (duration > 0n && frame >= duration)) {
    throw new Error("Preview target frame is outside the timeline.");
  }
  return value;
};

const assertPreloadWindow = (value: number, field: string): void => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 600) {
    throw new Error(`Preview preload ${field} is outside bounded safe limits.`);
  }
};

const minBigInt = (left: bigint, right: bigint): bigint => (left < right ? left : right);

const absoluteBigInt = (value: bigint): bigint => (value < 0n ? -value : value);

const errorMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export const canApplyPreviewSchedulerEvent = (
  state: PreviewTransportState,
  event: PreviewTransportEvent,
): boolean => canTransitionPreviewTransport(state, event);
