import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { CaptureRequest } from "../../packages/bridge/src/index.js";
import { CaptureApiService } from "../../apps/studio-server/src/capture-service.js";
import { StudioInteractionService } from "../../apps/studio-server/src/interaction-service.js";
import { StudioJobRegistry } from "../../apps/studio-server/src/job-registry.js";
import { PreviewSessionService } from "../../apps/studio-server/src/preview-service.js";
import { ProjectSessionService } from "../../apps/studio-server/src/project-service.js";
import { RenderApiService } from "../../apps/studio-server/src/render-service.js";

const roots: string[] = [];
const interactions: StudioInteractionService[] = [];

afterEach(async () => {
  await Promise.all(interactions.splice(0).map((service) => service.shutdown()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("exact capture service", () => {
  it("persists final-compositor manifests for every exact monitor capture mode", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-exact-capture-"));
    roots.push(parent);
    const projects = new ProjectSessionService();
    await projects.create({
      targetPath: path.join(parent, "Exact Capture.chai"),
      title: "Exact Capture",
      starter: "showcase",
    });
    const preview = new PreviewSessionService({ projects });
    await preview.load();
    const interaction = new StudioInteractionService({ projects, preview });
    interactions.push(interaction);
    const captures = new CaptureApiService({
      projects,
      interactions: interaction,
      renders: new RenderApiService({ projects, jobs: new StudioJobRegistry() }),
    });
    const selectedClipId = (await projects.snapshot()).timeline.selection?.primaryId;
    if (selectedClipId === null || selectedClipId === undefined) {
      throw new Error("Showcase selection is missing.");
    }
    const requests: readonly CaptureRequest[] = [
      request("isolated-selection", ["0"], null, [selectedClipId]),
      request("before-effects", ["0"], null, [selectedClipId]),
      request("alpha", ["0"], null, []),
      request("range", ["0", "1"], { startFrame: "0", endFrameExclusive: "2" }, []),
      request("contact-sheet", ["0", "1"], { startFrame: "0", endFrameExclusive: "2" }, []),
    ];

    for (const captureRequest of requests) {
      const started = await captures.start(captureRequest);
      await expect.poll(() => captures.state(started.id).status, { timeout: 20_000 }).toBe("completed");
      const completed = captures.state(started.id);
      expect(completed.manifest).toMatchObject({
        kind: captureRequest.kind,
        mode: "fidelity",
        renderer: "final-compositor",
        parityEligible: true,
        effectsApplied: captureRequest.kind !== "before-effects",
        alpha: captureRequest.kind === "alpha",
      });
      const outputs = completed.manifest?.outputPaths ?? [];
      expect(outputs).toHaveLength(captureRequest.kind === "range" ? 2 : 1);
      for (const output of outputs) {
        await expect(readFile(path.join(projects.openRootPath(), output))).resolves.toSatisfy(
          (bytes: Buffer) => bytes.subarray(1, 4).toString("ascii") === "PNG",
        );
      }
    }
  }, 30_000);
});

const request = (
  kind: CaptureRequest["kind"],
  frames: readonly string[],
  frameRange: CaptureRequest["frameRange"],
  isolatedEntityIds: readonly string[],
): CaptureRequest => ({
  kind,
  mode: "fidelity",
  frames,
  frameRange,
  isolatedEntityIds,
  effectsApplied: kind !== "before-effects",
  alpha: kind === "alpha",
  comparisonSide: null,
});
