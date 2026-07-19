import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { builtInDeliveryProfiles } from "@chai-studio/render";
import { renderFullTimeline } from "./full-timeline-compositor.js";
import type { ProjectSessionService } from "./project-service.js";

export interface ProgramFramePayload {
  readonly bytes: Buffer;
  readonly contentHash: string;
  readonly frame: string;
  readonly revisionId: string;
}

export class ProgramFrameService {
  readonly #projects: ProjectSessionService;
  readonly #cache = new Map<string, ProgramFramePayload>();
  readonly #inFlight = new Map<string, Promise<ProgramFramePayload>>();

  constructor(projects: ProjectSessionService) {
    this.#projects = projects;
  }

  async frame(frame: string): Promise<ProgramFramePayload> {
    if (!/^(?:0|[1-9][0-9]{0,11})$/u.test(frame)) throw new Error("Program frame identity is invalid.");
    const snapshot = await this.#projects.snapshot();
    const masterFrame = BigInt(frame);
    if (masterFrame < 0n || masterFrame >= BigInt(snapshot.timeline.durationFrames)) {
      throw new Error("Program frame is outside the current timeline.");
    }
    const cacheKey = `${snapshot.pointer.revisionId}:${frame}`;
    const cached = this.#cache.get(cacheKey);
    if (cached !== undefined) return cached;
    const pending = this.#inFlight.get(cacheKey) ?? this.#render(cacheKey, frame, snapshot);
    this.#inFlight.set(cacheKey, pending);
    try {
      return await pending;
    } finally {
      this.#inFlight.delete(cacheKey);
    }
  }

  async #render(
    cacheKey: string,
    frame: string,
    snapshot: Awaited<ReturnType<ProjectSessionService["snapshot"]>>,
  ): Promise<ProgramFramePayload> {
    const profile = builtInDeliveryProfiles().find(
      (candidate) => candidate.outputKind === "still" && candidate.container === "png",
    );
    if (profile === undefined) throw new Error("Program frame profile is unavailable.");
    const outputDirectory = await mkdtemp(path.join(os.tmpdir(), "chai-program-frame-"));
    try {
      const rendered = await renderFullTimeline({
        projects: this.#projects,
        snapshot,
        profile,
        scope: { kind: "frame", frame },
        outputDirectory,
        signal: new AbortController().signal,
        report: () => undefined,
      });
      const bytes = await readFile(path.join(outputDirectory, rendered.primaryRelativePath));
      const payload: ProgramFramePayload = {
        bytes,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        frame,
        revisionId: snapshot.pointer.revisionId,
      };
      this.#cache.set(cacheKey, payload);
      while (this.#cache.size > 8) {
        const oldest = this.#cache.keys().next().value;
        if (oldest === undefined) break;
        this.#cache.delete(oldest);
      }
      return payload;
    } finally {
      await rm(outputDirectory, { recursive: true, force: true });
    }
  }
}
