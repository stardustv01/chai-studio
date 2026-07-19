import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildRenderEnvironmentIdentity,
  CachedArtifactNodeExecutor,
  ContentAddressedArtifactStore,
  RenderDagScheduler,
  type RenderArtifactDescriptor,
  type RenderDag,
  type RenderDagNode,
} from "../../packages/render/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

const directories: string[] = [];
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })),
  );
});

describe("P20 render DAG execution", () => {
  it("selectively invalidates one native branch and only its dependent finish", async () => {
    const root = await temporaryDirectory();
    const store = new ContentAddressedArtifactStore(path.join(root, "cache"));
    const counts = new Map<string, number>();
    let remotionSourceVersion = "v1";
    const executors = dag.nodes.map(
      (node) =>
        new CachedArtifactNodeExecutor({
          kind: node.kind as "native-remotion" | "caption" | "master-composition",
          store,
          dependencyManifestHash: hash("manifest"),
          cacheKeyFor: (current, _descriptor, context) => {
            const dependencyHashes = [...context.dependencyArtifacts.values()]
              .flat()
              .map((artifact) => artifact.artifactHash)
              .sort()
              .join(":");
            return hash(
              `${current.id}:${current.id === "node-remotion" ? remotionSourceVersion : "stable"}:${dependencyHashes}`,
            );
          },
          handler: async (current) => {
            counts.set(current.id, (counts.get(current.id) ?? 0) + 1);
            const descriptor = current.expectedOutputs[0];
            if (descriptor === undefined) throw new Error("Fixture output descriptor missing.");
            const sourcePath = path.join(root, `${current.id}-${String(counts.get(current.id))}.bin`);
            await writeFile(
              sourcePath,
              current.id === "node-remotion"
                ? `remotion-${remotionSourceVersion}`
                : current.id === "node-master"
                  ? `finish-${remotionSourceVersion}`
                  : "captions-stable",
            );
            return [{ descriptor, sourcePath, logs: [], warnings: [] }];
          },
        }),
    );
    const scheduler = new RenderDagScheduler(executors, 2);
    const environment = buildRenderEnvironmentIdentity(strictEnvironment, previewEnvironment);
    const run = () =>
      scheduler.execute(dag, (node, results) => ({
        projectRoot: root,
        workingDirectory: root,
        environment,
        signal: new AbortController().signal,
        report: () => undefined,
        dependencyArtifacts: new Map(
          node.dependsOn.map((dependency) => [dependency, results.get(dependency)?.artifacts ?? []]),
        ),
      }));

    const first = await run();
    expect(first.executionOrder).toEqual(["node-caption", "node-remotion", "node-master"]);
    expect(Object.fromEntries(counts)).toEqual({
      "node-caption": 1,
      "node-remotion": 1,
      "node-master": 1,
    });

    const second = await run();
    expect([...second.results.values()].every((result) => result.logs.includes("Validated cache hit."))).toBe(
      true,
    );
    expect(Object.fromEntries(counts)).toEqual({
      "node-caption": 1,
      "node-remotion": 1,
      "node-master": 1,
    });

    remotionSourceVersion = "v2";
    const third = await run();
    expect(Object.fromEntries(counts)).toEqual({
      "node-caption": 1,
      "node-remotion": 2,
      "node-master": 2,
    });
    expect(third.results.get("node-caption")?.logs).toContain("Validated cache hit.");
    expect(third.results.get("node-remotion")?.logs).not.toContain("Validated cache hit.");
  });
});

const descriptor = (artifactId: string): RenderArtifactDescriptor => ({
  artifactId,
  class: "intermediate",
  mediaType: "application/octet-stream",
  extension: "bin",
  frameRange: { startFrame: "0", endFrameExclusive: "30" },
  alphaMode: "straight",
  colorSpace: "rec709",
  pixelFormat: "rgba8",
});

const node = (
  id: string,
  kind: "native-remotion" | "caption" | "master-composition",
  dependsOn: readonly string[],
): RenderDagNode => ({
  schemaVersion: "1.0.0",
  id,
  kind,
  label: id,
  dependsOn,
  input: {},
  expectedOutputs: [descriptor(`artifact-${id}`)],
  cachePolicy: "strict",
  trustClass: "trusted-authored",
  resources: { cpu: 1, memoryMiB: 64, gpu: "none", browser: kind === "native-remotion" },
  retryPolicy: { maxAttempts: 1, resumable: true, retryableStages: [] },
});

const dag: RenderDag = {
  schemaVersion: "1.0.0",
  id: "render-dag-selective-invalidation",
  projectId: "project-render-integration",
  revisionId: "revision-render-integration",
  timelineId: "timeline-render-integration",
  range: { startFrame: "0", endFrameExclusive: "30" },
  fps: normalizeRational(30n, 1n),
  nodes: [
    node("node-caption", "caption", []),
    node("node-remotion", "native-remotion", []),
    node("node-master", "master-composition", ["node-caption", "node-remotion"]),
  ],
  roots: ["node-master"],
};

const strictEnvironment = {
  schemaVersion: "1.0.0" as const,
  os: "darwin",
  architecture: "arm64",
  osVersion: "fixture",
  gpu: "fixture",
  nodeVersion: process.version,
  browserExecutableHash: hash("browser"),
  browserIdentity: "playwright-managed:chromium_headless_shell-1228",
  rendererVersions: { remotion: "4.0.489", captions: "1.0.0" },
  ffmpegVersion: "7.1.1",
  locale: "en-IN",
  timezone: "Asia/Kolkata",
  colorContractId: "chai-render-integration-color-v1",
  lockfileHash: hash("lockfile"),
};

const previewEnvironment = {
  schemaVersion: "1.0.0" as const,
  architecture: "arm64",
  browserMajor: "1228",
  rendererVersions: { remotion: "4.0.489", captions: "1.0.0" },
  colorContractId: "chai-render-integration-color-v1",
};

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-render-dag-integration-"));
  directories.push(directory);
  return directory;
};
