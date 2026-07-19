import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  HyperframesDiagnostic,
  HyperframesRangeArtifact,
  HyperframesRangeRequest,
  HyperframesStillArtifact,
  HyperframesStillRequest,
} from "./contracts.js";
import { pinnedHyperframesVersion } from "./contracts.js";
import { hyperframesDiagnostic } from "./diagnostics.js";
import type { HyperframesCommandRuntime, HyperframesProcessResult } from "./process-runtime.js";
import { validateHyperframesSource } from "./validation.js";
import type { HyperframesWorkerSelection } from "./worker-router.js";
import { normalizeRemotionPng } from "../remotion/png-normalization.js";

export class HyperframesRenderCancelledError extends Error {
  constructor(message = "HyperFrames render was cancelled; no valid artifact was committed.") {
    super(message);
    this.name = "HyperframesRenderCancelledError";
  }
}

export type HyperframesRangeEncoder = (input: {
  readonly inputPath: string;
  readonly outputPath: string;
  readonly startFrame: bigint;
  readonly endFrameExclusive: bigint;
  readonly codec: HyperframesRangeRequest["codec"];
  readonly signal: AbortSignal;
}) => Promise<void>;

export class HyperframesRenderer {
  readonly #runtime: HyperframesCommandRuntime;
  readonly #encodeRange: HyperframesRangeEncoder;
  readonly #boundWorkerPolicy: HyperframesWorkerSelection["policy"] | null;

  constructor(
    runtimeOrSelection: HyperframesCommandRuntime | HyperframesWorkerSelection,
    ffmpegExecutable = "ffmpeg",
    encodeRange?: HyperframesRangeEncoder,
  ) {
    this.#runtime = "runtime" in runtimeOrSelection ? runtimeOrSelection.runtime : runtimeOrSelection;
    this.#boundWorkerPolicy = "runtime" in runtimeOrSelection ? runtimeOrSelection.policy : null;
    this.#encodeRange =
      encodeRange ??
      ((input) =>
        runFfmpeg(
          ffmpegExecutable,
          input.inputPath,
          input.outputPath,
          input.startFrame,
          input.endFrameExclusive,
          input.codec,
          input.signal,
        ));
  }

