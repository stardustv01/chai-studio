import { deflateSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import {
  pinnedRemotionVersion,
  type RemotionBrowserLogRecord,
  type RemotionRuntime,
  type RemotionRuntimeComposition,
  type RemotionRuntimeRenderRangeInput,
  type RemotionRuntimeRenderStillInput,
  type RemotionSourceDescriptor,
} from "../../packages/engine-adapters/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

export class FixtureRemotionRuntime implements RemotionRuntime {
  readonly versions = {
    remotion: pinnedRemotionVersion,
    renderer: pinnedRemotionVersion,
    bundler: pinnedRemotionVersion,
    player: pinnedRemotionVersion,
  };
  readonly compositions: readonly RemotionRuntimeComposition[];
  readonly calls: string[] = [];
  failRender = false;
  failNextUnavailableRange = false;

  constructor(compositions: readonly RemotionRuntimeComposition[] = [fixtureRuntimeComposition]) {
    this.compositions = compositions;
  }

  bundle(entryPoint: string, signal: AbortSignal): Promise<string> {
    this.calls.push(`bundle:${entryPoint}`);
    if (signal.aborted) return Promise.reject(new DOMException("fixture bundle aborted", "AbortError"));
    return Promise.resolve("fixture://remotion-bundle");
  }

  discover(input: {
    readonly signal: AbortSignal;
    readonly onBrowserLog: (log: RemotionBrowserLogRecord) => void;
  }): Promise<readonly RemotionRuntimeComposition[]> {
    this.calls.push("discover");
    if (input.signal.aborted)
      return Promise.reject(new DOMException("fixture discovery aborted", "AbortError"));
    input.onBrowserLog({
      level: "info",
      text: "fixture discovered",
      sourceUrl: "webpack:///src/root.tsx",
      stack: [],
      compositionId: "discovery",
      frame: null,
      occurredAt: "2026-07-15T16:00:00.000Z",
    });
    return Promise.resolve(this.compositions);
  }

  async renderStill(input: RemotionRuntimeRenderStillInput): Promise<void> {
    this.calls.push(`still:${input.frame.toString()}`);
    if (this.failRender) {
      await writeFile(input.outputPath, "partial-still");
      throw new Error("fixture still failure");
    }
    if (input.signal.aborted) throw new DOMException("fixture still aborted", "AbortError");
    input.onBrowserLog(browserLog(input.composition.id, input.frame.toString()));
    await writeFile(input.outputPath, rgbaPng(2, 1, [255, 0, 0, 255, 0, 255, 0, 128]));
  }

  async renderRange(input: RemotionRuntimeRenderRangeInput): Promise<void> {
    this.calls.push(`range:${input.startFrame.toString()}-${input.endFrameInclusive.toString()}`);
    await writeFile(input.outputPath, "partial-range");
    if (this.failNextUnavailableRange) {
      this.failNextUnavailableRange = false;
      throw new Error('Visited "http://localhost:3000/index.html" but got no response.');
    }
    if (this.failRender || input.signal.aborted) {
      throw input.signal.aborted
        ? new DOMException("fixture range aborted", "AbortError")
        : new Error("fixture range failure");
    }
    input.onProgress({ stage: "rendering", progress: 0.5, renderedFrames: 5, encodedFrames: 2 });
    input.onProgress({ stage: "muxing", progress: 1, renderedFrames: 10, encodedFrames: 10 });
    input.onBrowserLog(browserLog(input.composition.id, input.startFrame.toString()));
    await writeFile(input.outputPath, "fixture-rendered-range");
  }

  dispose(): Promise<void> {
    return Promise.resolve();
  }
}

export const fixtureRuntimeComposition: RemotionRuntimeComposition = {
  id: "FixtureComposition",
  width: 640,
  height: 360,
  fps: 30,
  durationInFrames: 60,
  props: { title: "Calculated" },
  defaultProps: { title: "Default" },
  defaultCodec: null,
  defaultOutName: null,
  defaultVideoImageFormat: null,
  defaultPixelFormat: null,
  defaultProResProfile: null,
  defaultSampleRate: null,
};

export const sourceDescriptor = (input: {
  readonly projectRoot: string;
  readonly entryPoint: string;
  readonly componentPath: string;
  readonly assetPaths?: readonly string[];
  readonly fontPaths?: readonly string[];
  readonly generatedCodePaths?: readonly string[];
}): RemotionSourceDescriptor => ({
  sourceId: "source-remotion-fixture-0001",
  projectRoot: input.projectRoot,
  entryPoint: input.entryPoint,
  componentPath: input.componentPath,
  compositionId: "FixtureComposition",
  declaredFps: normalizeRational(30n, 1n),
  inputProps: { title: "Calculated" },
  inputPropsSchema: {
    type: "object",
    required: ["title"],
    properties: { title: { type: "string", title: "Title" } },
    additionalProperties: false,
  },
  allowDelayRender: false,
  delayTimeoutMs: 30_000,
  assetPaths: input.assetPaths ?? [],
  fontPaths: input.fontPaths ?? [],
  generatedCodePaths: input.generatedCodePaths ?? [],
  approvedNetworkResources: [],
  expectedVersions: {
    remotion: pinnedRemotionVersion,
    renderer: pinnedRemotionVersion,
    bundler: pinnedRemotionVersion,
    player: pinnedRemotionVersion,
  },
});

export const rgbaPng = (width: number, height: number, pixels: readonly number[]): Buffer => {
  return colorPng(width, height, 4, pixels);
};

export const rgbPng = (width: number, height: number, pixels: readonly number[]): Buffer => {
  return colorPng(width, height, 3, pixels);
};

const colorPng = (width: number, height: number, channels: 3 | 4, pixels: readonly number[]): Buffer => {
  const scanlines = Buffer.alloc(height * (width * channels + 1));
  for (let row = 0; row < height; row += 1) {
    const targetOffset = row * (width * channels + 1);
    scanlines[targetOffset] = 0;
    Buffer.from(pixels.slice(row * width * channels, (row + 1) * width * channels)).copy(
      scanlines,
      targetOffset + 1,
    );
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : 2;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(scanlines)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const chunk = (type: string, data: Buffer): Buffer => {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  result.write(type, 4, 4, "ascii");
  data.copy(result, 8);
  result.writeUInt32BE(0, data.length + 8);
  return result;
};

const browserLog = (compositionId: string, frame: string): RemotionBrowserLogRecord => ({
  level: "warning",
  text: "fixture browser warning",
  sourceUrl: "webpack:///src/composition.tsx",
  stack: [
    {
      functionName: "FixtureComposition",
      sourcePath: "src/composition.tsx",
      line: 10,
      column: 4,
    },
  ],
  compositionId,
  frame,
  occurredAt: "2026-07-15T16:00:00.000Z",
});
