import { bundle as bundleRemotion } from "@remotion/bundler";
import {
  getCompositions as getRemotionCompositions,
  makeCancelSignal,
  openBrowser,
  RenderInternals,
  renderMedia as renderRemotionMedia,
  renderStill as renderRemotionStill,
  type BrowserLog,
  type HeadlessBrowser,
  type RemotionServer,
} from "@remotion/renderer";
import type { VideoConfig } from "remotion/no-react";
import type { RemotionBrowserLogRecord, RemotionRuntimeComposition } from "./contracts.js";
import { pinnedRemotionVersion } from "./contracts.js";
import type {
  RemotionRuntime,
  RemotionRuntimeRenderRangeInput,
  RemotionRuntimeRenderStillInput,
} from "./runtime-contract.js";

export class NodeRemotionRuntime implements RemotionRuntime {
  readonly versions = {
    remotion: pinnedRemotionVersion,
    renderer: pinnedRemotionVersion,
    bundler: pinnedRemotionVersion,
    player: pinnedRemotionVersion,
  };
  readonly #now: () => Date;
  readonly #sourceServers = new Map<string, Promise<RemotionServer>>();
  readonly #bundleTransactions = new Map<string, Promise<void>>();
  #disposed = false;

  constructor(now: () => Date = () => new Date()) {
    this.#now = now;
  }

