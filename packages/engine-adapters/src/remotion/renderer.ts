import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import type {
  RemotionAdapterDiagnostic,
  RemotionBrowserLogRecord,
  RemotionRangeArtifact,
  RemotionRangeRequest,
  RemotionRuntimeComposition,
  RemotionStillArtifact,
  RemotionStillRequest,
} from "./contracts.js";
import { pinnedRemotionVersion } from "./contracts.js";
import { browserLogToDiagnostic, remotionDiagnostic } from "./diagnostics.js";
import { normalizeRemotionPng } from "./png-normalization.js";
import type { RemotionRuntime } from "./runtime-contract.js";
import { validateRemotionSource } from "./validation.js";

export class RemotionRenderCancelledError extends Error {
  constructor(message = "Remotion render was cancelled; no valid artifact was committed.") {
    super(message);
    this.name = "RemotionRenderCancelledError";
  }
}

export class RemotionRenderer {
  readonly #runtime: RemotionRuntime;

  constructor(runtime: RemotionRuntime) {
    this.#runtime = runtime;
  }

  async renderStill(request: RemotionStillRequest): Promise<RemotionStillArtifact> {
    const frame = parseFrame(request.frame, "frame");
    const duration = BigInt(request.composition.durationFrames);
    if (frame >= duration) throw new Error("Remotion still frame is outside the composition.");
    await this.#assertValid(request.source, request.composition);
    let serveUrl =
      request.serveUrl ?? (await this.#runtime.bundle(request.source.entryPoint, request.signal));
    const browserLogs: RemotionBrowserLogRecord[] = [];
    await mkdir(path.dirname(request.outputPath), { recursive: true });
    try {
      const render = async () =>
        this.#runtime.renderStill({
          serveUrl,
          composition: runtimeComposition(request.composition),
          inputProps: request.source.inputProps,
          outputPath: request.outputPath,
          frame: safeNumber(frame, "frame"),
          imageFormat: request.imageFormat,
          browserExecutable: request.environment.browserExecutable,
          signal: request.signal,
          onBrowserLog: (log) => browserLogs.push(log),
        });
      try {
        await render();
      } catch (cause) {
        if (!isUnavailableServeUrlFailure(cause) || request.signal.aborted) throw cause;
        await rm(request.outputPath, { force: true });
        serveUrl = await this.#runtime.bundle(request.source.entryPoint, request.signal);
        await render();
      }
      throwIfAborted(request.signal);
      const bytes = await readFile(request.outputPath);
      const normalized = normalizeRemotionPng(bytes);
      return {
        kind: "remotion-still",
        sourceId: request.source.sourceId,
        compositionId: request.composition.compositionId,
        frame: request.frame,
        outputPath: request.outputPath,
        artifactHash: sha256(bytes),
        normalizedPixelHash: normalized.normalizedPixelHash,
        compositorId: "remotion-renderer",
        compositorVersion: pinnedRemotionVersion,
        dependencyGraphHash: request.dependencySet.dependencyGraphHash,
        strictEnvironmentFingerprint: request.environment.strictEnvironmentFingerprint,
        settingsHash: request.environment.settingsHash,
        colorContractId: request.environment.colorContractId,
        alphaMode: request.environment.alphaMode,
        browserIdentity: request.environment.browserIdentity,
        diagnostics: browserLogs.map(browserLogToDiagnostic),
      };
    } catch (cause) {
      await rm(request.outputPath, { force: true });
      if (request.signal.aborted || isCancellation(cause)) throw new RemotionRenderCancelledError();
      throw renderFailure(
        "remotion.still.failed",
        cause,
        request.composition.compositionId,
        request.frame,
        browserLogs,
      );
    }
  }

  async renderRange(request: RemotionRangeRequest): Promise<RemotionRangeArtifact> {
    const startFrame = parseFrame(request.startFrame, "startFrame");
    const endFrameExclusive = parseFrame(request.endFrameExclusive, "endFrameExclusive");
    const duration = BigInt(request.composition.durationFrames);
    if (endFrameExclusive <= startFrame || endFrameExclusive > duration) {
      throw new Error("Remotion render range must be non-empty, half-open, and inside the composition.");
    }
    await this.#assertValid(request.source, request.composition);
    let serveUrl =
      request.serveUrl ?? (await this.#runtime.bundle(request.source.entryPoint, request.signal));
    const browserLogs: RemotionBrowserLogRecord[] = [];
    const attemptState = { progressStarted: false };
    await mkdir(path.dirname(request.outputPath), { recursive: true });
    try {
      const render = async () =>
        this.#runtime.renderRange({
          serveUrl,
          composition: runtimeComposition(request.composition),
          inputProps: request.source.inputProps,
          outputPath: request.outputPath,
          startFrame: safeNumber(startFrame, "startFrame"),
          endFrameInclusive: safeNumber(endFrameExclusive - 1n, "endFrameExclusive"),
          codec: request.codec,
          browserExecutable: request.environment.browserExecutable,
          colorSpace: request.environment.colorSpace,
          signal: request.signal,
          onProgress: (progress) => {
            attemptState.progressStarted = true;
            request.onProgress?.(progress);
          },
          onBrowserLog: (log) => browserLogs.push(log),
        });
      try {
        await render();
      } catch (cause) {
        if (attemptState.progressStarted || !isUnavailableServeUrlFailure(cause) || request.signal.aborted)
          throw cause;
        await rm(request.outputPath, { force: true });
        serveUrl = await this.#runtime.bundle(request.source.entryPoint, request.signal);
        await render();
      }
      throwIfAborted(request.signal);
      const bytes = await readFile(request.outputPath);
      return {
        kind: "remotion-range",
        sourceId: request.source.sourceId,
        compositionId: request.composition.compositionId,
        range: { startFrame: request.startFrame, endFrameExclusive: request.endFrameExclusive },
        outputPath: request.outputPath,
        artifactHash: sha256(bytes),
        codec: request.codec,
        compositorId: "remotion-renderer",
        compositorVersion: pinnedRemotionVersion,
        dependencyGraphHash: request.dependencySet.dependencyGraphHash,
        strictEnvironmentFingerprint: request.environment.strictEnvironmentFingerprint,
        settingsHash: request.environment.settingsHash,
        colorContractId: request.environment.colorContractId,
        alphaMode: request.environment.alphaMode,
        browserIdentity: request.environment.browserIdentity,
        diagnostics: browserLogs.map(browserLogToDiagnostic),
      };
    } catch (cause) {
      await rm(request.outputPath, { force: true });
      if (request.signal.aborted || isCancellation(cause)) throw new RemotionRenderCancelledError();
      throw renderFailure(
        "remotion.range.failed",
        cause,
        request.composition.compositionId,
        request.startFrame,
        browserLogs,
      );
    }
  }

  async #assertValid(
    source: RemotionStillRequest["source"],
    composition: RemotionStillRequest["composition"],
  ): Promise<void> {
    const validation = await validateRemotionSource(source, composition);
    if (!validation.valid) {
      const messages = validation.diagnostics
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.message)
        .join("; ");
      throw new Error(`Remotion source validation failed before render: ${messages}`);
    }
  }
}