  async renderStill(request: HyperframesStillRequest): Promise<HyperframesStillArtifact> {
    const frame = parseFrame(request.frame, "frame");
    if (frame >= BigInt(request.composition.durationFrames))
      throw new Error("HyperFrames still frame is outside the composition.");
    await this.#assertValid(request);
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-hyperframes-still-"));
    await mkdir(path.dirname(request.outputPath), { recursive: true });
    const diagnostics: HyperframesDiagnostic[] = [];
    try {
      const fps = `${request.composition.fps.numerator}/${request.composition.fps.denominator}`;
      const result = await this.#runtime.run(
        "render",
        [
          request.source.projectRoot,
          "--composition",
          path.relative(request.source.projectRoot, request.source.entryFile),
          "--output",
          temporaryRoot,
          "--format",
          "png-sequence",
          "--quality",
          "draft",
          "--workers",
          "1",
          "--fps",
          fps,
          "--variables",
          JSON.stringify(request.source.variableOverrides),
          "--strict-variables",
          "--strict",
          "--no-best-effort",
          "--quiet",
        ],
        { cwd: request.source.projectRoot, signal: request.signal },
      );
      if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
      diagnostics.push(...logDiagnostics(result, request.composition.compositionId, request.frame));
      const pngFiles = (await readdir(temporaryRoot, { recursive: true }))
        .filter((candidate) => candidate.toLowerCase().endsWith(".png"))
        .sort()
        .map((candidate) => path.join(temporaryRoot, candidate));
      if (pngFiles.length !== Number(request.composition.durationFrames)) {
        throw new Error(
          `HyperFrames exact sequence produced ${pngFiles.length.toString()} frames; expected ${request.composition.durationFrames}.`,
        );
      }
      const sourcePng = pngFiles[Number(frame)];
      if (sourcePng === undefined) throw new Error("HyperFrames exact frame artifact is missing.");
      await copyFile(sourcePng, request.outputPath);
      throwIfAborted(request.signal);
      const bytes = await readFile(request.outputPath);
      const normalized = normalizeRemotionPng(bytes);
      return {
        kind: "hyperframes-still",
        sourceId: request.source.sourceId,
        compositionId: request.composition.compositionId,
        frame: request.frame,
        outputPath: request.outputPath,
        artifactHash: sha256(bytes),
        normalizedPixelHash: normalized.normalizedPixelHash,
        compositorId: "hyperframes-cli",
        compositorVersion: pinnedHyperframesVersion,
        dependencyGraphHash: request.dependencySet.dependencyGraphHash,
        strictEnvironmentFingerprint: request.environment.strictEnvironmentFingerprint,
        settingsHash: request.environment.settingsHash,
        colorContractId: request.environment.colorContractId,
        alphaMode: request.environment.alphaMode,
        browserIdentity: request.environment.browserIdentity,
        trustClass: request.source.trustClass,
        cacheNamespace: request.dependencySet.cacheNamespace,
        diagnostics,
      };
    } catch (cause) {
      await rm(request.outputPath, { force: true });
      if (request.signal.aborted || isCancellation(cause)) throw new HyperframesRenderCancelledError();
      throw renderFailure(
        "hyperframes.still.failed",
        cause,
        request.composition.compositionId,
        request.frame,
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async renderRange(request: HyperframesRangeRequest): Promise<HyperframesRangeArtifact> {
    const startFrame = parseFrame(request.startFrame, "startFrame");
    const endFrameExclusive = parseFrame(request.endFrameExclusive, "endFrameExclusive");
    if (endFrameExclusive <= startFrame || endFrameExclusive > BigInt(request.composition.durationFrames)) {
      throw new Error("HyperFrames range must be non-empty, half-open, and inside the composition.");
    }
    await this.#assertValid(request);
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-hyperframes-range-"));
    const fullOutput = path.join(temporaryRoot, "full.mp4");
    await mkdir(path.dirname(request.outputPath), { recursive: true });
    const diagnostics: HyperframesDiagnostic[] = [];
    request.onProgress?.({ stage: "validating", progress: 0, message: "HyperFrames validation passed." });
    try {
      const fps = `${request.composition.fps.numerator}/${request.composition.fps.denominator}`;
      const variables = JSON.stringify(request.source.variableOverrides);
      const result = await this.#runtime.run(
        "render",
        [
          request.source.projectRoot,
          "--composition",
          path.relative(request.source.projectRoot, request.source.entryFile),
          "--output",
          fullOutput,
          "--format",
          "mp4",
          "--quality",
          "high",
          "--workers",
          "1",
          "--fps",
          fps,
          "--variables",
          variables,
          "--strict-variables",
          "--strict-all",
          "--no-best-effort",
          "--no-browser-gpu",
        ],
        {
          cwd: request.source.projectRoot,
          signal: request.signal,
          onOutput: (_stream, chunk) => {
            const progress = parseCliProgress(chunk);
            if (progress !== null)
              request.onProgress?.({ stage: "capturing", progress, message: "Capturing source frames." });
          },
        },
      );
      if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
      diagnostics.push(...logDiagnostics(result, request.composition.compositionId, request.startFrame));
      request.onProgress?.({ stage: "encoding", progress: 0, message: "Encoding exact frame range." });
      await this.#encodeRange({
        inputPath: fullOutput,
        outputPath: request.outputPath,
        startFrame,
        endFrameExclusive,
        codec: request.codec,
        signal: request.signal,
      });
      throwIfAborted(request.signal);
      request.onProgress?.({ stage: "committing", progress: 1, message: "Range artifact committed." });
      const bytes = await readFile(request.outputPath);
      return {
        kind: "hyperframes-range",
        sourceId: request.source.sourceId,
        compositionId: request.composition.compositionId,
        range: { startFrame: request.startFrame, endFrameExclusive: request.endFrameExclusive },
        outputPath: request.outputPath,
        artifactHash: sha256(bytes),
        codec: request.codec,
        compositorId: "hyperframes-cli",
        compositorVersion: pinnedHyperframesVersion,
        dependencyGraphHash: request.dependencySet.dependencyGraphHash,
        strictEnvironmentFingerprint: request.environment.strictEnvironmentFingerprint,
        settingsHash: request.environment.settingsHash,
        colorContractId: request.environment.colorContractId,
        alphaMode: request.environment.alphaMode,
        browserIdentity: request.environment.browserIdentity,
        trustClass: request.source.trustClass,
        cacheNamespace: request.dependencySet.cacheNamespace,
        diagnostics,
      };
    } catch (cause) {
      await rm(request.outputPath, { force: true });
      if (request.signal.aborted || isCancellation(cause)) throw new HyperframesRenderCancelledError();
      throw renderFailure(
        "hyperframes.range.failed",
        cause,
        request.composition.compositionId,
        request.startFrame,
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }

  async #assertValid(request: HyperframesStillRequest | HyperframesRangeRequest): Promise<void> {
    if (
      request.dependencySet.trustClass !== request.source.trustClass ||
      request.dependencySet.cacheNamespace === ""
    ) {
      throw new Error("HyperFrames dependency identity does not match the source trust policy.");
    }
    if (
      request.source.trustClass === "imported-untrusted" &&
      (this.#boundWorkerPolicy === null ||
        this.#boundWorkerPolicy.trustClass !== "imported-untrusted" ||
        this.#boundWorkerPolicy.cacheNamespace !== request.dependencySet.cacheNamespace)
    ) {
      throw new Error("Imported HyperFrames render requires its bound isolated worker selection.");
    }
    const validation = await validateHyperframesSource({
      source: request.source,
      composition: request.composition,
      runtime: this.#runtime,
      signal: request.signal,
    });
    if (!validation.valid) {
      throw new Error(
        `HyperFrames validation failed before render: ${validation.diagnostics
          .filter((diagnostic) => diagnostic.severity === "error")
          .map((diagnostic) => diagnostic.message)
          .join("; ")}`,
      );
    }
    if (validation.workerPolicy.cacheNamespace !== request.dependencySet.cacheNamespace) {
      throw new Error("HyperFrames dependency cache namespace does not match the worker policy.");
    }
  }
}

const runFfmpeg = (
  executable: string,
  inputPath: string,
  outputPath: string,
  startFrame: bigint,
  endFrameExclusive: bigint,
  codec: HyperframesRangeRequest["codec"],
  signal: AbortSignal,
): Promise<void> => {
  const encoder = codec === "h264" ? "libx264" : codec === "vp9" ? "libvpx-vp9" : "prores_ks";
  const pixelFormat = codec === "prores" ? "yuv422p10le" : "yuv420p";
  const filter = `trim=start_frame=${startFrame.toString()}:end_frame=${endFrameExclusive.toString()},setpts=PTS-STARTPTS`;
  if (signal.aborted) return Promise.reject(new DOMException("FFmpeg range trim cancelled.", "AbortError"));
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        inputPath,
        "-vf",
        filter,
        "-an",
        "-c:v",
        encoder,
        "-pix_fmt",
        pixelFormat,
        outputPath,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
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
      if (signal.aborted) reject(new DOMException("FFmpeg range trim cancelled.", "AbortError"));
      else if (exitCode === 0) resolve();
      else reject(new Error(`FFmpeg exact range encode failed (${String(exitCode)}): ${stderr}`));
    });
  });
};

