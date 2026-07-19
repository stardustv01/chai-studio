import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import type { NormalizedRational } from "@chai-studio/schema";
import { sha256File } from "./asset-registry.js";

export interface ThumbnailViewProfile {
  readonly kind: "thumbnail";
  readonly width: number;
  readonly height: number;
  readonly atSeconds: NormalizedRational;
  readonly format: "png" | "jpeg";
}

export interface ContactSheetViewProfile {
  readonly kind: "contact-sheet";
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly sampleFrameRate: NormalizedRational;
  readonly format: "png" | "jpeg";
}

export interface FilmstripViewProfile {
  readonly kind: "filmstrip";
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly frameCount: number;
  readonly sampleFrameRate: NormalizedRational;
  readonly format: "png" | "jpeg";
}

export interface WaveformViewProfile {
  readonly kind: "waveform";
  readonly width: number;
  readonly channels: "mono" | "stereo";
  readonly sampleRate: 8_000 | 16_000 | 24_000 | 48_000;
}

export type GeneratedViewProfile =
  ThumbnailViewProfile | ContactSheetViewProfile | FilmstripViewProfile | WaveformViewProfile;

export interface GeneratedViewArtifact {
  readonly schemaVersion: "1.0.0";
  readonly kind: GeneratedViewProfile["kind"];
  readonly sourceContentHash: string;
  readonly profileFingerprint: string;
  readonly cacheKey: string;
  readonly outputPath: string;
  readonly outputContentHash: string;
}

export interface GenerateMediaViewInput {
  readonly sourceFilePath: string;
  readonly sourceContentHash: string;
  readonly cacheDirectory: string;
  readonly profile: GeneratedViewProfile;
  readonly ffmpegPath?: string;
  readonly signal?: AbortSignal;
  readonly producer?: (context: GeneratedViewProducerContext) => Promise<void>;
}

export interface GeneratedViewProducerContext {
  readonly sourceFilePath: string;
  readonly outputPath: string;
  readonly profile: GeneratedViewProfile;
  readonly ffmpegPath: string;
  readonly signal: AbortSignal | undefined;
}

export interface WaveformEnvelopeV1 {
  readonly schemaVersion: "1.0.0";
  readonly channels: 1 | 2;
  readonly bucketCount: number;
  readonly minimums: readonly (readonly number[])[];
  readonly maximums: readonly (readonly number[])[];
}

export const generateMediaView = async (input: GenerateMediaViewInput): Promise<GeneratedViewArtifact> => {
  assertGeneratedViewProfile(input.profile);
  assertHash(input.sourceContentHash, "source");
  if (signalIsAborted(input.signal)) throw viewError("media.view.cancelled", "Generated view was cancelled.");
  const profileFingerprint = fingerprintGeneratedViewProfile(input.profile);
  const cacheKey = generatedViewCacheKey(input.sourceContentHash, profileFingerprint);
  const targetDirectory = path.join(input.cacheDirectory, cacheKey);
  const outputName = outputFileName(input.profile);
  const manifestPath = path.join(targetDirectory, "manifest.json");
  const cached = await readVerifiedArtifact(manifestPath, targetDirectory, {
    sourceContentHash: input.sourceContentHash,
    profileFingerprint,
    cacheKey,
    kind: input.profile.kind,
  });
  if (cached !== null) return cached;

  const stagingDirectory = path.join(
    input.cacheDirectory,
    `.${cacheKey}.${String(process.pid)}.${createCorrelationId()}.staging`,
  );
  await rm(stagingDirectory, { recursive: true, force: true });
  await mkdir(stagingDirectory, { recursive: true });
  const stagingOutputPath = path.join(stagingDirectory, outputName);
  try {
    const producer = input.producer ?? defaultGeneratedViewProducer;
    await producer({
      sourceFilePath: input.sourceFilePath,
      outputPath: stagingOutputPath,
      profile: input.profile,
      ffmpegPath: input.ffmpegPath ?? "ffmpeg",
      signal: input.signal,
    });
    if (signalIsAborted(input.signal))
      throw viewError("media.view.cancelled", "Generated view was cancelled.");
    const info = await stat(stagingOutputPath);
    if (!info.isFile() || info.size === 0) {
      throw viewError("media.view.output-invalid", "Generated view producer created no usable output.");
    }
    const outputContentHash = await sha256File(stagingOutputPath);
    const artifact: GeneratedViewArtifact = {
      schemaVersion: "1.0.0",
      kind: input.profile.kind,
      sourceContentHash: input.sourceContentHash,
      profileFingerprint,
      cacheKey,
      outputPath: path.join(targetDirectory, outputName),
      outputContentHash,
    };
    await writeFile(path.join(stagingDirectory, "manifest.json"), `${JSON.stringify(artifact, null, 2)}\n`);
    await mkdir(input.cacheDirectory, { recursive: true });
    await rm(targetDirectory, { recursive: true, force: true });
    await rename(stagingDirectory, targetDirectory);
    return artifact;
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true });
    throw error;
  }
};

