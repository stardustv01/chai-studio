import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import type { AssetRecord, NormalizedRational } from "@chai-studio/schema";
import { sha256File } from "./asset-registry.js";
import {
  buildSourceToProxyTimeMap,
  type SourceFrameTimestamp,
  type SourceToProxyTimeMapV1,
} from "./proxy-time-map.js";

export interface ProxyProfile {
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly targetFrameRate: NormalizedRational;
  readonly videoCodec: "h264" | "prores-proxy";
  readonly audioCodec: "aac" | "pcm-s16le";
  readonly quality: number;
  readonly container: "mp4" | "mov";
}

export interface GenerateProxyInput {
  readonly sourceAsset: AssetRecord;
  readonly sourceFilePath: string;
  readonly outputFilePath: string;
  readonly profile: ProxyProfile;
  readonly sourceFrames: readonly SourceFrameTimestamp[];
  readonly proxyFrameCount: string;
  readonly ffmpegPath?: string;
  readonly signal?: AbortSignal;
  readonly runCommand?: (
    executable: string,
    arguments_: readonly string[],
    signal: AbortSignal | undefined,
  ) => Promise<Readonly<{ exitCode: number; stderr: string }>>;
}

export interface GeneratedProxyArtifact {
  readonly schemaVersion: "1.0.0";
  readonly sourceAssetId: string;
  readonly sourceContentHash: string;
  readonly proxyContentHash: string;
  readonly profileId: string;
  readonly profileFingerprint: string;
  readonly cacheKey: string;
  readonly outputFilePath: string;
  readonly timeMap: SourceToProxyTimeMapV1;
}

export interface PreviewMediaResolution {
  readonly assetId: string;
  readonly path: string;
  readonly sourceKind: "original" | "proxy";
  readonly fidelityLabel: "Original" | "Proxy";
  readonly contentHash: string;
}

export const generateConstantFrameRateProxy = async (
  input: GenerateProxyInput,
): Promise<GeneratedProxyArtifact> => {
  assertProxyProfile(input.profile);
  if (input.sourceAsset.contentHash.length !== 64)
    throw proxyError("media.proxy.source-hash-invalid", "Source hash is invalid.");
  if (signalIsAborted(input.signal))
    throw proxyError("media.proxy.cancelled", "Proxy generation was cancelled.");
  await mkdir(path.dirname(input.outputFilePath), { recursive: true });
  const parsedPath = path.parse(input.outputFilePath);
  const temporaryPath = path.join(
    parsedPath.dir,
    `${parsedPath.name}.${String(process.pid)}.tmp${parsedPath.ext}`,
  );
  const arguments_ = proxyArguments(input.sourceFilePath, temporaryPath, input.profile);
  const run = input.runCommand ?? runProcess;
  const result = await run(input.ffmpegPath ?? "ffmpeg", arguments_, input.signal);
  if (result.exitCode !== 0) {
    await rm(temporaryPath, { force: true });
    if (signalIsAborted(input.signal))
      throw proxyError("media.proxy.cancelled", "Proxy generation was cancelled.");
    throw proxyError(
      "media.proxy.ffmpeg-failed",
      `ffmpeg proxy generation failed: ${result.stderr.slice(-2_000)}`,
    );
  }
  const proxyContentHash = await sha256File(temporaryPath);
  await rename(temporaryPath, input.outputFilePath);
  const profileFingerprint = fingerprintProxyProfile(input.profile);
  return {
    schemaVersion: "1.0.0",
    sourceAssetId: input.sourceAsset.id,
    sourceContentHash: input.sourceAsset.contentHash,
    proxyContentHash,
    profileId: input.profile.id,
    profileFingerprint,
    cacheKey: proxyCacheKey(input.sourceAsset.contentHash, profileFingerprint),
    outputFilePath: input.outputFilePath,
    timeMap: buildSourceToProxyTimeMap({
      sourceContentHash: input.sourceAsset.contentHash,
      proxyContentHash,
      targetFrameRate: input.profile.targetFrameRate,
      proxyFrameCount: input.proxyFrameCount,
      sourceFrames: input.sourceFrames,
    }),
  };
};

