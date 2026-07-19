import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRenderCacheKey,
  buildRenderEnvironmentIdentity,
  CachedArtifactNodeExecutor,
  ContentAddressedArtifactStore,
  createOutputCandidatePointer,
  createRenderPlan,
  mergeRenderDependencies,
  planCapabilityRequests,
  assertVideoAudioAlignment,
  validateBridgeScene,
  validateRenderDag,
  type RenderCacheKeyInput,
  type RenderDag,
} from "../../packages/render/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";
import { initialCapabilityRegistry } from "../../packages/engine-adapters/src/index.js";

const temporaryDirectories: string[] = [];
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })),
  );
});

describe("P20 render DAG and content-addressed cache", () => {
  it("topologically validates a reachable typed DAG and rejects cycles", () => {
    expect(validateRenderDag(dag).map((node) => node.id)).toEqual([
      "node-validate",
      "node-render",
      "node-receipt",
    ]);
    const cyclic: RenderDag = {
      ...dag,
      nodes: dag.nodes.map((node) =>
        node.id === "node-validate" ? { ...node, dependsOn: ["node-receipt"] } : node,
      ),
    };
    expect(() => validateRenderDag(cyclic)).toThrow("cycle");
  });

  it("merges dependency reasons deterministically and refuses conflicting hashes", () => {
    const entry = {
      category: "asset" as const,
      id: "asset-title",
      contentHash: hash("asset-v1"),
      source: "assets/title.png",
      requiredBy: ["node-render"],
      portability: "portable-proven" as const,
      metadata: { role: "title" },
    };
    const merged = mergeRenderDependencies([
      [entry],
      [{ ...entry, requiredBy: ["node-receipt"], portability: "strict" }],
    ]);
    expect(merged.entries[0]).toMatchObject({
      requiredBy: ["node-receipt", "node-render"],
      portability: "strict",
    });
    expect(() => mergeRenderDependencies([[entry], [{ ...entry, contentHash: hash("asset-v2") }]])).toThrow(
      "conflict",
    );
  });

  it("separates strict final identity from compatible preview identity", () => {
    const first = buildRenderEnvironmentIdentity(strictEnvironment("gpu-a"), previewEnvironment);
    const second = buildRenderEnvironmentIdentity(strictEnvironment("gpu-b"), previewEnvironment);
    expect(second.strictEnvironmentFingerprint).not.toBe(first.strictEnvironmentFingerprint);
    expect(second.compatiblePreviewFingerprint).toBe(first.compatiblePreviewFingerprint);
  });

  it("invalidates canonical cache keys for meaningful inputs but ignores object key order", () => {
    const first = buildRenderCacheKey(cacheInput({ title: "Chai", opacity: 1 }));
    const reordered = buildRenderCacheKey(cacheInput({ opacity: 1, title: "Chai" }));
    const changed = buildRenderCacheKey(cacheInput({ opacity: 0.9, title: "Chai" }));
    expect(reordered).toBe(first);
    expect(changed).not.toBe(first);
  });

  it("publishes atomically, validates hits, quarantines corruption, and cleans only unprotected entries", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "source.bin");
    await writeFile(source, "accepted artifact");
    let tick = 0;
    const store = new ContentAddressedArtifactStore(
      path.join(root, "cache"),
      () => new Date(`2026-07-16T10:00:0${String(tick++)}.000Z`),
    );
    const environmentHash = hash("environment");
    const dependencyHash = hash("dependencies");
    const firstKey = hash("cache-key-1");
    const published = await store.publish({
      cacheKey: firstKey,
      sourcePath: source,
      descriptor: artifactDescriptor("first"),
      dependencyManifestHash: dependencyHash,
      strictEnvironmentFingerprint: environmentHash,
      portableEnvironmentContractHash: null,
      producerNodeId: "node-render",
    });
    expect(published.reason).toBe("validated-strict");
    expect(
      await store.lookup({
        cacheKey: firstKey,
        strictEnvironmentFingerprint: environmentHash,
        portableEnvironmentContractHash: null,
      }),
    ).toMatchObject({ status: "hit", reason: "validated-strict" });
    await writeFile(published.artifactPath, "corrupt bytes");
    const corrupt = await store.lookup({
      cacheKey: firstKey,
      strictEnvironmentFingerprint: environmentHash,
      portableEnvironmentContractHash: null,
    });
    expect(corrupt).toMatchObject({ status: "miss", reason: "content-corrupt" });
    if (corrupt.status !== "miss" || corrupt.quarantinedPath === null) {
      throw new Error("Corrupt cache entry was not quarantined.");
    }
    expect(await readFile(path.join(corrupt.quarantinedPath, "metadata.json"), "utf8")).toContain(firstKey);

    const protectedKey = hash("cache-key-protected");
    await writeFile(source, "protected artifact");
    await store.publish({
      cacheKey: protectedKey,
      sourcePath: source,
      descriptor: artifactDescriptor("protected"),
      dependencyManifestHash: dependencyHash,
      strictEnvironmentFingerprint: environmentHash,
      portableEnvironmentContractHash: null,
      producerNodeId: "node-render",
    });
    const cleanup = await store.cleanup({ maximumBytes: 0, protectedCacheKeys: [protectedKey] });
    expect(cleanup.removedKeys).not.toContain(protectedKey);
    expect(cleanup.retainedBytes).toBeGreaterThan(0);
  });

  it("blocks unsupported planner paths and preserves the rendered-unchecked lifecycle boundary", () => {
    const dependencyManifest = mergeRenderDependencies([[]]);
    const environment = buildRenderEnvironmentIdentity(strictEnvironment("gpu-a"), previewEnvironment);
    const plan = createRenderPlan({
      id: "render-plan-blocked",
      dag,
      dependencyManifest,
      environment,
      decisions: [
        {
          entityId: "clip-unsupported",
          path: "unsupported",
          owner: "shared",
          capabilityIdentity: hash("capability"),
          approximation: null,
          fallback: null,
          findings: [
            {
              code: "render.capability.unsupported",
              severity: "error",
              blocking: true,
              message: "No accepted render path exists.",
              affectedIds: ["clip-unsupported"],
              repairHint: "Replace or explicitly bake the effect.",
              evidenceHashes: [],
            },
          ],
        },
      ],
    });
    expect(plan.executable).toBe(false);
    expect(
      createOutputCandidatePointer({
        outputId: "output-render-test",
        sourceRevisionId: "revision-render-test",
        receiptIdentityHash: hash("receipt"),
        artifactHashes: [hash("artifact")],
        createdAt: "2026-07-16T10:00:00.000Z",
      }).lifecycleState,
    ).toBe("rendered_unchecked");
  });

  it("validates exact bridge boundaries and exact video/audio endpoints", () => {
    const bridge = validateBridgeScene({
      schemaVersion: "1.0.0",
      id: "bridge-title-to-demo",
      outgoingClipId: "clip-title",
      incomingClipId: "clip-demo",
      outgoingRange: { startFrame: "20", endFrameExclusive: "30" },
      incomingRange: { startFrame: "0", endFrameExclusive: "10" },
      timelineRange: { startFrame: "20", endFrameExclusive: "30" },
      durationFrames: "10",
      owner: "shared",
      alphaMode: "straight",
      pixelFormat: "rgba8",
      colorSpace: "rec709",
      audioEnvelope: { outgoingStart: 1, outgoingEnd: 0, incomingStart: 0, incomingEnd: 1 },
      fallback: { kind: "cross-dissolve", reason: "Portable deterministic fallback." },
      preRollFrames: "2",
      postRollFrames: "2",
      cacheKey: hash("bridge-cache"),
    });
    expect(bridge.expectedFrameCount).toBe("10");
    expect(() =>
      validateBridgeScene({ ...bridge, incomingRange: { startFrame: "0", endFrameExclusive: "9" } }),
    ).toThrow("exact declared duration");
    expect(() => {
      assertVideoAudioAlignment({
        durationFrames: "30",
        fpsNumerator: "30",
        fpsDenominator: "1",
        audioDurationSamples: "48000",
        sampleRate: 48_000,
      });
    }).not.toThrow();
    expect(() => {
      assertVideoAudioAlignment({
        durationFrames: "30",
        fpsNumerator: "30",
        fpsDenominator: "1",
        audioDurationSamples: "47999",
        sampleRate: 48_000,
      });
    }).toThrow("do not align");
  });

  it("routes native/shared artifact handlers through validated cache truth", async () => {
    const root = await temporaryDirectory();
    const source = path.join(root, "shared-frame.png");
    await writeFile(source, "deterministic pixels");
    const store = new ContentAddressedArtifactStore(path.join(root, "cache"));
    let executions = 0;
    const descriptor = {
      artifactId: "artifact-shared-frame",
      class: "intermediate" as const,
      mediaType: "image/png",
      extension: "png",
      frameRange: { startFrame: "0", endFrameExclusive: "1" },
      alphaMode: "straight" as const,
      colorSpace: "rec709",
      pixelFormat: "rgba8",
    };
    const executor = new CachedArtifactNodeExecutor({
      kind: "shared-media",
      store,
      dependencyManifestHash: hash("dependencies"),
      cacheKeyFor: () => hash("shared-frame-key"),
      handler: () => {
        executions += 1;
        return Promise.resolve([{ descriptor, sourcePath: source, logs: [], warnings: [] }]);
      },
    });
    const renderNode = {
      ...node({ id: "node-shared-frame", kind: "shared-media", dependsOn: [] }),
      expectedOutputs: [descriptor],
    };
    const environment = buildRenderEnvironmentIdentity(strictEnvironment("gpu-a"), previewEnvironment);
    const updates: string[] = [];
    const context = {
      projectRoot: root,
      workingDirectory: root,
      environment,
      signal: new AbortController().signal,
      report: (update: { stage: string }) => {
        updates.push(update.stage);
      },
      dependencyArtifacts: new Map(),
    };
    expect((await executor.execute(renderNode, context)).artifacts).toHaveLength(1);
    expect((await executor.execute(renderNode, context)).artifacts).toHaveLength(1);
    expect(executions).toBe(1);
    expect(updates).toEqual(["rendering", "validated", "cache-hit"]);
  });

  it("converts the evidence-backed capability registry into explicit execution paths", () => {
    const decisions = planCapabilityRequests(initialCapabilityRegistry, [
      {
        entityId: "clip-gsap",
        engine: "hyperframes",
        capabilityId: "hyperframes.gsap",
        experimentalOptIn: false,
      },
      {
        entityId: "clip-particles",
        engine: "hyperframes",
        capabilityId: "hyperframes.particles",
        experimentalOptIn: false,
      },
      {
        entityId: "project-distributed",
        engine: "render-core",
        capabilityId: "render-core.distributed-rendering",
        experimentalOptIn: false,
      },
    ]);
    expect(decisions.map((decision) => decision.path)).toEqual(["native", "fallback", "unsupported"]);
    expect(decisions[1]?.fallback).toBe("fallback.baked-particles");
    expect(decisions[1]?.approximation).toContain("approximation");
    expect(decisions[2]?.findings[0]).toMatchObject({ severity: "error", blocking: true });
  });
});

