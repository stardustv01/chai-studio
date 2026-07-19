import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertFinalRenderUsesOriginals,
  fingerprintProxyProfile,
  generateConstantFrameRateProxy,
  proxyArguments,
  proxyArtifactIsCurrent,
  resolvePreviewMedia,
  type ProxyProfile,
} from "../../packages/media/src/index.js";
import { normalizeRational, serializeBigInt, type AssetRecord } from "../../packages/schema/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("CFR proxy generation and source policy", () => {
  it("runs a deterministic profile, publishes atomically, hashes output, and emits an exact time map", async () => {
    const directory = await temporaryDirectory();
    const outputFilePath = path.join(directory, "proxy.mp4");
    const sourceAsset = asset();
    let capturedArguments: readonly string[] = [];
    const artifact = await generateConstantFrameRateProxy({
      sourceAsset,
      sourceFilePath: path.join(directory, "source.mov"),
      outputFilePath,
      profile: profile(),
      sourceFrames: [
        { sourceFrameIndex: "0", timestampSeconds: normalizeRational(0n, 1n) },
        { sourceFrameIndex: "1", timestampSeconds: normalizeRational(1n, 25n) },
      ],
      proxyFrameCount: "2",
      runCommand: async (_executable, arguments_) => {
        capturedArguments = arguments_;
        const temporaryOutput = arguments_.at(-1);
        if (temporaryOutput === undefined) throw new Error("Proxy output argument is missing.");
        await writeFile(temporaryOutput, "proxy-output");
        return { exitCode: 0, stderr: "" };
      },
    });
    expect(capturedArguments).toContain("cfr");
    expect(capturedArguments.join(" ")).toContain("fps=25/1");
    expect(await readFile(outputFilePath, "utf8")).toBe("proxy-output");
    expect(artifact.timeMap.mappings).toHaveLength(2);
    expect(artifact.profileFingerprint).toBe(fingerprintProxyProfile(profile()));
    expect(proxyArtifactIsCurrent(artifact, sourceAsset, profile())).toBe(true);
  });

  it("labels preview sources, invalidates stale proxies, and blocks proxies from final render", async () => {
    const directory = await temporaryDirectory();
    const outputFilePath = path.join(directory, "proxy.mp4");
    const sourceAsset = asset();
    const artifact = await generateConstantFrameRateProxy({
      sourceAsset,
      sourceFilePath: "source.mov",
      outputFilePath,
      profile: profile(),
      sourceFrames: [{ sourceFrameIndex: "0", timestampSeconds: normalizeRational(0n, 1n) }],
      proxyFrameCount: "1",
      runCommand: async (_executable, arguments_) => {
        const temporaryOutput = arguments_.at(-1);
        if (temporaryOutput === undefined) throw new Error("Proxy output argument is missing.");
        await writeFile(temporaryOutput, "proxy-output");
        return { exitCode: 0, stderr: "" };
      },
    });
    const proxy = resolvePreviewMedia(sourceAsset, "source.mov", artifact, "auto", profile());
    expect(proxy).toMatchObject({ sourceKind: "proxy", fidelityLabel: "Proxy" });
    expect(() => {
      assertFinalRenderUsesOriginals([proxy]);
    }).toThrow(/Final render references proxy/);

    const changedAsset = { ...sourceAsset, contentHash: "f".repeat(64) };
    expect(resolvePreviewMedia(changedAsset, "source.mov", artifact, "auto", profile())).toMatchObject({
      sourceKind: "original",
      fidelityLabel: "Original",
    });
  });

  it("builds bounded CFR arguments and refuses pre-cancelled work", async () => {
    expect(proxyArguments("in.mov", "out.mp4", profile())).toContain("libx264");
    const controller = new AbortController();
    controller.abort();
    await expect(
      generateConstantFrameRateProxy({
        sourceAsset: asset(),
        sourceFilePath: "source.mov",
        outputFilePath: "proxy.mp4",
        profile: profile(),
        sourceFrames: [],
        proxyFrameCount: "0",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/cancelled/);
  });
});

const temporaryDirectory = async (): Promise<string> => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chai-proxy-manager-"));
  temporaryDirectories.push(directory);
  return directory;
};

const profile = (): ProxyProfile => ({
  id: "proxy-editing-720p",
  width: 1280,
  height: 720,
  targetFrameRate: normalizeRational(25n, 1n),
  videoCodec: "h264",
  audioCodec: "aac",
  quality: 24,
  container: "mp4",
});

const asset = (): AssetRecord => ({
  id: "asset-proxy-0001",
  path: "assets/source.mov",
  contentHash: "e".repeat(64),
  kind: "video",
  durationFrames: serializeBigInt(2n),
  fps: normalizeRational(25n, 1n),
  hasAudio: true,
  hasAlpha: false,
  variableFrameRate: true,
  rights: "owned",
  validationState: "valid",
});
