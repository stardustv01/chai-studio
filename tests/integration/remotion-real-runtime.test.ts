import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectRemotionDependencies,
  discoverRemotionCompositions,
  NodeRemotionRuntime,
  pinnedRemotionVersion,
  RemotionRenderer,
  type RemotionSourceDescriptor,
} from "../../packages/engine-adapters/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";
import { isolatedRemotionExecutable, isolatedRemotionIdentity } from "../../scripts/browser-isolation.mjs";

const directories: string[] = [];
const runtimes: NodeRemotionRuntime[] = [];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const spikeRoot = path.join(root, "spikes/milestone-0");
const browserExecutable = isolatedRemotionExecutable;

afterEach(async () => {
  await Promise.all(runtimes.splice(0).map((runtime) => runtime.dispose()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P10 real pinned Remotion runtime", () => {
  it("discovers the production fixture and renders the exact same normalized frame twice", async () => {
    await access(browserExecutable);
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "chai-remotion-real-"));
    directories.push(outputRoot);
    const runtime = new NodeRemotionRuntime(() => new Date("2026-07-15T16:00:00.000Z"));
    runtimes.push(runtime);
    expect(runtime.versions).toEqual({
      remotion: pinnedRemotionVersion,
      renderer: pinnedRemotionVersion,
      bundler: pinnedRemotionVersion,
      player: pinnedRemotionVersion,
    });
    const discovery = await discoverRemotionCompositions({
      source,
      runtime,
      browserExecutable,
      signal: new AbortController().signal,
    });
    expect(discovery.valid, JSON.stringify(discovery.diagnostics, null, 2)).toBe(true);
    expect(discovery.compositions.map((composition) => composition.compositionId)).toEqual([
      "ChaiMilestone0",
      "ChaiMixedFinish",
    ]);
    const composition = discovery.selectedComposition;
    if (composition === null || discovery.serveUrl === null)
      throw new Error("Real fixture discovery failed.");
    expect(composition).toMatchObject({
      width: 640,
      height: 360,
      fps: { numerator: "30", denominator: "1" },
      durationFrames: "60",
    });
    const dependencies = await collectRemotionDependencies(source, composition.compositionId);
    const renderer = new RemotionRenderer(runtime);
    const common = {
      source,
      composition,
      serveUrl: discovery.serveUrl,
      frame: "30",
      imageFormat: "png" as const,
      environment: {
        strictEnvironmentFingerprint: "5df774240ad4ed6518f1432f633df8aa2e70261db44b8e6cecf154cf62902281",
        browserExecutable,
        browserIdentity: isolatedRemotionIdentity,
        colorContractId: "chai-remotion-rgba8-straight-v1",
        colorSpace: "default" as const,
        alphaMode: "straight" as const,
        settingsHash: "remotion-png-frame30-default-color-v1",
      },
      dependencySet: dependencies,
      signal: new AbortController().signal,
    };
    const first = await renderer.renderStill({
      ...common,
      outputPath: path.join(outputRoot, "frame-30-a.png"),
    });
    const second = await renderer.renderStill({
      ...common,
      outputPath: path.join(outputRoot, "frame-30-b.png"),
    });
    expect(first.artifactHash).toBe("6b9ea98f4562df53578fb9817c46d7d07c93a649ed7f8a56f351036d6c537e04");
    expect(second.artifactHash).toBe(first.artifactHash);
    expect(second.normalizedPixelHash).toBe(first.normalizedPixelHash);
    expect(first.normalizedPixelHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.dependencyGraphHash).toBe(dependencies.dependencyGraphHash);

    const progress: number[] = [];
    const rangeOutput = path.join(outputRoot, "frames-0-5.mp4");
    const range = await renderer.renderRange({
      source,
      composition,
      serveUrl: discovery.serveUrl,
      startFrame: "0",
      endFrameExclusive: "6",
      outputPath: rangeOutput,
      codec: "h264",
      environment: common.environment,
      dependencySet: dependencies,
      signal: new AbortController().signal,
      onProgress: (update) => progress.push(update.progress),
    });
    await access(rangeOutput);
    expect(range).toMatchObject({
      kind: "remotion-range",
      range: { startFrame: "0", endFrameExclusive: "6" },
      codec: "h264",
      dependencyGraphHash: dependencies.dependencyGraphHash,
    });
    expect(range.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(progress.length).toBeGreaterThan(0);
    expect(progress.at(-1)).toBe(1);
  }, 60_000);
});

const source: RemotionSourceDescriptor = {
  sourceId: "source-remotion-milestone0-0001",
  projectRoot: spikeRoot,
  entryPoint: path.join(spikeRoot, "fixtures/remotion/index.ts"),
  componentPath: path.join(spikeRoot, "fixtures/remotion/spike-composition.tsx"),
  compositionId: "ChaiMilestone0",
  declaredFps: normalizeRational(30n, 1n),
  inputProps: {},
  inputPropsSchema: null,
  allowDelayRender: false,
  delayTimeoutMs: 30_000,
  assetPaths: [],
  fontPaths: [],
  generatedCodePaths: [],
  approvedNetworkResources: [],
  expectedVersions: {
    remotion: pinnedRemotionVersion,
    renderer: pinnedRemotionVersion,
    bundler: pinnedRemotionVersion,
    player: pinnedRemotionVersion,
  },
};
