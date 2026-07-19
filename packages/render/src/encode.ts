import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { NormalizedRational } from "@chai-studio/schema";
import type { RenderOutputClass } from "./contracts.js";

export interface DeliveryEncodeProfile {
  readonly id: string;
  readonly outputClass: RenderOutputClass;
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: NormalizedRational | null;
  readonly container: "mp4" | "mov" | "webm" | "wav" | "png" | "jpg" | "directory";
  readonly videoCodec: string | null;
  readonly audioCodec: string | null;
  readonly pixelFormat: string | null;
  readonly colorSpace: string | null;
  readonly alphaMode: "opaque" | "straight" | "premultiplied" | null;
  readonly quality: "draft" | "review" | "mezzanine" | "final";
}

export type AtomicEncodeRunner = (input: {
  readonly inputPaths: readonly string[];
  readonly temporaryOutputPath: string;
  readonly profile: DeliveryEncodeProfile;
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
}) => Promise<void>;

export const runAtomicEncode = async (input: {
  readonly inputPaths: readonly string[];
  readonly outputPath: string;
  readonly profile: DeliveryEncodeProfile;
  readonly signal: AbortSignal;
  readonly report: (progress: number) => void;
  readonly runner?: AtomicEncodeRunner;
  readonly checkpoint?: (point: "encode-finalize") => void | Promise<void>;
}): Promise<Readonly<{ outputPath: string; byteLength: number }>> => {
  validateDeliveryEncodeProfile(input.profile);
  if (!path.isAbsolute(input.outputPath) || input.inputPaths.length === 0) {
    throw new Error("Atomic encode paths are invalid.");
  }
  if (input.signal.aborted) throw new DOMException("Encode was cancelled.", "AbortError");
  await mkdir(path.dirname(input.outputPath), { recursive: true, mode: 0o700 });
  const temporaryOutputPath = path.join(
    path.dirname(input.outputPath),
    `.${path.basename(input.outputPath)}.${randomUUID()}.partial`,
  );
  try {
    await (input.runner ?? ffmpegEncodeRunner)({
      inputPaths: input.inputPaths,
      temporaryOutputPath,
      profile: input.profile,
      signal: input.signal,
      report: (progress) => {
        input.report(Math.min(0.99, Math.max(0, progress)));
      },
    });
    throwIfAborted(input.signal, "Encode was cancelled.");
    const metadata = await stat(temporaryOutputPath);
    if (!metadata.isFile() || metadata.size === 0) throw new Error("Encoder produced no valid artifact.");
    await input.checkpoint?.("encode-finalize");
    await rename(temporaryOutputPath, input.outputPath);
    input.report(1);
    return { outputPath: input.outputPath, byteLength: metadata.size };
  } catch (cause) {
    await rm(temporaryOutputPath, { force: true });
    throw cause;
  }
};

const throwIfAborted = (signal: AbortSignal, message: string): void => {
  if (signal.aborted) throw new DOMException(message, "AbortError");
};

export const validateDeliveryEncodeProfile = (profile: DeliveryEncodeProfile): void => {
  if (!/^[A-Za-z][A-Za-z0-9._:-]{2,127}$/.test(profile.id)) {
    throw new Error("Delivery encode profile identity is invalid.");
  }
  const visual = profile.outputClass !== "audio-only";
  if (
    visual &&
    (profile.width === null ||
      profile.height === null ||
      profile.fps === null ||
      profile.width < 1 ||
      profile.height < 1 ||
      profile.videoCodec === null)
  ) {
    throw new Error("Visual output profile requires dimensions, rational FPS, and a video codec.");
  }
  if (profile.outputClass === "audio-only" && (profile.audioCodec === null || profile.videoCodec !== null)) {
    throw new Error("Audio-only profile must contain audio and no video codec.");
  }
  if (profile.outputClass === "transparent-overlay" && profile.alphaMode === "opaque") {
    throw new Error("Transparent overlay profile cannot use opaque alpha.");
  }
  if (
    (profile.outputClass === "still" ||
      profile.outputClass === "thumbnail" ||
      profile.outputClass === "contact-sheet") &&
    profile.container !== "png" &&
    profile.container !== "jpg"
  ) {
    throw new Error("Still output classes require an image container.");
  }
  if (profile.outputClass === "image-sequence" && profile.container !== "directory") {
    throw new Error("Image sequence output requires a directory container.");
  }
};

const ffmpegEncodeRunner: AtomicEncodeRunner = ({
  inputPaths,
  temporaryOutputPath,
  profile,
  signal,
  report,
}) =>
  new Promise((resolve, reject) => {
    const arguments_ = ["-hide_banner", "-loglevel", "error", "-y"];
    for (const inputPath of inputPaths) arguments_.push("-i", inputPath);
    if (profile.videoCodec !== null) arguments_.push("-c:v", profile.videoCodec);
    if (profile.audioCodec !== null) arguments_.push("-c:a", profile.audioCodec);
    if (profile.pixelFormat !== null) arguments_.push("-pix_fmt", profile.pixelFormat);
    arguments_.push(temporaryOutputPath);
    const child = spawn("ffmpeg", arguments_, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(new DOMException("Encode was cancelled.", "AbortError"));
      else if (exitCode === 0) {
        report(1);
        resolve();
      } else reject(new Error(`FFmpeg encode failed (${String(exitCode)}): ${stderr}`));
    });
  });
