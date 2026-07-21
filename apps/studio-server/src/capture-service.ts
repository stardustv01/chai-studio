import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CaptureJobManager,
  type CaptureJobState,
  type CaptureRenderer,
  type CaptureRequest,
} from "@chai-studio/bridge";
import { createDeliveryProfile, type DeliveryProfile, type RenderScope } from "@chai-studio/render";
import sharp from "sharp";
import { renderFullTimeline, type FullTimelineCaptureOptions } from "./full-timeline-compositor.js";
import type { StudioInteractionService } from "./interaction-service.js";
import type { ProjectSessionService } from "./project-service.js";
import type { RenderApiService } from "./render-service.js";

type ProjectSnapshot = Awaited<ReturnType<ProjectSessionService["snapshot"]>>;

const supportedKinds = new Set<CaptureRequest["kind"]>([
  "isolated-selection",
  "before-effects",
  "alpha",
  "range",
  "contact-sheet",
]);

export class CaptureApiService {
  readonly #projects: ProjectSessionService;
  readonly #interactions: StudioInteractionService;
  readonly #renders: RenderApiService;
  readonly #jobs = new Map<string, CaptureJobManager>();

  constructor(input: {
    readonly projects: ProjectSessionService;
    readonly interactions: StudioInteractionService;
    readonly renders: RenderApiService;
  }) {
    this.#projects = input.projects;
    this.#interactions = input.interactions;
    this.#renders = input.renders;
  }

  async start(request: CaptureRequest): Promise<CaptureJobState> {
    if (!supportedKinds.has(request.kind) || request.mode !== "fidelity") {
      throw new Error("Exact capture job kind is unsupported.");
    }
    const snapshot = await this.#projects.snapshot();
    const projectRoot = this.#projects.openRootPath();
    const context = await this.#interactions.context();
    validateRequest(request, snapshot, context.selectedIds);
    const trust = await this.#renders.securityWorkspace();
    const nonce = randomUUID();
    const renderer = exactCaptureRenderer({
      projects: this.#projects,
      snapshot,
      projectRoot,
      nonce,
      nativeTrustByAssetId: new Map(
        trust.records.map((record) => [
          record.compositionId,
          record.trustClass === "trusted_authored" ? "trusted-authored" : "imported-untrusted",
        ]),
      ),
    });
    const manager = new CaptureJobManager({
      projectRoot,
      interactive: failClosedInteractiveRenderer,
      fidelity: renderer,
    });
    const job = manager.start({
      request,
      context,
      current: {
        projectId: snapshot.project.projectId,
        revisionId: snapshot.pointer.revisionId,
      },
    });
    this.#jobs.set(job.id, manager);
    return job;
  }

  state(id: string): CaptureJobState {
    return this.#manager(id).state(id);
  }

  cancel(id: string): CaptureJobState {
    return this.#manager(id).cancel(id);
  }

  #manager(id: string): CaptureJobManager {
    const manager = this.#jobs.get(id);
    if (manager === undefined) throw new Error(`Unknown capture job: ${id}.`);
    return manager;
  }
}

const failClosedInteractiveRenderer: CaptureRenderer = {
  capture: () => Promise.reject(new Error("Exact capture jobs cannot use the preview compositor.")),
};

