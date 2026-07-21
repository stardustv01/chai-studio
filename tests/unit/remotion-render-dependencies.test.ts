import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  collectRemotionDependencies,
  generateRemotionFinishingComposition,
  normalizeRemotionPng,
  parseRemotionSourceStack,
  RemotionRenderCancelledError,
  RemotionRenderer,
  type RemotionCompositionDescriptor,
  type RemotionRenderEnvironment,
} from "../../packages/engine-adapters/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";
import {
  FixtureRemotionRuntime,
  rgbaPng,
  rgbPng,
  sourceDescriptor,
} from "../fixtures/remotion-adapter-fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P10 Remotion render, dependency, diagnostic, and finishing contracts", () => {
  it("collects a content-addressed selective dependency graph", async () => {
    const fixture = await dependencyFixture();
    const dependencies = await collectRemotionDependencies(fixture.source, "FixtureComposition");
    expect(dependencies.dependencyGraphHash).toMatch(/^[a-f0-9]{64}$/);
    expect(dependencies.entries.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        "source-module",
        "input-props",
        "media",
        "font",
        "runtime-package",
        "generated-code",
      ]),
    );
    expect(
      dependencies.entries.filter((entry) => entry.kind === "source-module").map((entry) => entry.identity),
    ).toEqual(["composition.tsx", "helper.ts", "index.ts"]);
    const second = await collectRemotionDependencies(fixture.source, "FixtureComposition");
    expect(second).toEqual(dependencies);
    await writeFile(fixture.helperPath, "export const accent = '#ff00ff';\n");
    expect(
      (await collectRemotionDependencies(fixture.source, "FixtureComposition")).dependencyGraphHash,
    ).not.toBe(dependencies.dependencyGraphHash);
  });

  it("renders repeatable PNG stills with normalized pixel identity and full environment identity", async () => {
    const fixture = await dependencyFixture();
    const runtime = new FixtureRemotionRuntime();
    const renderer = new RemotionRenderer(runtime);
    const dependencySet = await collectRemotionDependencies(fixture.source, "FixtureComposition");
    const first = await renderer.renderStill({
      source: fixture.source,
      composition,
      serveUrl: "fixture://bundle",
      frame: "30",
      outputPath: path.join(fixture.projectRoot, "first.png"),
      imageFormat: "png",
      environment,
      dependencySet,
      signal: new AbortController().signal,
    });
    const second = await renderer.renderStill({
      source: fixture.source,
      composition,
      serveUrl: "fixture://bundle",
      frame: "30",
      outputPath: path.join(fixture.projectRoot, "second.png"),
      imageFormat: "png",
      environment,
      dependencySet,
      signal: new AbortController().signal,
    });
    expect(first).toMatchObject({
      frame: "30",
      compositorId: "remotion-renderer",
      compositorVersion: "4.0.489",
      dependencyGraphHash: dependencySet.dependencyGraphHash,
      strictEnvironmentFingerprint: environment.strictEnvironmentFingerprint,
      settingsHash: environment.settingsHash,
      colorContractId: environment.colorContractId,
      alphaMode: "straight",
      browserIdentity: environment.browserIdentity,
    });
    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.normalizedPixelHash).toBe(second.normalizedPixelHash);
    expect(first.diagnostics).toEqual([
      expect.objectContaining({
        code: "remotion.browser.warning",
        compositionId: "FixtureComposition",
        frame: "30",
      }),
    ]);
  });

  it("reports range progress and removes partial outputs on cancellation", async () => {
    const fixture = await dependencyFixture();
    const runtime = new FixtureRemotionRuntime();
    const renderer = new RemotionRenderer(runtime);
    const dependencySet = await collectRemotionDependencies(fixture.source, "FixtureComposition");
    const progress: string[] = [];
    const artifact = await renderer.renderRange({
      source: fixture.source,
      composition,
      serveUrl: "fixture://bundle",
      startFrame: "10",
      endFrameExclusive: "20",
      outputPath: path.join(fixture.projectRoot, "range.mp4"),
      codec: "h264",
      environment,
      dependencySet,
      signal: new AbortController().signal,
      onProgress: (update) => progress.push(`${update.stage}:${update.progress.toString()}`),
    });
    expect(artifact).toMatchObject({
      range: { startFrame: "10", endFrameExclusive: "20" },
      codec: "h264",
      compositorVersion: "4.0.489",
    });
    expect(progress).toEqual(["rendering:0.5", "muxing:1"]);

    const canceledOutput = path.join(fixture.projectRoot, "canceled.mp4");
    const controller = new AbortController();
    controller.abort();
    await expect(
      renderer.renderRange({
        source: fixture.source,
        composition,
        serveUrl: "fixture://bundle",
        startFrame: "0",
        endFrameExclusive: "10",
        outputPath: canceledOutput,
        codec: "h264",
        environment,
        dependencySet,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(RemotionRenderCancelledError);
    await expect(access(canceledOutput)).rejects.toThrow();
  });

  it("re-bundles once when an idle Remotion serve URL disappears before range progress", async () => {
    const fixture = await dependencyFixture();
    const runtime = new FixtureRemotionRuntime();
    runtime.failNextUnavailableRange = true;
    const renderer = new RemotionRenderer(runtime);
    const dependencySet = await collectRemotionDependencies(fixture.source, "FixtureComposition");
    const artifact = await renderer.renderRange({
      source: fixture.source,
      composition,
      serveUrl: "http://localhost:3000",
      startFrame: "10",
      endFrameExclusive: "20",
      outputPath: path.join(fixture.projectRoot, "recovered-range.mp4"),
      codec: "h264",
      environment,
      dependencySet,
      signal: new AbortController().signal,
    });

    expect(artifact.artifactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(runtime.calls).toEqual(["range:10-19", `bundle:${fixture.source.entryPoint}`, "range:10-19"]);
  });

  it("normalizes RGB and RGBA pixels, source maps browser stacks, and generates deterministic finishing code", () => {
    const pixels = normalizeRemotionPng(rgbaPng(1, 1, [12, 34, 56, 128]));
    expect([...pixels.rgba]).toEqual([12, 34, 56, 128]);
    expect(pixels.normalizedPixelHash).toMatch(/^[a-f0-9]{64}$/);
    const opaquePixels = normalizeRemotionPng(rgbPng(1, 1, [12, 34, 56]));
    expect([...opaquePixels.rgba]).toEqual([12, 34, 56, 255]);
    expect(opaquePixels.normalizedPixelHash).not.toBe(pixels.normalizedPixelHash);
    expect(parseRemotionSourceStack("Error\n    at Render (webpack:///src/composition.tsx:12:8)")).toEqual([
      {
        functionName: "Render",
        sourcePath: "/src/composition.tsx",
        line: 12,
        column: 8,
      },
    ]);

    const input = {
      compositionId: "ChaiFinishFixture",
      width: 1920,
      height: 1080,
      fps: normalizeRational(30_000n, 1_001n),
      durationFrames: "300",
      layers: [
        {
          layerId: "layer-hyperframes-0001",
          artifactPath: "cache/hyperframes.mov",
          startFrame: "60",
          durationFrames: "120",
          zIndex: 10,
          hasAlpha: false,
        },
        {
          layerId: "layer-overlay-0001",
          artifactPath: "cache/overlay.png",
          startFrame: "0",
          durationFrames: "300",
          zIndex: 20,
          hasAlpha: true,
        },
      ],
    } as const;
    const first = generateRemotionFinishingComposition(input);
    const second = generateRemotionFinishingComposition(input);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      interfaceVersion: "chai-finishing-compositor.v1",
      compositionId: "ChaiFinishFixture",
      dependencies: ["cache/hyperframes.mov", "cache/overlay.png"],
    });
    expect(first.sourceCode).toContain("OffthreadVideo");
    expect(first.sourceCode).toContain("Img");
    expect(first.sourceCode).not.toContain("ChaiProjectDocument");

    expect(() =>
      generateRemotionFinishingComposition({
        ...input,
        durationFrames: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
      }),
    ).toThrow(/safe JavaScript frame range/);
    expect(() =>
      generateRemotionFinishingComposition({
        ...input,
        layers: [
          {
            ...input.layers[0],
            startFrame: (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(),
          },
        ],
      }),
    ).toThrow(/safe JavaScript frame range/);
  });
});

const composition: RemotionCompositionDescriptor = {
  compositionId: "FixtureComposition",
  sourceId: "source-remotion-fixture-0001",
  componentPath: "composition.tsx",
  width: 640,
  height: 360,
  fps: normalizeRational(30n, 1n),
  durationFrames: "60",
  defaultProps: { title: "Default" },
  calculatedProps: { title: "Calculated" },
  inputPropsSchema: {
    type: "object",
    required: ["title"],
    properties: { title: { type: "string" } },
    additionalProperties: false,
  },
  adapterVersion: "4.0.489",
};

const environment: RemotionRenderEnvironment = {
  strictEnvironmentFingerprint: "strict-remotion-fixture-environment-0001",
  browserExecutable: "/isolated/playwright/chromium-fixture",
  browserIdentity: "Playwright Chromium fixture",
  colorContractId: "chai-remotion-rgba8-straight-v1",
  colorSpace: "bt709",
  alphaMode: "straight",
  settingsHash: "settings-remotion-fixture-0001",
};

const dependencyFixture = async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chai-remotion-dependencies-"));
  directories.push(projectRoot);
  const entryPoint = path.join(projectRoot, "index.ts");
  const componentPath = path.join(projectRoot, "composition.tsx");
  const helperPath = path.join(projectRoot, "helper.ts");
  const assetPath = path.join(projectRoot, "asset.png");
  const fontPath = path.join(projectRoot, "font.woff2");
  const generatedPath = path.join(projectRoot, "generated.ts");
  await writeFile(entryPoint, 'export {FixtureComposition} from "./composition";\n');
  await writeFile(
    componentPath,
    'import {accent} from "./helper"; export const FixtureComposition = () => accent;\n',
  );
  await writeFile(helperPath, "export const accent = '#00ffff';\n");
  await writeFile(assetPath, "asset");
  await writeFile(fontPath, "font");
  await writeFile(generatedPath, "export const generated = true;\n");
  return {
    projectRoot,
    entryPoint,
    componentPath,
    helperPath,
    source: sourceDescriptor({
      projectRoot,
      entryPoint,
      componentPath,
      assetPaths: [assetPath],
      fontPaths: [fontPath],
      generatedCodePaths: [generatedPath],
    }),
  };
};
