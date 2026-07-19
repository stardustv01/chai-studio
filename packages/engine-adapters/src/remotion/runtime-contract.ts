import type {
  RemotionBrowserLogRecord,
  RemotionRangeProgress,
  RemotionRuntimeComposition,
} from "./contracts.js";

export interface RemotionRuntimeRenderStillInput {
  readonly serveUrl: string;
  readonly composition: RemotionRuntimeComposition;
  readonly inputProps: Readonly<Record<string, unknown>>;
  readonly outputPath: string;
  readonly frame: number;
  readonly imageFormat: "png" | "jpeg" | "webp" | "pdf";
  readonly browserExecutable: string;
  readonly signal: AbortSignal;
  readonly onBrowserLog: (log: RemotionBrowserLogRecord) => void;
}

export interface RemotionRuntimeRenderRangeInput {
  readonly serveUrl: string;
  readonly composition: RemotionRuntimeComposition;
  readonly inputProps: Readonly<Record<string, unknown>>;
  readonly outputPath: string;
  readonly startFrame: number;
  readonly endFrameInclusive: number;
  readonly codec: "h264" | "h265" | "vp8" | "vp9" | "prores";
  readonly browserExecutable: string;
  readonly colorSpace: "default" | "bt709" | "bt2020-ncl";
  readonly signal: AbortSignal;
  readonly onProgress: (progress: RemotionRangeProgress) => void;
  readonly onBrowserLog: (log: RemotionBrowserLogRecord) => void;
}

export interface RemotionRuntime {
  readonly versions: Readonly<{
    remotion: string;
    renderer: string;
    bundler: string;
    player: string;
  }>;
  bundle(entryPoint: string, signal: AbortSignal): Promise<string>;
  discover(input: {
    readonly serveUrl: string;
    readonly inputProps: Readonly<Record<string, unknown>>;
    readonly browserExecutable?: string;
    readonly signal: AbortSignal;
    readonly onBrowserLog: (log: RemotionBrowserLogRecord) => void;
  }): Promise<readonly RemotionRuntimeComposition[]>;
  renderStill(input: RemotionRuntimeRenderStillInput): Promise<void>;
  renderRange(input: RemotionRuntimeRenderRangeInput): Promise<void>;
  dispose(): Promise<void>;
}