export const fingerprintGeneratedViewProfile = (profile: GeneratedViewProfile): string => {
  assertGeneratedViewProfile(profile);
  return createHash("sha256").update(canonicalJson(profile)).digest("hex");
};

export const generatedViewCacheKey = (sourceContentHash: string, profileFingerprint: string): string => {
  assertHash(sourceContentHash, "source");
  assertHash(profileFingerprint, "profile");
  return createHash("sha256").update(`${sourceContentHash}:${profileFingerprint}`).digest("hex");
};

export const generatedViewIsCurrent = (
  artifact: GeneratedViewArtifact,
  sourceContentHash: string,
  profile: GeneratedViewProfile,
): boolean =>
  artifact.sourceContentHash === sourceContentHash &&
  artifact.profileFingerprint === fingerprintGeneratedViewProfile(profile) &&
  artifact.cacheKey === generatedViewCacheKey(sourceContentHash, artifact.profileFingerprint);

export const generatedViewFfmpegArguments = (
  sourceFilePath: string,
  outputPath: string,
  profile: Exclude<GeneratedViewProfile, WaveformViewProfile>,
): readonly string[] => {
  const scale = (width: number, height: number): string =>
    `scale=${String(width)}:${String(height)}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad=${String(width)}:${String(height)}:(ow-iw)/2:(oh-ih)/2`;
  if (profile.kind === "thumbnail") {
    return [
      "-y",
      "-v",
      "error",
      "-i",
      sourceFilePath,
      "-vf",
      `select='gte(t,${rationalExpression(profile.atSeconds)})',${scale(profile.width, profile.height)}`,
      "-frames:v",
      "1",
      outputPath,
    ];
  }
  const columns = profile.kind === "contact-sheet" ? profile.columns : profile.frameCount;
  const rows = profile.kind === "contact-sheet" ? profile.rows : 1;
  return [
    "-y",
    "-v",
    "error",
    "-i",
    sourceFilePath,
    "-vf",
    `fps=${rationalExpression(profile.sampleFrameRate)},${scale(profile.tileWidth, profile.tileHeight)},tile=${String(columns)}x${String(rows)}`,
    "-frames:v",
    "1",
    outputPath,
  ];
};

export const buildWaveformEnvelope = (
  pcmFloat32Le: Buffer,
  channelCount: 1 | 2,
  bucketCount: number,
): WaveformEnvelopeV1 => {
  if (!Number.isSafeInteger(bucketCount) || bucketCount <= 0) {
    throw viewError("media.waveform.bucket-count-invalid", "Waveform bucket count must be positive.");
  }
  const sampleCount = Math.floor(pcmFloat32Le.byteLength / 4 / channelCount);
  const minimums = Array.from({ length: channelCount }, () => Array<number>(bucketCount).fill(0));
  const maximums = Array.from({ length: channelCount }, () => Array<number>(bucketCount).fill(0));
  for (let bucket = 0; bucket < bucketCount; bucket += 1) {
    const start = Math.floor((bucket * sampleCount) / bucketCount);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * sampleCount) / bucketCount));
    for (let channel = 0; channel < channelCount; channel += 1) {
      let minimum = 0;
      let maximum = 0;
      for (let sample = start; sample < end && sample < sampleCount; sample += 1) {
        const offset = (sample * channelCount + channel) * 4;
        const value = pcmFloat32Le.readFloatLE(offset);
        if (Number.isFinite(value)) {
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
      }
      const minimumChannel = minimums[channel];
      const maximumChannel = maximums[channel];
      if (minimumChannel !== undefined) minimumChannel[bucket] = minimum;
      if (maximumChannel !== undefined) maximumChannel[bucket] = maximum;
    }
  }
  return { schemaVersion: "1.0.0", channels: channelCount, bucketCount, minimums, maximums };
};

