import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  RemotionMasterCompositor,
  runAtomicEncode,
  validateDeliveryEncodeProfile,
  type DeliveryEncodeProfile,
  type RenderArtifactMetadata,
  type RenderDagNode,
} from "../../packages/render/src/index.js";
import { normalizeRational } from "../../packages/schema/src/index.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })),
  );
});

describe("P20 atomic encode and replaceable finishing", () => {
  it("atomically finalizes a validated encode and never exposes a failed partial", async () => {
    const root = await temporaryDirectory();
    const inputPath = path.join(root, "input.mov");
    const outputPath = path.join(root, "delivery", "master.mp4");
    await writeFile(inputPath, "input");
    const progress: number[] = [];
    const encoded = await runAtomicEncode({
      inputPaths: [inputPath],
      outputPath,
      profile,
      signal: new AbortController().signal,
      report: (value) => progress.push(value),
      runner: async ({ temporaryOutputPath, report }) => {
        report(0.75);
        await writeFile(temporaryOutputPath, "encoded");
      },
    });
    expect(await readFile(encoded.outputPath, "utf8")).toBe("encoded");
    expect(progress.at(-1)).toBe(1);

    const failedPath = path.join(root, "delivery", "failed.mp4");
    await expect(
      runAtomicEncode({
        inputPaths: [inputPath],
        outputPath: failedPath,
        profile,
        signal: new AbortController().signal,
        report: () => undefined,
        runner: async ({ temporaryOutputPath }) => {
          await writeFile(temporaryOutputPath, "partial");
          throw new Error("encoder failed");
        },
      }),
    ).rejects.toThrow("encoder failed");
    expect((await readdir(path.dirname(failedPath))).some((name) => name.includes("failed.mp4"))).toBe(false);
  });

  it("enforces explicit source and alpha rules for every output class", () => {
    expect(() => {
      validateDeliveryEncodeProfile({ ...profile, outputClass: "transparent-overlay", alphaMode: "opaque" });
    }).toThrow("opaque");
    expect(() => {
      validateDeliveryEncodeProfile({ ...profile, outputClass: "still", container: "mp4" });
    }).toThrow("image container");
    expect(() => {
      validateDeliveryEncodeProfile({
        ...profile,
        outputClass: "audio-only",
        width: null,
        height: null,
        fps: null,
        videoCodec: null,
        audioCodec: "pcm_s24le",
        container: "wav",
      });
    }).not.toThrow();
  });

  it("generates deterministic Remotion finishing source behind a replaceable interface", async () => {
    const root = await temporaryDirectory();
    const outputPath = path.join(root, "finish.mp4");
    let observedHash = "";
    const compositor = new RemotionMasterCompositor(async (input) => {
      observedHash = input.sourceHash;
      await writeFile(input.outputPath, "finished");
      input.report(1);
      return { frameCount: "30", durationSamples: "48000", logs: ["fixture finish"] };
    });
    const result = await compositor.compose({
      node: compositorNode(root),
      visualLayers: [artifact("visual-title")],
      bridgeLayers: [],
      captionLayers: [],
      audioArtifact: null,
      outputPath,
      signal: new AbortController().signal,
      report: () => undefined,
    });
    const source = await readFile(`${outputPath}.source.tsx`, "utf8");
    expect(result).toMatchObject({
      implementationId: "remotion-finishing-compositor",
      implementationVersion: "4.0.489",
      frameCount: "30",
    });
    expect(observedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(source).toContain("visual-title");
    expect(source).toContain(path.join(root, "visual.mov"));
  });
});

const profile: DeliveryEncodeProfile = {
  id: "profile-final-h264",
  outputClass: "delivery",
  width: 1920,
  height: 1080,
  fps: normalizeRational(30n, 1n),
  container: "mp4",
  videoCodec: "libx264",
  audioCodec: "aac",
  pixelFormat: "yuv420p",
  colorSpace: "rec709",
  alphaMode: "opaque",
  quality: "final",
};

const artifact = (id: string): RenderArtifactMetadata => ({
  schemaVersion: "1.0.0",
  cacheKey: "a".repeat(64),
  artifactHash: "b".repeat(64),
  byteLength: 100,
  descriptor: {
    artifactId: id,
    class: "intermediate",
    mediaType: "video/quicktime",
    extension: "mov",
    frameRange: { startFrame: "0", endFrameExclusive: "30" },
    alphaMode: "opaque",
    colorSpace: "rec709",
    pixelFormat: "yuv420p",
  },
  dependencyManifestHash: "c".repeat(64),
  strictEnvironmentFingerprint: "d".repeat(64),
  portableEnvironmentContractHash: null,
  producerNodeId: "node-visual",
  createdAt: "2026-07-16T10:00:00.000Z",
  validatedAt: "2026-07-16T10:00:00.000Z",
});

const compositorNode = (root: string): RenderDagNode => ({
  schemaVersion: "1.0.0",
  id: "node-master-finish",
  kind: "master-composition",
  label: "Master finish",
  dependsOn: ["node-visual"],
  input: {
    width: 1920,
    height: 1080,
    durationFrames: "30",
    fpsNumerator: "30",
    fpsDenominator: "1",
    artifactPaths: { ["a".repeat(64)]: path.join(root, "visual.mov") },
  },
  expectedOutputs: [],
  cachePolicy: "strict",
  trustClass: "trusted-authored",
  resources: { cpu: 2, memoryMiB: 512, gpu: "shared", browser: true },
  retryPolicy: { maxAttempts: 1, resumable: true, retryableStages: [] },
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-render-encode-"));
  directories.push(directory);
  return directory;
};
