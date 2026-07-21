import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeRemotionPng } from "../../packages/engine-adapters/src/index.js";
import { serializeBigInt, type TimelineClip } from "../../packages/schema/src/index.js";
import { renderNativeCompositionLayer } from "../../apps/studio-server/src/native-composition-runtime.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("native composition manifest runtime", () => {
  it("renders a manifest-bound Remotion source through managed isolated Chromium", async () => {
    const projectRoot = process.cwd();
    const directory = await mkdtemp(path.join(projectRoot, ".chai-native-runtime-"));
    directories.push(directory);
    const manifestPath = path.join(directory, "remotion.chai-composition.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        engine: "remotion",
        projectRoot: "spikes/milestone-0",
        entryPoint: "fixtures/remotion/index.ts",
        componentPath: "fixtures/remotion/spike-composition.tsx",
        compositionId: "ChaiMilestone0",
        declaredFps: { numerator: "30", denominator: "1" },
        inputProps: {},
        inputPropsSchema: null,
        allowDelayRender: false,
        delayTimeoutMs: 30_000,
        assetPaths: [],
        fontPaths: [],
        generatedCodePaths: [],
        approvedNetworkResources: [],
      }),
    );
    const outputDirectory = path.join(directory, "output");
    const clip: TimelineClip = {
      id: "clip-native-runtime-remotion-0001",
      assetId: "asset-native-runtime-remotion-0001",
      engine: "remotion",
      startFrame: serializeBigInt(0n),
      durationFrames: serializeBigInt(1n),
      sourceInFrame: serializeBigInt(30n),
      sourceDurationFrames: serializeBigInt(1n),
      capability: "native",
      audioBusId: null,
      name: "Remotion exact frame",
    };
    const result = await renderNativeCompositionLayer({
      projectRoot,
      manifestPath: path.relative(projectRoot, manifestPath),
      clip,
      timelineStart: 0n,
      timelineEnd: 1n,
      outputDirectory,
      trustClass: "trusted-authored",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      engine: "remotion",
      compositionId: "ChaiMilestone0",
      width: 640,
      height: 360,
      fps: { numerator: "30", denominator: "1" },
      durationFrames: "60",
    });
    expect(result.browserVersion).toMatch(/^[0-9]+(?:\.[0-9]+){1,3}$/u);
    const bytes = await readFile(path.join(outputDirectory, "frame-00000001.png"));
    const pixels = normalizeRemotionPng(bytes);
    expect(pixels).toMatchObject({ width: 640, height: 360 });
    expect(pixels.normalizedPixelHash).toMatch(/^[a-f0-9]{64}$/);
  }, 60_000);

  it("renders a manifest-bound HyperFrames source through managed isolated Chromium", async () => {
    const projectRoot = process.cwd();
    const directory = await mkdtemp(path.join(projectRoot, ".chai-native-runtime-"));
    directories.push(directory);
    const manifestPath = path.join(directory, "hyperframes.chai-composition.json");
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: "1.0.0",
        engine: "hyperframes",
        projectRoot: "spikes/milestone-0/fixtures/hyperframes",
        entryFile: "index.html",
        compositionId: "chai-m0-hyperframes",
        declaredFps: { numerator: "30", denominator: "1" },
        variableOverrides: {},
        approvedNetworkResources: [],
      }),
    );
    const outputDirectory = path.join(directory, "output");
    const clip: TimelineClip = {
      id: "clip-native-runtime-hyperframes-0001",
      assetId: "asset-native-runtime-hyperframes-0001",
      engine: "hyperframes",
      startFrame: serializeBigInt(0n),
      durationFrames: serializeBigInt(1n),
      sourceInFrame: serializeBigInt(54n),
      sourceDurationFrames: serializeBigInt(1n),
      capability: "native",
      audioBusId: null,
      name: "HyperFrames exact frame",
    };
    const result = await renderNativeCompositionLayer({
      projectRoot,
      manifestPath: path.relative(projectRoot, manifestPath),
      clip,
      timelineStart: 0n,
      timelineEnd: 1n,
      outputDirectory,
      trustClass: "trusted-authored",
      signal: new AbortController().signal,
    });
    expect(result).toMatchObject({
      engine: "hyperframes",
      compositionId: "chai-m0-hyperframes",
      width: 640,
      height: 360,
      fps: { numerator: "30", denominator: "1" },
      durationFrames: "60",
    });
    expect(result.browserVersion).toMatch(/^[0-9]+(?:\.[0-9]+){1,3}$/u);
    const bytes = await readFile(path.join(outputDirectory, "frame-00000001.png"));
    const pixels = normalizeRemotionPng(bytes);
    expect(pixels).toMatchObject({ width: 640, height: 360 });
    expect(pixels.normalizedPixelHash).toMatch(/^[a-f0-9]{64}$/);
  }, 180_000);
});