const defaultGeneratedViewProducer = async (context: GeneratedViewProducerContext): Promise<void> => {
  if (context.profile.kind !== "waveform") {
    const result = await spawnCaptured(
      context.ffmpegPath,
      generatedViewFfmpegArguments(context.sourceFilePath, context.outputPath, context.profile),
      context.signal,
      false,
    );
    if (result.exitCode !== 0) throw viewError("media.view.ffmpeg-failed", result.stderr.slice(-2_000));
    return;
  }
  const channelCount = context.profile.channels === "mono" ? 1 : 2;
  const result = await spawnCaptured(
    context.ffmpegPath,
    [
      "-v",
      "error",
      "-i",
      context.sourceFilePath,
      "-vn",
      "-ac",
      String(channelCount),
      "-ar",
      String(context.profile.sampleRate),
      "-f",
      "f32le",
      "pipe:1",
    ],
    context.signal,
    true,
  );
  if (result.exitCode !== 0) throw viewError("media.waveform.ffmpeg-failed", result.stderr.slice(-2_000));
  const envelope = buildWaveformEnvelope(result.stdout, channelCount, context.profile.width);
  await writeFile(context.outputPath, `${JSON.stringify(envelope)}\n`);
};

const spawnCaptured = (
  executable: string,
  arguments_: readonly string[],
  signal: AbortSignal | undefined,
  captureStdout: boolean,
): Promise<Readonly<{ exitCode: number; stdout: Buffer; stderr: string }>> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...arguments_], {
      signal,
      stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"],
    });
    const chunks: Buffer[] = [];
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    const stderrStream = child.stderr;
    if (stderrStream === null) {
      reject(new Error("Generated-view worker has no stderr pipe."));
      return;
    }
    stderrStream.setEncoding("utf8");
    stderrStream.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout: Buffer.concat(chunks), stderr });
    });
  });

const readVerifiedArtifact = async (
  manifestPath: string,
  targetDirectory: string,
  expected: Readonly<{
    sourceContentHash: string;
    profileFingerprint: string;
    cacheKey: string;
    kind: GeneratedViewProfile["kind"];
  }>,
): Promise<GeneratedViewArtifact | null> => {
  const serialized = await readFile(manifestPath, "utf8").catch(() => null);
  if (serialized === null) return null;
  try {
    const artifact = JSON.parse(serialized) as GeneratedViewArtifact;
    if (
      artifact.sourceContentHash !== expected.sourceContentHash ||
      artifact.profileFingerprint !== expected.profileFingerprint ||
      artifact.cacheKey !== expected.cacheKey ||
      artifact.kind !== expected.kind ||
      !isContainedOutput(targetDirectory, artifact.outputPath) ||
      (await sha256File(artifact.outputPath)) !== artifact.outputContentHash
    ) {
      return null;
    }
    return artifact;
  } catch {
    return null;
  }
};

const outputFileName = (profile: GeneratedViewProfile): string => {
  if (profile.kind === "waveform") return "waveform.json";
  return `${profile.kind}.${profile.format === "jpeg" ? "jpg" : "png"}`;
};

const assertGeneratedViewProfile = (profile: GeneratedViewProfile): void => {
  const integerFields =
    profile.kind === "thumbnail"
      ? [profile.width, profile.height]
      : profile.kind === "waveform"
        ? [profile.width, profile.sampleRate]
        : profile.kind === "contact-sheet"
          ? [profile.tileWidth, profile.tileHeight, profile.columns, profile.rows]
          : [profile.tileWidth, profile.tileHeight, profile.frameCount];
  if (integerFields.some((value) => !Number.isSafeInteger(value) || value <= 0 || value > 16_384)) {
    throw viewError("media.view.profile-invalid", "Generated-view profile has invalid bounded dimensions.");
  }
};

const canonicalJson = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Readonly<Record<string, unknown>>;
    return `{${Object.keys(record)
      .sort((left, right) => left.localeCompare(right, "en"))
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
};

const rationalExpression = (value: NormalizedRational): string => `${value.numerator}/${value.denominator}`;

const isContainedOutput = (directory: string, candidate: string): boolean => {
  const relative = path.relative(directory, candidate);
  return relative.length > 0 && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
};

const signalIsAborted = (signal: AbortSignal | undefined): boolean => signal?.aborted === true;

const assertHash = (value: string, label: string): void => {
  if (!/^[a-f0-9]{64}$/.test(value)) throw viewError("media.view.hash-invalid", `Invalid ${label} hash.`);
};

const viewError = (code: string, message: string): ChaiError =>
  new ChaiError({
    category: "media",
    code,
    correlationId: createCorrelationId(),
    stage: "generated-media-view",
    message,
    repairHint: "Regenerate the disposable view from the current source hash and validated profile.",
  });
