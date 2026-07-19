import { randomUUID } from "node:crypto";
import { mkdir, open, rename } from "node:fs/promises";
import path from "node:path";
import type { CaptureKind, CaptureManifest, PreviewMode, SelectionContextManifest } from "./manifests.js";
import { assertFreshContext, sha256Bytes, writeCaptureManifest } from "./manifests.js";

export interface CaptureRequest {
  readonly kind: CaptureKind;
  readonly mode: PreviewMode;
  readonly frames: readonly string[];
  readonly frameRange: Readonly<{ startFrame: string; endFrameExclusive: string }> | null;
  readonly isolatedEntityIds: readonly string[];
  readonly effectsApplied: boolean;
  readonly alpha: boolean;
  readonly comparisonSide: "a" | "b" | null;
}

export interface CaptureRenderer {
  capture(
    input: CaptureRequest & Readonly<{ signal: AbortSignal; context: SelectionContextManifest }>,
  ): Promise<
    readonly Readonly<{
      relativePath: string;
      bytes: Uint8Array;
      mimeType: "image/png" | "application/json";
    }>[]
  >;
}

export interface CaptureJobState {
  readonly id: string;
  readonly status: "queued" | "running" | "completed" | "failed" | "cancelled";
  readonly request: CaptureRequest;
  readonly manifest: CaptureManifest | null;
  readonly error: string | null;
}

export class CaptureJobManager {
  readonly #projectRoot: string;
  readonly #interactive: CaptureRenderer;
  readonly #fidelity: CaptureRenderer;
  readonly #jobs = new Map<string, CaptureJobState>();
  readonly #controllers = new Map<string, AbortController>();

  constructor(input: { projectRoot: string; interactive: CaptureRenderer; fidelity: CaptureRenderer }) {
    this.#projectRoot = input.projectRoot;
    this.#interactive = input.interactive;
    this.#fidelity = input.fidelity;
  }

  start(input: {
    readonly request: CaptureRequest;
    readonly context: SelectionContextManifest;
    readonly current: Readonly<{ projectId: string; revisionId: string }>;
    readonly now?: () => Date;
  }): CaptureJobState {
    assertFreshContext(input.context, input.current);
    const id = `capture-job-${randomUUID()}`;
    const controller = new AbortController();
    const initial: CaptureJobState = {
      id,
      status: "queued",
      request: input.request,
      manifest: null,
      error: null,
    };
    this.#jobs.set(id, initial);
    this.#controllers.set(id, controller);
    void this.#run(id, input.request, input.context, input.now ?? (() => new Date()), controller);
    return initial;
  }

  state(id: string): CaptureJobState {
    const job = this.#jobs.get(id);
    if (job === undefined) throw new Error(`Unknown capture job: ${id}.`);
    return job;
  }

  cancel(id: string): CaptureJobState {
    const job = this.state(id);
    if (job.status === "queued" || job.status === "running") this.#controllers.get(id)?.abort();
    return this.state(id);
  }

  async #run(
    id: string,
    request: CaptureRequest,
    context: SelectionContextManifest,
    now: () => Date,
    controller: AbortController,
  ): Promise<void> {
    this.#jobs.set(id, { id, status: "running", request, manifest: null, error: null });
    const startedAt = now().toISOString();
    try {
      const renderer = request.mode === "fidelity" ? this.#fidelity : this.#interactive;
      const outputs = await renderer.capture({ ...request, context, signal: controller.signal });
      if (controller.signal.aborted) throw new DOMException("Capture cancelled", "AbortError");
      if (outputs.length === 0) throw new Error("Capture renderer produced no outputs.");
      for (const output of outputs) await writeOutput(this.#projectRoot, output.relativePath, output.bytes);
      const mimeType = outputs.every((output) => output.mimeType === "image/png")
        ? ("image/png" as const)
        : ("application/json" as const);
      const manifest: CaptureManifest = {
        schemaVersion: "1.0.0",
        id: `capture-${randomUUID()}`,
        jobId: id,
        projectId: context.projectId,
        revisionId: context.revisionId,
        timelineId: context.timelineId,
        contextId: context.contextId,
        kind: request.kind,
        frames: request.frames,
        frameRange: request.frameRange,
        mode: request.mode,
        renderer: request.mode === "fidelity" ? "final-compositor" : "preview-compositor",
        parityEligible: request.mode === "fidelity",
        isolatedEntityIds: request.isolatedEntityIds,
        effectsApplied: request.effectsApplied,
        alpha: request.alpha,
        comparisonSide: request.comparisonSide,
        outputPaths: outputs.map((output) => output.relativePath),
        outputHashes: outputs.map((output) => sha256Bytes(output.bytes)),
        mimeType,
        createdAt: startedAt,
        completedAt: now().toISOString(),
      };
      await writeCaptureManifest(this.#projectRoot, manifest);
      this.#jobs.set(id, { id, status: "completed", request, manifest, error: null });
    } catch (cause) {
      const cancelled =
        controller.signal.aborted || (cause instanceof DOMException && cause.name === "AbortError");
      this.#jobs.set(id, {
        id,
        status: cancelled ? "cancelled" : "failed",
        request,
        manifest: null,
        error: cancelled ? null : cause instanceof Error ? cause.message : "Capture failed.",
      });
    } finally {
      this.#controllers.delete(id);
    }
  }
}

const writeOutput = async (root: string, relativePath: string, bytes: Uint8Array): Promise<void> => {
  if (path.isAbsolute(relativePath) || relativePath.split(/[\\/]/u).includes("..")) {
    throw new Error("Capture renderer returned an unsafe output path.");
  }
  const target = path.resolve(root, relativePath);
  const resolvedRoot = path.resolve(root);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("Capture output escaped the project root.");
  }
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
};