const exactCaptureRenderer = (input: {
  readonly projects: ProjectSessionService;
  readonly snapshot: ProjectSnapshot;
  readonly projectRoot: string;
  readonly nonce: string;
  readonly nativeTrustByAssetId: ReadonlyMap<string, "trusted-authored" | "imported-untrusted">;
}): CaptureRenderer => ({
  capture: async (request) => {
    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "chai-studio-capture-"));
    try {
      if (request.kind === "contact-sheet") {
        const frames = await renderContactFrames(input, request, temporaryRoot);
        const bytes = await contactSheet(
          frames,
          input.snapshot.project.video.width,
          input.snapshot.project.video.height,
        );
        return [
          {
            relativePath: `captures/artifacts/${input.nonce}/contact-sheet.png`,
            bytes,
            mimeType: "image/png" as const,
          },
        ];
      }
      const scope = captureScope(request);
      const profile = captureProfile(
        input.snapshot,
        request.kind === "range" ? "sequence" : "still",
        request.alpha,
      );
      const capture = captureOptions(request, input.snapshot);
      const rendered = await renderFullTimeline({
        projects: input.projects,
        snapshot: input.snapshot,
        projectRoot: input.projectRoot,
        profile,
        scope,
        outputDirectory: temporaryRoot,
        signal: request.signal,
        report: () => undefined,
        nativeTrustByAssetId: input.nativeTrustByAssetId,
        capture,
      });
      const names = [rendered.primaryRelativePath, ...rendered.additionalRelativePaths];
      return await Promise.all(
        names.map(async (name) => ({
          relativePath: `captures/artifacts/${input.nonce}/${path.basename(name)}`,
          bytes: await readFile(path.join(temporaryRoot, name)),
          mimeType: "image/png" as const,
        })),
      );
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  },
});

const renderContactFrames = async (
  input: Parameters<typeof exactCaptureRenderer>[0],
  request: Parameters<CaptureRenderer["capture"]>[0],
  temporaryRoot: string,
): Promise<readonly Readonly<{ frame: string; bytes: Uint8Array }>[]> => {
  const results: Readonly<{ frame: string; bytes: Uint8Array }>[] = [];
  for (const frame of request.frames) {
    const outputDirectory = path.join(temporaryRoot, `frame-${frame}`);
    const rendered = await renderFullTimeline({
      projects: input.projects,
      snapshot: input.snapshot,
      projectRoot: input.projectRoot,
      profile: captureProfile(input.snapshot, "still", false),
      scope: { kind: "frame", frame },
      outputDirectory,
      signal: request.signal,
      report: () => undefined,
      nativeTrustByAssetId: input.nativeTrustByAssetId,
      capture: { includeAudio: false },
    });
    results.push({ frame, bytes: await readFile(path.join(outputDirectory, rendered.primaryRelativePath)) });
  }
  return results;
};

const contactSheet = async (
  frames: readonly Readonly<{ frame: string; bytes: Uint8Array }>[],
  sourceWidth: number,
  sourceHeight: number,
): Promise<Uint8Array> => {
  const columns = Math.min(3, frames.length);
  const rows = Math.ceil(frames.length / columns);
  const cellWidth = Math.min(640, sourceWidth);
  const imageHeight = Math.round((cellWidth * sourceHeight) / sourceWidth);
  const labelHeight = 34;
  const cellHeight = imageHeight + labelHeight;
  const composites = await Promise.all(
    frames.map(async ({ frame, bytes }, index) => ({
      input: await sharp(bytes)
        .resize(cellWidth, imageHeight, { fit: "fill" })
        .extend({
          bottom: labelHeight,
          background: "#0b111b",
        })
        .composite([
          {
            input: Buffer.from(
              `<svg width="${String(cellWidth)}" height="${String(labelHeight)}"><text x="12" y="23" fill="#e8eef8" font-family="monospace" font-size="16">Frame ${frame}</text></svg>`,
            ),
            left: 0,
            top: imageHeight,
          },
        ])
        .png({ compressionLevel: 9 })
        .toBuffer(),
      left: (index % columns) * cellWidth,
      top: Math.floor(index / columns) * cellHeight,
    })),
  );
  return sharp({
    create: {
      width: columns * cellWidth,
      height: rows * cellHeight,
      channels: 4,
      background: "#070b12",
    },
  })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toBuffer();
};