const node = (input: {
  readonly id: string;
  readonly kind: "validate" | "shared-media" | "receipt";
  readonly dependsOn: readonly string[];
}) => ({
  schemaVersion: "1.0.0" as const,
  ...input,
  label: input.id,
  input: {},
  expectedOutputs: [],
  cachePolicy: "strict" as const,
  trustClass: "trusted-authored" as const,
  resources: { cpu: 1, memoryMiB: 64, gpu: "none" as const, browser: false },
  retryPolicy: { maxAttempts: 1, resumable: true, retryableStages: [] },
});

const dag: RenderDag = {
  schemaVersion: "1.0.0",
  id: "render-dag-test",
  projectId: "project-render-test",
  revisionId: "revision-render-test",
  timelineId: "timeline-render-test",
  range: { startFrame: "0", endFrameExclusive: "30" },
  fps: normalizeRational(30n, 1n),
  nodes: [
    node({ id: "node-receipt", kind: "receipt", dependsOn: ["node-render"] }),
    node({ id: "node-render", kind: "shared-media", dependsOn: ["node-validate"] }),
    node({ id: "node-validate", kind: "validate", dependsOn: [] }),
  ],
  roots: ["node-receipt"],
};

const strictEnvironment = (gpu: string) => ({
  schemaVersion: "1.0.0" as const,
  os: "darwin",
  architecture: "arm64",
  osVersion: "26.0",
  gpu,
  nodeVersion: "26.1.0",
  browserExecutableHash: hash("browser"),
  browserIdentity: "playwright-managed:chromium_headless_shell-1228",
  rendererVersions: { remotion: "4.0.489", hyperframes: "0.7.58" },
  ffmpegVersion: "7.1.1",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  colorContractId: "chai-rgba-v1",
  lockfileHash: hash("lockfile"),
});