export const proxyArguments = (
  sourceFilePath: string,
  outputFilePath: string,
  profile: ProxyProfile,
): readonly string[] => {
  assertProxyProfile(profile);
  const frameRate = `${profile.targetFrameRate.numerator}/${profile.targetFrameRate.denominator}`;
  const codecArguments =
    profile.videoCodec === "h264"
      ? ["-c:v", "libx264", "-crf", String(profile.quality), "-pix_fmt", "yuv420p"]
      : ["-c:v", "prores_ks", "-profile:v", "0", "-qscale:v", String(profile.quality)];
  const audioArguments =
    profile.audioCodec === "aac" ? ["-c:a", "aac", "-b:a", "192k"] : ["-c:a", "pcm_s16le"];
  return [
    "-y",
    "-v",
    "error",
    "-i",
    sourceFilePath,
    "-map",
    "0:v:0",
    "-map",
    "0:a?",
    "-vf",
    `fps=${frameRate},scale=${String(profile.width)}:${String(profile.height)}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${String(profile.width)}:${String(profile.height)}:(ow-iw)/2:(oh-ih)/2`,
    "-fps_mode",
    "cfr",
    ...codecArguments,
    ...audioArguments,
    outputFilePath,
  ];
};

export const fingerprintProxyProfile = (profile: ProxyProfile): string => {
  assertProxyProfile(profile);
  return createHash("sha256")
    .update(
      JSON.stringify({
        audioCodec: profile.audioCodec,
        container: profile.container,
        height: profile.height,
        id: profile.id,
        quality: profile.quality,
        targetFrameRate: profile.targetFrameRate,
        videoCodec: profile.videoCodec,
        width: profile.width,
      }),
    )
    .digest("hex");
};

export const proxyCacheKey = (sourceContentHash: string, profileFingerprint: string): string =>
  createHash("sha256").update(`${sourceContentHash}:${profileFingerprint}`).digest("hex");

export const proxyArtifactIsCurrent = (
  artifact: GeneratedProxyArtifact,
  sourceAsset: AssetRecord,
  profile: ProxyProfile,
): boolean =>
  artifact.sourceAssetId === sourceAsset.id &&
  artifact.sourceContentHash === sourceAsset.contentHash &&
  artifact.profileFingerprint === fingerprintProxyProfile(profile);

export const resolvePreviewMedia = (
  sourceAsset: AssetRecord,
  originalPath: string,
  proxy: GeneratedProxyArtifact | null,
  preference: "original" | "proxy" | "auto",
  profile?: ProxyProfile,
): PreviewMediaResolution => {
  const proxyAllowed =
    proxy !== null &&
    (profile === undefined || proxyArtifactIsCurrent(proxy, sourceAsset, profile)) &&
    preference !== "original";
  return proxyAllowed
    ? {
        assetId: sourceAsset.id,
        path: proxy.outputFilePath,
        sourceKind: "proxy",
        fidelityLabel: "Proxy",
        contentHash: proxy.proxyContentHash,
      }
    : {
        assetId: sourceAsset.id,
        path: originalPath,
        sourceKind: "original",
        fidelityLabel: "Original",
        contentHash: sourceAsset.contentHash,
      };
};

export const assertFinalRenderUsesOriginals = (resolutions: readonly PreviewMediaResolution[]): void => {
  const proxies = resolutions.filter((resolution) => resolution.sourceKind === "proxy");
  if (proxies.length > 0) {
    throw proxyError(
      "media.proxy.final-source-forbidden",
      `Final render references proxy media for: ${proxies.map((item) => item.assetId).join(", ")}.`,
    );
  }
};

const assertProxyProfile = (profile: ProxyProfile): void => {
  if (
    !/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(profile.id) ||
    !Number.isSafeInteger(profile.width) ||
    !Number.isSafeInteger(profile.height) ||
    profile.width < 16 ||
    profile.height < 16 ||
    profile.width % 2 !== 0 ||
    profile.height % 2 !== 0 ||
    !Number.isSafeInteger(profile.quality) ||
    profile.quality < 0 ||
    profile.quality > 63
  ) {
    throw proxyError(
      "media.proxy.profile-invalid",
      "Proxy profile violates bounded codec dimensions or quality.",
    );
  }
};

const signalIsAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const runProcess = (
  executable: string,
  arguments_: readonly string[],
  signal: AbortSignal | undefined,
): Promise<Readonly<{ exitCode: number; stderr: string }>> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...arguments_], {
      signal,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stderr });
    });
  });

const proxyError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "media",
    code,
    correlationId: createCorrelationId(),
    stage: "proxy-manager",
    message,
    repairHint: "Regenerate from the current original and profile; final delivery must resolve originals.",
  });
