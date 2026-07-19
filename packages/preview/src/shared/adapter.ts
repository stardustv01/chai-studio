import { createHash } from "node:crypto";
import type {
  PreviewLayerAdapter,
  PreviewPlaybackReport,
  PreviewPlaybackSession,
  PreviewPreloadResult,
  PreviewPresentationRequest,
  PreviewPresentedLayer,
  PreviewWarning,
} from "../preview-contract.js";
import { activeSharedCaptionCues, activeSharedCaptionWords } from "./captions.js";
import type {
  SharedFrameProvider,
  SharedPreviewAdapterOptions,
  SharedPreviewClip,
  SharedSourceSample,
} from "./contracts.js";
import { sharedEffectWarnings } from "./effects.js";
import { sharedFallbackWarnings } from "./fallback.js";
import { sampleSharedVideoSource } from "./sampling.js";

export class SharedPreviewAdapter implements PreviewLayerAdapter {
  readonly adapterId: string;
  readonly layerId: string;
  readonly kind: "shared" | "baked-fallback";
  readonly version = "1.0.0";
  readonly #clip: SharedPreviewClip;
  readonly #provider: SharedFrameProvider;
  readonly #options: SharedPreviewAdapterOptions;
  #disposed = false;
  #observedFrame = "0";
  #sessionId: string | null = null;

  constructor(options: SharedPreviewAdapterOptions) {
    this.adapterId = options.adapterId;
    this.layerId = options.clip.layerId;
    this.kind = options.clip.kind === "fallback" ? "baked-fallback" : "shared";
    this.#clip = options.clip;
    this.#provider = options.provider ?? deterministicSharedFrameProvider;
    this.#options = options;
  }

  async preload(range: PreviewPreloadResult["range"], signal: AbortSignal): Promise<PreviewPreloadResult> {
    this.#assertUsable(signal);
    const freshness = await this.#provider.preload({ clip: this.#clip, range, signal });
    return {
      adapterId: this.adapterId,
      layerId: this.layerId,
      range,
      freshness,
      waitingFor: "none",
    };
  }

  halt(schedulerSessionId: string): Promise<void> {
    this.#assertUsable();
    if (this.#sessionId === schedulerSessionId) this.#sessionId = null;
    return Promise.resolve();
  }

  async presentFrame(request: PreviewPresentationRequest): Promise<PreviewPresentedLayer> {
    this.#assertUsable(request.signal);
    if (!contains(this.#clip, request.frame)) {
      throw new Error(`Frame ${request.frame} is outside shared clip ${this.#clip.clipId}.`);
    }
    const sourceSample =
      this.#clip.kind === "video"
        ? sampleSharedVideoSource(this.#clip, request.frame, this.#options.preferProxy ?? false)
        : null;
    const result = await this.#provider.present({
      clip: this.#clip,
      timelineFrame: request.frame,
      sourceSample,
      signal: request.signal,
    });
    this.#observedFrame = request.frame;
    const warnings = this.#warnings(sourceSample, result.freshness);
    return {
      adapterId: this.adapterId,
      layerId: this.layerId,
      frame: request.frame,
      ready: true,
      artifactIdentity: hashIdentity({
        adapter: this.adapterId,
        clip: this.#clip.clipId,
        kind: this.#clip.kind,
        alphaMode: this.#clip.alphaMode,
        frame: request.frame,
        provider: result.artifactIdentity,
        sourceSample,
        effects: this.#clip.effects,
      }),
      usedProxy: sourceSample?.usedProxy ?? false,
      usedBakedFallback: this.#clip.kind === "fallback",
      warnings,
    };
  }

  beginSynchronizedPlayback(session: PreviewPlaybackSession): Promise<void> {
    this.#assertUsable(session.signal);
    this.#sessionId = session.schedulerSessionId;
    this.#observedFrame = session.startFrame;
    return Promise.resolve();
  }

  reportPlaybackState(schedulerSessionId: string): Promise<PreviewPlaybackReport> {
    this.#assertUsable();
    if (this.#sessionId !== schedulerSessionId) {
      throw new Error(
        `Shared adapter ${this.adapterId} does not own playback session ${schedulerSessionId}.`,
      );
    }
    return Promise.resolve({
      adapterId: this.adapterId,
      schedulerSessionId,
      observedFrame: this.#observedFrame,
      droppedFrames: 0,
      reportedAtMonotonicMs: 0,
    });
  }

  suspend(): Promise<void> {
    this.#assertUsable();
    this.#sessionId = null;
    return Promise.resolve();
  }

  dispose(): Promise<void> {
    this.#disposed = true;
    this.#sessionId = null;
    return Promise.resolve();
  }

  #warnings(sourceSample: SharedSourceSample | null, freshness: "fresh" | "stale"): PreviewWarning[] {
    const warnings: PreviewWarning[] = [];
    if (sourceSample?.usedProxy === true) {
      warnings.push({
        code: "proxy-in-use",
        severity: "info",
        message: `Shared video ${this.#clip.clipId} is using proxy ${sourceSample.selectedAssetId}.`,
        layerId: this.layerId,
        remedy: { label: "Use original", action: `preview:original:${this.#clip.clipId}` },
      });
    }
    if (freshness === "stale") {
      warnings.push({
        code: "stale-cache",
        severity: "warning",
        message: `Shared visual cache for ${this.#clip.clipId} is stale.`,
        layerId: this.layerId,
        remedy: { label: "Refresh cache", action: `cache:refresh:${this.#clip.clipId}` },
      });
    }
    if (this.#clip.kind === "fallback")
      warnings.push(...sharedFallbackWarnings(this.layerId, this.#clip.provenance));
    if (this.#options.capabilityRegistry !== undefined) {
      warnings.push(
        ...sharedEffectWarnings(this.#options.capabilityRegistry, this.layerId, this.#clip.effects),
      );
    }
    return warnings;
  }

  #assertUsable(signal?: AbortSignal): void {
    if (this.#disposed) throw new Error(`Shared adapter ${this.adapterId} is disposed.`);
    if (signal?.aborted === true) throw signal.reason ?? new Error("Shared adapter operation aborted.");
  }
}

export const deterministicSharedFrameProvider: SharedFrameProvider = {
  preload({ signal }) {
    if (signal.aborted) throw signal.reason ?? new Error("Shared preload aborted.");
    return Promise.resolve("fresh");
  },
  present({ clip, timelineFrame, sourceSample, signal }) {
    if (signal.aborted) throw signal.reason ?? new Error("Shared presentation aborted.");
    const content =
      clip.kind === "solid"
        ? clip.color
        : clip.kind === "caption"
          ? activeSharedCaptionCues(clip.plan, timelineFrame).map((cue) => ({
              cueId: cue.cueId,
              glyphHash: cue.glyphHash,
              words: activeSharedCaptionWords(cue, timelineFrame).map((word) => word.wordId),
            }))
          : clip.kind === "video"
            ? sourceSample
            : { assetId: clip.assetId, contentHash: clip.contentHash };
    return Promise.resolve({ artifactIdentity: hashIdentity(content), freshness: "fresh" });
  },
};

const contains = (clip: SharedPreviewClip, frameInput: string): boolean => {
  const frame = BigInt(frameInput);
  return (
    frame >= BigInt(clip.timelineRange.startFrame) && frame < BigInt(clip.timelineRange.endFrameExclusive)
  );
};

const hashIdentity = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