const previewEnvironment = {
  schemaVersion: "1.0.0" as const,
  architecture: "arm64",
  browserMajor: "142",
  rendererVersions: { remotion: "4.0.489", hyperframes: "0.7.58" },
  colorContractId: "chai-rgba-v1",
};

const cacheInput = (propsAndVariables: Record<string, string | number>): RenderCacheKeyInput => ({
  schemaVersion: "1.0.0",
  nodeKind: "shared-media",
  nodeInput: { clipId: "clip-title" },
  dependencyManifestHash: hash("dependencies"),
  strictEnvironmentFingerprint: hash("environment"),
  portableEnvironmentContractHash: null,
  sourceHashes: [hash("source")],
  propsAndVariables,
  assetHashes: [hash("asset")],
  fontHashes: [hash("font")],
  versions: { shared: "1.0.0" },
  dimensions: { width: 1920, height: 1080 },
  fps: normalizeRational(30n, 1n),
  range: { startFrame: "0", endFrameExclusive: "30" },
  colorSpace: "rec709",
  alphaMode: "opaque",
  pixelFormat: "yuv420p",
  quality: "final",
  transitions: [],
  audioSegment: { startSample: "0", endSampleExclusive: "48000" },
  browserIdentity: "playwright-managed:chromium_headless_shell-1228",
  rendererIdentity: "shared-v1",
  ffmpegVersion: "7.1.1",
  os: "darwin",
  architecture: "arm64",
  gpu: "apple-m4",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  seeds: { default: "0" },
  lockfileHash: hash("lockfile"),
  approvedNetworkHashes: [],
});

const artifactDescriptor = (id: string) => ({
  artifactId: `artifact-${id}`,
  class: "intermediate" as const,
  mediaType: "application/octet-stream",
  extension: "bin",
  frameRange: { startFrame: "0", endFrameExclusive: "30" },
  alphaMode: null,
  colorSpace: null,
  pixelFormat: null,
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-render-cache-"));
  temporaryDirectories.push(directory);
  return directory;
};
