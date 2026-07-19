import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { ChaiError, createCorrelationId } from "@chai-studio/diagnostics";
import { compareRationals, normalizeRational, type NormalizedRational } from "@chai-studio/schema";

export interface InspectedVideoStream {
  readonly index: number;
  readonly codec: string;
  readonly profile: string | null;
  readonly pixelFormat: string | null;
  readonly width: number;
  readonly height: number;
  readonly averageFrameRate: NormalizedRational | null;
  readonly realFrameRate: NormalizedRational | null;
  readonly timeBase: NormalizedRational | null;
  readonly durationSeconds: NormalizedRational | null;
  readonly frameCount: string | null;
  readonly hasAlpha: boolean;
  readonly variableFrameRate: boolean;
}

export interface InspectedAudioStream {
  readonly index: number;
  readonly codec: string;
  readonly profile: string | null;
  readonly sampleRate: number | null;
  readonly channels: number | null;
  readonly channelLayout: string | null;
  readonly timeBase: NormalizedRational | null;
  readonly durationSeconds: NormalizedRational | null;
}

export interface MediaInspectionV1 {
  readonly schemaVersion: "1.0.0";
  readonly contentHash: string;
  readonly probeVersion: string;
  readonly containerNames: readonly string[];
  readonly containerLongName: string | null;
  readonly durationSeconds: NormalizedRational | null;
  readonly sizeBytes: string | null;
  readonly videoStreams: readonly InspectedVideoStream[];
  readonly audioStreams: readonly InspectedAudioStream[];
  readonly hasVideo: boolean;
  readonly hasAudio: boolean;
  readonly hasAlpha: boolean;
  readonly variableFrameRate: boolean;
}

export interface InspectMediaFileInput {
  readonly filePath: string;
  readonly contentHash: string;
  readonly cacheDirectory?: string;
  readonly ffprobePath?: string;
  readonly runProbe?: (filePath: string) => Promise<Readonly<{ stdout: string; probeVersion: string }>>;
}

export const inspectMediaFile = async (input: InspectMediaFileInput): Promise<MediaInspectionV1> => {
  if (!/^[a-f0-9]{64}$/.test(input.contentHash)) {
    throw inspectionError("media.inspect.hash-invalid", "Media inspection requires a valid SHA-256 hash.");
  }
  const cachePath =
    input.cacheDirectory === undefined
      ? null
      : path.join(input.cacheDirectory, `${input.contentHash}.ffprobe-v1.json`);
  if (cachePath !== null) {
    const cached = await readInspectionCache(cachePath, input.contentHash);
    if (cached !== null) return cached;
  }
  const probe =
    input.runProbe === undefined
      ? await runFfprobe(input.filePath, input.ffprobePath ?? "ffprobe")
      : await input.runProbe(input.filePath);
  const inspection = parseFfprobeOutput(probe.stdout, input.contentHash, probe.probeVersion);
  if (cachePath !== null) await writeInspectionCache(cachePath, inspection);
  return inspection;
};

export const parseFfprobeOutput = (
  output: string,
  contentHash: string,
  probeVersion: string,
): MediaInspectionV1 => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output) as unknown;
  } catch (error) {
    throw inspectionError("media.inspect.output-invalid", "ffprobe returned invalid JSON.", error);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.streams) || !isRecord(parsed.format)) {
    throw inspectionError("media.inspect.contract-invalid", "ffprobe output lacks streams or format data.");
  }
  const videoStreams: InspectedVideoStream[] = [];
  const audioStreams: InspectedAudioStream[] = [];
  for (const value of parsed.streams) {
    if (!isRecord(value)) continue;
    if (value.codec_type === "video") videoStreams.push(parseVideoStream(value));
    if (value.codec_type === "audio") audioStreams.push(parseAudioStream(value));
  }
  const containerNames =
    stringValue(parsed.format.format_name)
      ?.split(",")
      .map((name) => name.trim())
      .filter((name) => name.length > 0)
      .sort((left, right) => left.localeCompare(right, "en")) ?? [];
  const inspection: MediaInspectionV1 = {
    schemaVersion: "1.0.0",
    contentHash,
    probeVersion,
    containerNames,
    containerLongName: stringValue(parsed.format.format_long_name),
    durationSeconds: decimalRational(parsed.format.duration),
    sizeBytes: integerString(parsed.format.size),
    videoStreams: videoStreams.sort((left, right) => left.index - right.index),
    audioStreams: audioStreams.sort((left, right) => left.index - right.index),
    hasVideo: videoStreams.length > 0,
    hasAudio: audioStreams.length > 0,
    hasAlpha: videoStreams.some((stream) => stream.hasAlpha),
    variableFrameRate: videoStreams.some((stream) => stream.variableFrameRate),
  };
  return assertMediaInspection(inspection);
};

export const assertMediaInspection = (value: MediaInspectionV1): MediaInspectionV1 => {
  if (
    !/^[a-f0-9]{64}$/.test(value.contentHash) ||
    value.probeVersion.trim().length === 0 ||
    value.videoStreams.some((stream) => stream.width <= 0 || stream.height <= 0) ||
    value.audioStreams.some(
      (stream) =>
        (stream.sampleRate !== null && stream.sampleRate <= 0) ||
        (stream.channels !== null && stream.channels <= 0),
    )
  ) {
    throw inspectionError("media.inspect.result-invalid", "Media inspection result violates its contract.");
  }
  return value;
};

