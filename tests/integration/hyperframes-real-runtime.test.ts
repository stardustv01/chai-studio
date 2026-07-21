import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectHyperframesDependencies,
  discoverHyperframesCompositions,
  HyperframesCliRuntime,
  HyperframesRenderer,
  normalizeRemotionPng,
  pinnedHyperframesVersion,
  validateHyperframesSource,
  type HyperframesSourceDescriptor,
} from "../../packages/engine-adapters/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";
import { isolatedEngineExecutable, isolatedEngineIdentity } from "../../scripts/browser-isolation.mjs";

const directories: string[] = [];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const projectRoot = path.join(root, "spikes/milestone-0/fixtures/hyperframes");
const executable = path.join(root, "packages/engine-adapters/node_modules/.bin/hyperframes");
const browserExecutable = isolatedEngineExecutable;

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P11 real pinned HyperFrames runtime", () => {
  it("discovers, checks, captures exact boundary frames, and renders an exact range", async () => {
    await access(executable);
    await access(browserExecutable);
    const outputRoot = await mkdtemp(path.join(os.tmpdir(), "chai-hyperframes-real-"));
    directories.push(outputRoot);
    const runtime = new HyperframesCliRuntime(executable, browserExecutable);
    expect(runtime.version).toBe(pinnedHyperframesVersion);
    const discovery = await discoverHyperframesCompositions({
      source,
      runtime,
      signal: new AbortController().signal,
    });
    expect(discovery).toMatchObject({
      valid: true,
      selectedComposition: {
        compositionId: "chai-m0-hyperframes",
        width: 640,
        height: 360,
        durationFrames: "60",
        frameAdapters: [{ kind: "gsap", seekable: true }],
      },
    });
    const composition = discovery.selectedComposition;
    if (composition === null) throw new Error("Real HyperFrames fixture discovery failed.");
    const validation = await validateHyperframesSource({
      source,
      composition,
      runtime,
      signal: new AbortController().signal,
    });
    expect(validation, JSON.stringify(validation.diagnostics, null, 2)).toMatchObject({ valid: true });
    expect(validation.seekable).toBe(true);
    const dependencies = await collectHyperframesDependencies(source, composition.compositionId);
    expect(dependencies.entries.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining(["html", "script", "font", "adapter", "package", "variables"]),
    );
    const renderer = new HyperframesRenderer(runtime, "/opt/homebrew/bin/ffmpeg");
    const common = {
      source,
      composition,
      environment: {
        strictEnvironmentFingerprint: `strict-hyperframes-0.7.58-${isolatedEngineIdentity}-ffmpeg7.1.1`,
        browserIdentity: isolatedEngineIdentity,
        browserExecutable,
        colorContractId: "chai-hyperframes-rgba8-straight-v1",
        colorSpace: "srgb" as const,
        alphaMode: "straight" as const,
        settingsHash: "hyperframes-png-sequence-draft-strict-software-v1",
      },
      dependencySet: dependencies,
      signal: new AbortController().signal,
    };
    const frame54a = await renderer.renderStill({
      ...common,
      frame: "54",
      outputPath: path.join(outputRoot, "frame-54-a.png"),
    });
    const frame54b = await renderer.renderStill({
      ...common,
      frame: "54",
      outputPath: path.join(outputRoot, "frame-54-b.png"),
    });
    // PNG container bytes can vary across pinned browser builds even when decoded pixels are identical.
    // Require a valid content hash, then prove byte and normalized-pixel determinism within this runtime.
    expect(frame54a.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(frame54b.artifactHash).toBe(frame54a.artifactHash);
    expect(frame54b.normalizedPixelHash).toBe(frame54a.normalizedPixelHash);

    const frame57 = await renderer.renderStill({
      ...common,
      frame: "57",
      outputPath: path.join(outputRoot, "frame-57.png"),
    });
    const acceptedFrame57 = normalizeRemotionPng(
      await readFile(path.join(root, "spikes/milestone-0/fixtures/preview/assets/hyperframes/frame-57.png")),
    );
    const observedFrame57 = normalizeRemotionPng(await readFile(frame57.outputPath));
    expect(observedFrame57.width).toBe(acceptedFrame57.width);
    expect(observedFrame57.height).toBe(acceptedFrame57.height);
    // Exact hashes remain mandatory for repeat renders in one strict environment (frame 54 above).
    // The reviewed golden crosses macOS rasterizers, so enforce a tight normalized-RMSE budget instead.
    expect(normalizedRmse(observedFrame57.rgba, acceptedFrame57.rgba)).toBeLessThanOrEqual(0.02);

    const progress: string[] = [];
    const outputPath = path.join(outputRoot, "frames-54-59.mp4");
    const range = await renderer.renderRange({
      ...common,
      startFrame: "54",
      endFrameExclusive: "60",
      outputPath,
      codec: "h264",
      onProgress: (update) => progress.push(update.stage),
    });
    await access(outputPath);
    expect(range).toMatchObject({
      range: { startFrame: "54", endFrameExclusive: "60" },
      codec: "h264",
      dependencyGraphHash: dependencies.dependencyGraphHash,
      trustClass: "trusted-authored",
    });
    expect(range.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(progress).toEqual(expect.arrayContaining(["validating", "capturing", "encoding", "committing"]));
  }, 180_000);
});

const normalizedRmse = (observed: Uint8Array, expected: Uint8Array): number => {
  if (observed.length !== expected.length || observed.length === 0) {
    throw new Error("Normalized pixel comparison requires equal, non-empty RGBA buffers.");
  }
  let squaredError = 0;
  for (let index = 0; index < observed.length; index += 1) {
    const delta = ((observed[index] ?? 0) - (expected[index] ?? 0)) / 255;
    squaredError += delta * delta;
  }
  return Math.sqrt(squaredError / observed.length);
};

const source: HyperframesSourceDescriptor = {
  sourceId: "source-hyperframes-milestone0-0001",
  projectRoot,
  entryFile: path.join(projectRoot, "index.html"),
  compositionId: "chai-m0-hyperframes",
  declaredFps: normalizeRational(30n, 1n),
  variableOverrides: {},
  trustClass: "trusted-authored",
  approvedNetworkResources: [],
  expectedVersion: pinnedHyperframesVersion,
};