const runtimeComposition = (
  composition: RemotionStillRequest["composition"],
): RemotionRuntimeComposition => ({
  id: composition.compositionId,
  width: composition.width,
  height: composition.height,
  fps: Number(composition.fps.numerator) / Number(composition.fps.denominator),
  durationInFrames: safeNumber(BigInt(composition.durationFrames), "durationFrames"),
  props: composition.calculatedProps,
  defaultProps: composition.defaultProps,
  defaultCodec: null,
  defaultOutName: null,
  defaultVideoImageFormat: null,
  defaultPixelFormat: null,
  defaultProResProfile: null,
  defaultSampleRate: null,
});

const renderFailure = (
  code: string,
  cause: unknown,
  compositionId: string,
  frame: string,
  browserLogs: readonly RemotionBrowserLogRecord[],
): AggregateError => {
  const diagnostic = remotionDiagnostic({
    category: "render",
    code,
    severity: "error",
    stage: "remotion-render",
    message: cause instanceof Error ? cause.message : String(cause),
    repairHint: "Inspect the mapped browser/render diagnostics and retry after correcting the source.",
    compositionId,
    frame,
  });
  const diagnostics: readonly RemotionAdapterDiagnostic[] = [
    diagnostic,
    ...browserLogs.map(browserLogToDiagnostic),
  ];
  return new AggregateError(
    diagnostics.map((item) => new Error(`${item.code}: ${item.message}`)),
    diagnostic.message,
  );
};

const parseFrame = (value: string, field: string): bigint => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw new Error(`Remotion ${field} is invalid.`);
  return BigInt(value);
};

const safeNumber = (value: bigint, field: string): number => {
  const number = Number(value);
  if (!Number.isSafeInteger(number))
    throw new Error(`Remotion ${field} exceeds runtime safe integer limits.`);
  return number;
};

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new RemotionRenderCancelledError();
};

const isCancellation = (cause: unknown): boolean =>
  cause instanceof RemotionRenderCancelledError ||
  (cause instanceof Error && (cause.name === "AbortError" || /cancel/i.test(cause.message)));

const isUnavailableServeUrlFailure = (cause: unknown): boolean =>
  cause instanceof Error &&
  /Visited "https?:\/\/(?:localhost|127\.0\.0\.1):[0-9]+\/[^"]*" but got no response\./.test(cause.message);