const parseVideoStream = (stream: Readonly<Record<string, unknown>>): InspectedVideoStream => {
  const averageFrameRate = ratioRational(stream.avg_frame_rate);
  const realFrameRate = ratioRational(stream.r_frame_rate);
  const pixelFormat = stringValue(stream.pix_fmt);
  return {
    index: nonNegativeInteger(stream.index, "video stream index"),
    codec: requiredString(stream.codec_name, "video codec"),
    profile: stringValue(stream.profile),
    pixelFormat,
    width: positiveInteger(stream.width, "video width"),
    height: positiveInteger(stream.height, "video height"),
    averageFrameRate,
    realFrameRate,
    timeBase: ratioRational(stream.time_base),
    durationSeconds: decimalRational(stream.duration),
    frameCount: integerString(stream.nb_frames),
    hasAlpha: pixelFormat === null ? false : /^(?:argb|abgr|rgba|bgra|yuva|gbrap)/i.test(pixelFormat),
    variableFrameRate:
      averageFrameRate !== null &&
      realFrameRate !== null &&
      compareRationals(averageFrameRate, realFrameRate) !== 0,
  };
};

const parseAudioStream = (stream: Readonly<Record<string, unknown>>): InspectedAudioStream => ({
  index: nonNegativeInteger(stream.index, "audio stream index"),
  codec: requiredString(stream.codec_name, "audio codec"),
  profile: stringValue(stream.profile),
  sampleRate: optionalPositiveInteger(stream.sample_rate, "audio sample rate"),
  channels: optionalPositiveInteger(stream.channels, "audio channels"),
  channelLayout: stringValue(stream.channel_layout),
  timeBase: ratioRational(stream.time_base),
  durationSeconds: decimalRational(stream.duration),
});

const runFfprobe = async (
  filePath: string,
  executable: string,
): Promise<Readonly<{ stdout: string; probeVersion: string }>> => {
  const result = await spawnCaptured(executable, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    "--",
    filePath,
  ]);
  if (result.exitCode !== 0) {
    throw inspectionError(
      "media.inspect.ffprobe-failed",
      `ffprobe failed with exit code ${String(result.exitCode)}: ${result.stderr.slice(-2_000)}`,
    );
  }
  const version = await spawnCaptured(executable, ["-version"]);
  const probeVersion = version.stdout.split(/\r?\n/, 1)[0]?.trim() ?? "ffprobe-unknown";
  return { stdout: result.stdout, probeVersion };
};

const spawnCaptured = (
  executable: string,
  arguments_: readonly string[],
): Promise<Readonly<{ exitCode: number; stdout: string; stderr: string }>> =>
  new Promise((resolve, reject) => {
    const child = spawn(executable, [...arguments_], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? 1, stdout, stderr });
    });
  });

const readInspectionCache = async (
  cachePath: string,
  contentHash: string,
): Promise<MediaInspectionV1 | null> => {
  const serialized = await readFile(cachePath, "utf8").catch(() => null);
  if (serialized === null) return null;
  try {
    const value = JSON.parse(serialized) as MediaInspectionV1;
    return value.contentHash === contentHash ? assertMediaInspection(value) : null;
  } catch {
    return null;
  }
};

const writeInspectionCache = async (cachePath: string, inspection: MediaInspectionV1): Promise<void> => {
  await mkdir(path.dirname(cachePath), { recursive: true });
  const temporaryPath = `${cachePath}.${String(process.pid)}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(inspection, null, 2)}\n`);
  await rename(temporaryPath, cachePath);
};

const ratioRational = (value: unknown): NormalizedRational | null => {
  if (typeof value !== "string") return null;
  const match = /^(-?[0-9]+)\/([0-9]+)$/.exec(value);
  const numeratorText = match?.[1];
  const denominatorText = match?.[2];
  if (numeratorText === undefined || denominatorText === undefined) return null;
  const numerator = BigInt(numeratorText);
  const denominator = BigInt(denominatorText);
  if (numerator <= 0n || denominator <= 0n) return null;
  return normalizeRational(numerator, denominator);
};

const decimalRational = (value: unknown): NormalizedRational | null => {
  if (typeof value !== "string" || !/^[0-9]+(?:\.[0-9]+)?$/.test(value)) return null;
  const [whole = "0", fraction = ""] = value.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  return normalizeRational(BigInt(`${whole}${fraction}`), denominator);
};

const integerString = (value: unknown): string | null =>
  typeof value === "string" && /^(?:0|[1-9][0-9]*)$/.test(value) ? value : null;

const stringValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value : null;

const requiredString = (value: unknown, label: string): string => {
  const result = stringValue(value);
  if (result === null) throw inspectionError("media.inspect.field-missing", `ffprobe ${label} is missing.`);
  return result;
};

const positiveInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw inspectionError("media.inspect.field-invalid", `ffprobe ${label} is invalid.`);
  }
  return value;
};

const nonNegativeInteger = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw inspectionError("media.inspect.field-invalid", `ffprobe ${label} is invalid.`);
  }
  return value;
};

const optionalPositiveInteger = (value: unknown, label: string): number | null => {
  if (value === undefined) return null;
  const numeric = typeof value === "string" && /^[0-9]+$/.test(value) ? Number(value) : value;
  return positiveInteger(numeric, label);
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const inspectionError = (code: string, message: string, cause?: unknown): ChaiError =>
  new ChaiError({
    category: "media",
    code,
    correlationId: createCorrelationId(),
    stage: "media-inspection",
    message,
    repairHint: "Inspect the original file with a supported ffprobe build and retain hash-keyed evidence.",
    ...(cause === undefined ? {} : { cause }),
  });