const logDiagnostics = (
  result: HyperframesProcessResult,
  compositionId: string,
  frame: string,
): readonly HyperframesDiagnostic[] => {
  const combined = `${result.stdout}\n${result.stderr}`;
  const relevant = combined
    .split("\n")
    .filter((line) => /\b(?:WARN|ERROR|fallback|suspect)\b/i.test(line))
    .slice(0, 20);
  return relevant.map((message) =>
    hyperframesDiagnostic({
      category: "render",
      code: "hyperframes.render.log",
      severity: /\bERROR\b/i.test(message) ? "error" : "warning",
      stage: "hyperframes-render",
      message: message.slice(0, 2_000),
      repairHint: "Inspect the HyperFrames capture log and verify the affected frame or fallback path.",
      compositionId,
      frame,
    }),
  );
};

const parseCliProgress = (chunk: string): number | null => {
  const match = /"totalFrames":(\d+)[\s\S]*?"framesCompleted":(\d+)/.exec(chunk);
  if (match?.[1] === undefined || match[2] === undefined) return null;
  const total = Number(match[1]);
  const completed = Number(match[2]);
  return total > 0 && Number.isFinite(completed) ? Math.min(1, Math.max(0, completed / total)) : null;
};

const renderFailure = (
  code: string,
  cause: unknown,
  compositionId: string,
  frame: string,
): AggregateError => {
  const diagnostic = hyperframesDiagnostic({
    category: "render",
    code,
    severity: "error",
    stage: "hyperframes-render",
    message: cause instanceof Error ? cause.message : String(cause),
    repairHint: "Inspect mapped validation and capture diagnostics, correct the source, and retry.",
    compositionId,
    frame,
  });
  return new AggregateError([new Error(`${diagnostic.code}: ${diagnostic.message}`)], diagnostic.message);
};

const parseFrame = (value: string, field: string): bigint => {
  if (!/^(?:0|[1-9][0-9]{0,77})$/.test(value)) throw new Error(`HyperFrames ${field} is invalid.`);
  return BigInt(value);
};

const sha256 = (value: Uint8Array): string => createHash("sha256").update(value).digest("hex");

const throwIfAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new HyperframesRenderCancelledError();
};

const isCancellation = (cause: unknown): boolean =>
  cause instanceof HyperframesRenderCancelledError ||
  (cause instanceof Error && (cause.name === "AbortError" || /cancel/i.test(cause.message)));