const captureProfile = (
  snapshot: ProjectSnapshot,
  output: "still" | "sequence",
  alpha: boolean,
): DeliveryProfile =>
  createDeliveryProfile({
    id: `capture-${output}-${alpha ? "alpha" : "opaque"}`,
    name: `Exact ${output} capture`,
    kind: output === "still" ? "still" : "image-sequence",
    purpose: "final",
    outputKind: output === "still" ? "still" : "image-sequence",
    width: snapshot.project.video.width,
    height: snapshot.project.video.height,
    fps: output === "still" ? null : snapshot.timeline.fps,
    container: "png",
    videoCodec: "png",
    audioCodec: null,
    audioSampleRate: null,
    colorSpace: "source",
    alpha: alpha ? "straight" : "none",
    sourcePolicy: "originals-required",
    strictEnvironment: true,
    outputPathTemplate: "captures/{project}-{revision}-{frame}.png",
  });

const captureScope = (request: CaptureRequest): RenderScope => {
  if (request.kind === "range") {
    const range = request.frameRange ?? fail("Review range capture requires an I/O range.");
    return { kind: "selected-range", ...range };
  }
  return { kind: "frame", frame: request.frames[0] ?? fail("Capture frame is missing.") };
};

const captureOptions = (request: CaptureRequest, snapshot: ProjectSnapshot): FullTimelineCaptureOptions => {
  if (request.kind === "isolated-selection" || request.kind === "before-effects") {
    const selected = new Set(request.isolatedEntityIds);
    if (request.kind === "before-effects") {
      const clips = snapshot.timeline.tracks
        .flatMap((track) => track.clips)
        .filter((clip) => selected.has(clip.id));
      if (clips.some((clip) => clip.engine !== "shared")) {
        throw new Error("Before-effects capture cannot bypass native engine animation exactly.");
      }
    }
    return {
      includeClipIds: selected,
      propertyMode: request.kind === "before-effects" ? "defaults" : "evaluated",
      includeCaptions: false,
      includeAudio: false,
    };
  }
  return { includeAudio: false };
};

const validateRequest = (
  request: CaptureRequest,
  snapshot: ProjectSnapshot,
  selectedIds: readonly string[],
): void => {
  if (request.frames.length === 0 || request.frames.some((frame) => !validFrame(frame, snapshot))) {
    throw new Error("Capture frames must be inside the current timeline.");
  }
  if (request.kind === "isolated-selection" || request.kind === "before-effects") {
    const clipIds = new Set(
      snapshot.timeline.tracks
        .filter((track) => track.kind === "video")
        .flatMap((track) => track.clips)
        .map((clip) => clip.id),
    );
    if (request.isolatedEntityIds.length === 0 || request.isolatedEntityIds.some((id) => !clipIds.has(id))) {
      throw new Error("Selected-clip capture requires one or more current timeline clips.");
    }
    if (request.isolatedEntityIds.some((id) => !selectedIds.includes(id))) {
      throw new Error("Selected-clip capture IDs do not match the current editor selection.");
    }
  }
  if (request.kind === "range" || request.kind === "contact-sheet") {
    const range = request.frameRange ?? fail("Range capture requires marked In and Out frames.");
    const start = BigInt(range.startFrame);
    const end = BigInt(range.endFrameExclusive);
    if (start < 0n || end <= start || end > BigInt(snapshot.timeline.durationFrames)) {
      throw new Error("Capture I/O range is invalid.");
    }
    if (request.kind === "range" && end - start > 900n) {
      throw new Error("Review range capture is limited to 900 frames per job.");
    }
    if (request.kind === "contact-sheet" && (request.frames.length < 2 || request.frames.length > 12)) {
      throw new Error("Contact sheet capture requires 2 to 12 sampled frames.");
    }
  }
};

const validFrame = (frame: string, snapshot: ProjectSnapshot): boolean => {
  try {
    const value = BigInt(frame);
    return value >= 0n && value < BigInt(snapshot.timeline.durationFrames);
  } catch {
    return false;
  }
};

const fail = (message: string): never => {
  throw new Error(message);
};