  async bundle(entryPoint: string, signal: AbortSignal): Promise<string> {
    if (this.#disposed) throw new Error("Remotion runtime has been disposed.");
    const previous = this.#bundleTransactions.get(entryPoint) ?? Promise.resolve();
    const transaction = previous
      .catch(() => undefined)
      .then(async () => {
        throwIfAborted(signal);
        await this.#closeSourceServer(entryPoint);
        const bundleDirectory = await bundleRemotion({ entryPoint });
        throwIfAborted(signal);
        const pendingServer = RenderInternals.prepareServer({
          webpackConfigOrServeUrl: bundleDirectory,
          port: null,
          remotionRoot: RenderInternals.findRemotionRoot(),
          offthreadVideoThreads: RenderInternals.DEFAULT_RENDER_FRAMES_OFFTHREAD_VIDEO_THREADS,
          logLevel: "info",
          indent: false,
          offthreadVideoCacheSizeInBytes: null,
          binariesDirectory: null,
          // The desktop runtime is loopback-only. Pinning IPv4 avoids a macOS localhost
          // IPv6/IPv4 resolution split where Chromium loads the shell but never reaches
          // the bundled root component, eventually timing out in getCompositions().
          forceIPv4: true,
          sampleRate: 48_000,
        });
        this.#sourceServers.set(entryPoint, pendingServer);
        try {
          const server = await pendingServer;
          throwIfAborted(signal);
          return server.serveUrl;
        } catch (cause) {
          if (this.#sourceServers.get(entryPoint) === pendingServer) this.#sourceServers.delete(entryPoint);
          const server = await pendingServer.catch(() => null);
          await server?.closeServer(true).catch(() => undefined);
          throw cause;
        }
      });
    const settled = transaction.then(
      () => undefined,
      () => undefined,
    );
    this.#bundleTransactions.set(entryPoint, settled);
    try {
      return await transaction;
    } finally {
      if (this.#bundleTransactions.get(entryPoint) === settled) this.#bundleTransactions.delete(entryPoint);
    }
  }

  async discover(input: {
    readonly serveUrl: string;
    readonly inputProps: Readonly<Record<string, unknown>>;
    readonly browserExecutable?: string;
    readonly signal: AbortSignal;
    readonly onBrowserLog: (log: RemotionBrowserLogRecord) => void;
  }): Promise<readonly RemotionRuntimeComposition[]> {
    throwIfAborted(input.signal);
    const compositions = await getRemotionCompositions(input.serveUrl, {
      inputProps: { ...input.inputProps },
      ...(input.browserExecutable === undefined ? {} : { browserExecutable: input.browserExecutable }),
      onBrowserLog: (log) => {
        input.onBrowserLog(this.#browserLog(log, "discovery", null));
      },
    });
    throwIfAborted(input.signal);
    return compositions.map((composition) => ({
      id: composition.id,
      width: composition.width,
      height: composition.height,
      fps: composition.fps,
      durationInFrames: composition.durationInFrames,
      props: asRecord(composition.props),
      defaultProps: asRecord(composition.defaultProps),
      defaultCodec: composition.defaultCodec,
      defaultOutName: composition.defaultOutName,
      defaultVideoImageFormat: composition.defaultVideoImageFormat,
      defaultPixelFormat: composition.defaultPixelFormat,
      defaultProResProfile: composition.defaultProResProfile,
      defaultSampleRate: composition.defaultSampleRate,
    }));
  }

  async renderStill(input: RemotionRuntimeRenderStillInput): Promise<void> {
    const cancellation = cancellationFor(input.signal);
    try {
      await this.#withBrowser(input.browserExecutable, input.signal, (browser) =>
        renderRemotionStill({
          serveUrl: input.serveUrl,
          composition: toVideoConfig(input.composition),
          inputProps: { ...input.inputProps },
          output: input.outputPath,
          frame: input.frame,
          imageFormat: input.imageFormat,
          browserExecutable: input.browserExecutable,
          cancelSignal: cancellation.cancelSignal,
          puppeteerInstance: browser,
          overwrite: true,
          onBrowserLog: (log) => {
            input.onBrowserLog(this.#browserLog(log, input.composition.id, input.frame.toString()));
          },
        }),
      );
    } finally {
      cancellation.dispose();
    }
  }

  async renderRange(input: RemotionRuntimeRenderRangeInput): Promise<void> {
    const cancellation = cancellationFor(input.signal);
    try {
      await this.#withBrowser(input.browserExecutable, input.signal, (browser) =>
        renderRemotionMedia({
          serveUrl: input.serveUrl,
          composition: toVideoConfig(input.composition),
          inputProps: { ...input.inputProps },
          outputLocation: input.outputPath,
          codec: input.codec,
          frameRange: [input.startFrame, input.endFrameInclusive],
          browserExecutable: input.browserExecutable,
          colorSpace: input.colorSpace,
          cancelSignal: cancellation.cancelSignal,
          puppeteerInstance: browser,
          concurrency: 1,
          disallowParallelEncoding: true,
          overwrite: true,
          onProgress: (progress) => {
            input.onProgress({
              stage:
                progress.stitchStage === "muxing"
                  ? "muxing"
                  : progress.progress < 1
                    ? "rendering"
                    : "encoding",
              progress: progress.progress,
              renderedFrames: progress.renderedFrames,
              encodedFrames: progress.encodedFrames,
            });
          },
          onBrowserLog: (log) => {
            input.onBrowserLog(this.#browserLog(log, input.composition.id, null));
          },
        }),
      );
    } finally {
      cancellation.dispose();
    }
  }

  async dispose(): Promise<void> {
    if (this.#disposed) return;
    this.#disposed = true;
    const pendingServers = [...this.#sourceServers.values()];
    this.#sourceServers.clear();
    const closeResults = await Promise.allSettled([
      ...pendingServers.map((pending) =>
        pending.then(
          (server) => server.closeServer(true),
          () => undefined,
        ),
      ),
    ]);
    const failures: unknown[] = [];
    for (const result of closeResults) {
      if (result.status === "rejected") failures.push(result.reason as unknown);
    }
    if (failures.length > 0) throw new AggregateError(failures, "Could not close Remotion browsers.");
  }

  #browserLog(log: BrowserLog, compositionId: string, frame: string | null): RemotionBrowserLogRecord {
    const level =
      log.type === "error"
        ? "error"
        : log.type === "warning"
          ? "warning"
          : log.type === "verbose" || log.type === "debug" || log.type === "trace"
            ? "verbose"
            : "info";
    return {
      level,
      text: log.text,
      sourceUrl: log.stackTrace[0]?.url ?? null,
      stack: log.stackTrace.map((location) => ({
        functionName: null,
        sourcePath: location.url ?? "unknown",
        line: location.lineNumber ?? null,
        column: location.columnNumber ?? null,
      })),
      compositionId,
      frame,
      occurredAt: this.#now().toISOString(),
    };
  }

  async #withBrowser<T>(
    browserExecutable: string | undefined,
    signal: AbortSignal,
    operation: (browser: HeadlessBrowser) => Promise<T>,
  ): Promise<T> {
    if (this.#disposed) throw new Error("Remotion runtime has been disposed.");
    throwIfAborted(signal);
    const browser = await openBrowser("chrome", {
      ...(browserExecutable === undefined ? {} : { browserExecutable }),
    });
    try {
      throwIfAborted(signal);
      const result = await operation(browser);
      await browser.close({ silent: true });
      return result;
    } catch (cause) {
      await browser.close({ silent: true }).catch(() => undefined);
      throw cause;
    }
  }

  async #closeSourceServer(entryPoint: string): Promise<void> {
    const pending = this.#sourceServers.get(entryPoint);
    if (pending === undefined) return;
    this.#sourceServers.delete(entryPoint);
    const server = await pending.catch(() => null);
    await server?.closeServer(true).catch(() => undefined);
  }
}

const cancellationFor = (
  signal: AbortSignal,
): Readonly<{ cancelSignal: ReturnType<typeof makeCancelSignal>["cancelSignal"]; dispose: () => void }> => {
  const cancellation = makeCancelSignal();
  const cancel = () => {
    cancellation.cancel();
  };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return {
    cancelSignal: cancellation.cancelSignal,
    dispose: () => {
      signal.removeEventListener("abort", cancel);
    },
  };
};

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new DOMException("Remotion operation was cancelled.", "AbortError");
};

const asRecord = (value: unknown): Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : {};

const toVideoConfig = (composition: RemotionRuntimeComposition): VideoConfig => ({
  ...composition,
  props: { ...composition.props },
  defaultProps: { ...composition.defaultProps },
  defaultCodec: composition.defaultCodec as VideoConfig["defaultCodec"],
  defaultVideoImageFormat: composition.defaultVideoImageFormat as VideoConfig["defaultVideoImageFormat"],
  defaultPixelFormat: composition.defaultPixelFormat as VideoConfig["defaultPixelFormat"],
  defaultProResProfile: composition.defaultProResProfile as VideoConfig["defaultProResProfile"],
});
