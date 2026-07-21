import { access, copyFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertHyperframesCachePolicy,
  collectHyperframesDependencies,
  discoverHyperframesCompositions,
  HyperframesRenderCancelledError,
  HyperframesRenderer,
  HyperframesWorkerRouter,
  selectHyperframesWorkerPolicy,
  type HyperframesRangeEncoder,
  type HyperframesRenderEnvironment,
} from "../../packages/engine-adapters/src/index.js";
import {
  FixtureHyperframesRuntime,
  fixtureHtml,
  hyperframesSource,
} from "../fixtures/hyperframes-adapter-fixtures.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("P11 HyperFrames render, dependency, and trust contracts", () => {
  it("collects selective HTML/CSS/media/font/script/adapter/package/shader/data/variable dependencies", async () => {
    const fixture = await dependencyFixture();
    const dependencies = await collectHyperframesDependencies(fixture.source, "chai-fixture");
    expect(dependencies.dependencyGraphHash).toMatch(/^[a-f0-9]{64}$/);
    expect(dependencies.entries.map((entry) => entry.kind)).toEqual(
      expect.arrayContaining([
        "html",
        "css",
        "media",
        "font",
        "script",
        "adapter",
        "package",
        "shader",
        "data",
        "variables",
      ]),
    );
    const second = await collectHyperframesDependencies(fixture.source, "chai-fixture");
    expect(second).toEqual(dependencies);
    await writeFile(path.join(fixture.projectRoot, "data.json"), '{"changed":true}\n');
    expect(
      (await collectHyperframesDependencies(fixture.source, "chai-fixture")).dependencyGraphHash,
    ).not.toBe(dependencies.dependencyGraphHash);
  });

  it("renders repeatable exact stills and range artifacts with strict identities", async () => {
    const fixture = await dependencyFixture();
    const runtime = new FixtureHyperframesRuntime();
    const composition = await discoverComposition(fixture.source, runtime);
    const dependencies = await collectHyperframesDependencies(fixture.source, composition.compositionId);
    const encoderCalls: string[] = [];
    const encoder: HyperframesRangeEncoder = async (input) => {
      encoderCalls.push(
        `${input.startFrame.toString()}-${input.endFrameExclusive.toString()}:${input.codec}`,
      );
      await copyFile(input.inputPath, input.outputPath);
    };
    const renderer = new HyperframesRenderer(runtime, "ffmpeg", encoder);
    const first = await renderer.renderStill({
      source: fixture.source,
      composition,
      frame: "30",
      outputPath: path.join(fixture.projectRoot, "still-a.png"),
      environment,
      dependencySet: dependencies,
      signal: new AbortController().signal,
    });
    const second = await renderer.renderStill({
      source: fixture.source,
      composition,
      frame: "30",
      outputPath: path.join(fixture.projectRoot, "still-b.png"),
      environment,
      dependencySet: dependencies,
      signal: new AbortController().signal,
    });
    expect(first.artifactHash).toBe(second.artifactHash);
    expect(first.normalizedPixelHash).toBe(second.normalizedPixelHash);
    expect(first).toMatchObject({
      compositorVersion: "0.7.58",
      dependencyGraphHash: dependencies.dependencyGraphHash,
      trustClass: "trusted-authored",
      cacheNamespace: dependencies.cacheNamespace,
    });
    const progress: string[] = [];
    const range = await renderer.renderRange({
      source: fixture.source,
      composition,
      startFrame: "10",
      endFrameExclusive: "20",
      outputPath: path.join(fixture.projectRoot, "range.mp4"),
      codec: "h264",
      environment,
      dependencySet: dependencies,
      signal: new AbortController().signal,
      onProgress: (update) => progress.push(`${update.stage}:${update.progress.toString()}`),
    });
    expect(range).toMatchObject({
      range: { startFrame: "10", endFrameExclusive: "20" },
      codec: "h264",
      cacheNamespace: dependencies.cacheNamespace,
    });
    expect(runtime.calls.filter((call) => call.startsWith("render:"))).toEqual(
      expect.arrayContaining([
        expect.stringContaining("--format png-sequence --quality draft --workers 1"),
        expect.stringContaining("--no-browser-gpu"),
      ]),
    );
    expect(encoderCalls).toEqual(["10-20:h264"]);
    expect(progress).toEqual(expect.arrayContaining(["validating:0", "encoding:0", "committing:1"]));
  });

  it("removes a partial range on cancellation and rejects cache reuse across trust classes", async () => {
    const fixture = await dependencyFixture();
    const runtime = new FixtureHyperframesRuntime();
    const composition = await discoverComposition(fixture.source, runtime);
    const dependencies = await collectHyperframesDependencies(fixture.source, composition.compositionId);
    const controller = new AbortController();
    const outputPath = path.join(fixture.projectRoot, "cancelled.mp4");
    const renderer = new HyperframesRenderer(runtime, "ffmpeg", async (input) => {
      await writeFile(input.outputPath, "partial");
      controller.abort();
      throw new DOMException("cancelled", "AbortError");
    });
    await expect(
      renderer.renderRange({
        source: fixture.source,
        composition,
        startFrame: "0",
        endFrameExclusive: "10",
        outputPath,
        codec: "h264",
        environment,
        dependencySet: dependencies,
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(HyperframesRenderCancelledError);
    await expect(access(outputPath)).rejects.toThrow();

    const trusted = selectHyperframesWorkerPolicy(fixture.source);
    const untrusted = selectHyperframesWorkerPolicy({
      ...fixture.source,
      trustClass: "imported-untrusted",
    });
    expect(trusted.cacheNamespace).not.toBe(untrusted.cacheNamespace);
    expect(() => {
      assertHyperframesCachePolicy(trusted, untrusted);
    }).toThrow(/incompatible/);

    const untrustedSource = { ...fixture.source, trustClass: "imported-untrusted" as const };
    expect(() => new HyperframesWorkerRouter({ trustedRuntime: runtime }).select(untrustedSource)).toThrow(
      /disabled/,
    );
    expect(
      () =>
        new HyperframesWorkerRouter({
          trustedRuntime: runtime,
          importedRuntime: runtime,
        }),
    ).toThrow(/distinct runtime/);
    const importedRuntime = new FixtureHyperframesRuntime();
    const selection = new HyperframesWorkerRouter({
      trustedRuntime: runtime,
      importedRuntime,
      isolationEvidence: {
        profileVersion: "macos-hyperframes-imported-v1",
        platform: "darwin",
        architecture: "arm64",
        adversarialEvidenceHash: "a".repeat(64),
        stale: false,
        enforcementMechanisms: [
          "sandbox-exec-network-denial",
          "canonical-root-policy",
          "sanitized-environment",
          "separate-browser-profile",
          "wall-time-output-memory-caps",
        ],
      },
    }).select(untrustedSource);
    expect(selection).toMatchObject({
      runtime: importedRuntime,
      policy: { trustClass: "imported-untrusted", networkMode: "denied" },
      isolationEvidence: { stale: false },
    });
  });
});

const environment: HyperframesRenderEnvironment = {
  strictEnvironmentFingerprint: "strict-hyperframes-fixture-environment-0001",
  browserIdentity: "HyperFrames pinned browser fixture",
  browserExecutable: "/isolated/playwright/chromium-fixture",
  colorContractId: "chai-hyperframes-rgba8-straight-v1",
  colorSpace: "srgb",
  alphaMode: "straight",
  settingsHash: "hyperframes-settings-fixture-0001",
};

const discoverComposition = async (
  source: ReturnType<typeof hyperframesSource>,
  runtime: FixtureHyperframesRuntime,
) => {
  const discovery = await discoverHyperframesCompositions({
    source,
    runtime,
    signal: new AbortController().signal,
  });
  if (discovery.selectedComposition === null) throw new Error("fixture discovery failed");
  return discovery.selectedComposition;
};

const dependencyFixture = async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chai-hyperframes-dependencies-"));
  directories.push(projectRoot);
  await writeFile(
    path.join(projectRoot, "index.html"),
    fixtureHtml(
      '<link rel="stylesheet" href="./style.css"><script>window.__timelines={}; const timeline=gsap.timeline({paused:true}); window.__timelines["chai-fixture"]=timeline;</script>',
    ),
  );
  await writeFile(
    path.join(projectRoot, "style.css"),
    '@font-face{font-family:Fixture;src:url("./font.woff2")} body{background:url("./image.png")}\n',
  );
  await writeFile(
    path.join(projectRoot, "runtime.js"),
    'import shader from "./shader.glsl"; fetch("./data.json"); window.fixture = shader;\n',
  );
  await writeFile(path.join(projectRoot, "shader.glsl"), "void main(){gl_FragColor=vec4(1.0);}\n");
  await writeFile(path.join(projectRoot, "data.json"), '{"fixture":true}\n');
  await writeFile(path.join(projectRoot, "image.png"), "image");
  await writeFile(path.join(projectRoot, "font.woff2"), "font");
  return { projectRoot, source: hyperframesSource({ projectRoot }) };
};
