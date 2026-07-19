import { copyFile, mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { builtInDeliveryProfiles } from "../../packages/render/src/index.js";
import { serializeBigInt, type ProjectCommandEnvelope } from "../../packages/schema/src/index.js";
import {
  AssetApiService,
  ProjectSessionService,
  RenderApiService,
  StudioJobRegistry,
} from "../../apps/studio-server/src/index.js";
import { createLocalRenderExecutor } from "../../apps/studio-server/src/local-render-executor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("production render capability", () => {
  it("fails closed instead of publishing a synthetic slate when no authoritative compositor is wired", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-local-render-"));
    temporaryDirectories.push(parent);
    const projects = new ProjectSessionService();
    await projects.create({
      targetPath: path.join(parent, "Launch Film.chai"),
      title: "Launch Film",
      starter: "launch-film",
    });
    const snapshot = await projects.snapshot();
    const profile = builtInDeliveryProfiles().find((candidate) => candidate.outputKind === "still");
    if (profile === undefined) throw new Error("The built-in still profile is unavailable.");
    const jobs = new StudioJobRegistry();
    const renders = new RenderApiService({
      projects,
      jobs,
    });
    const scope = { kind: "frame" as const, frame: "48" };
    const preflight = await renders.preflight({
      profile,
      scope,
      expectedRevisionId: snapshot.pointer.revisionId,
    });
    expect(preflight.executable).toBe(false);
    expect(preflight.findings).toContainEqual(
      expect.objectContaining({ code: "render.compositor.unavailable", blocking: true }),
    );
    await expect(
      renders.enqueue({
        profile,
        scope,
        name: "Launch Film · frame 48",
        priority: 0,
        actor: { id: "actor-local-render", kind: "user", sessionId: "session-local-render" },
        expectedRevisionId: snapshot.pointer.revisionId,
        correlationId: "correlation-local-render",
      }),
    ).rejects.toThrow("Render preflight contains blocking findings.");
    expect(await renders.outputs()).toEqual([]);
  });

  it("executes a local immutable still through preflight, queue, artifact, and receipt authority", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-local-render-"));
    temporaryDirectories.push(parent);
    const projects = new ProjectSessionService();
    const root = path.join(parent, "Exact Still.chai");
    await projects.create({ targetPath: root, title: "Exact Still" });
    const assetDirectory = path.join(root, "assets", "test");
    await mkdir(assetDirectory, { recursive: true });
    const sourcePath = path.join(assetDirectory, "source.png");
    await copyFile(
      path.join(
        process.cwd(),
        "spikes",
        "milestone-0",
        "fixtures",
        "canonical",
        "assets",
        "alpha-sequence",
        "frame-0001.png",
      ),
      sourcePath,
    );
    const jobs = new StudioJobRegistry();
    const assets = new AssetApiService({ projects, jobs });
    let snapshot = await projects.snapshot();
    const imported = await assets.importAsset({
      sourcePath,
      id: "asset-local-render-image-0001",
      kind: "image",
      rights: "owned",
      context: {
        baseRevisionId: snapshot.pointer.revisionId,
        idempotencyId: "idempotency-local-render-asset-0001",
        actor: { id: "actor-local-render", kind: "user", sessionId: "session-local-render" },
      },
    });
    expect(imported.receipt.status).toBe("committed");
    snapshot = await projects.snapshot();
    const command: ProjectCommandEnvelope = {
      schemaVersion: "1.0.0",
      commandId: "command-local-render-timeline-0001",
      idempotencyId: "idempotency-local-render-timeline-0001",
      actor: { id: "actor-local-render", kind: "user", sessionId: "session-local-render" },
      projectId: snapshot.project.projectId,
      correlationId: "correlation-local-render-timeline-0001",
      issuedAt: "2026-07-17T00:00:00.000Z",
      capability: { name: "timeline-edit", version: "1.0.0" },
      payloadVersion: "1.0.0",
      affectedEntityIds: [
        snapshot.timeline.timelineId,
        "track-local-render-video-0001",
        "clip-local-render-image-0001",
      ],
      declaredScope: "destructive",
      validationOnly: false,
      baseRevisionId: snapshot.pointer.revisionId,
      authorizationId: "authorization-local-render-timeline-0001",
      kind: "timeline.replace",
      payload: {
        timeline: {
          ...snapshot.timeline,
          durationFrames: serializeBigInt(3n),
          tracks: [
            {
              id: "track-local-render-video-0001",
              kind: "video",
              name: "V1",
              order: 0,
              locked: false,
              hidden: false,
              muted: false,
              solo: false,
              clips: [
                {
                  id: "clip-local-render-image-0001",
                  assetId: imported.asset.id,
                  engine: "shared",
                  startFrame: serializeBigInt(0n),
                  durationFrames: serializeBigInt(3n),
                  sourceInFrame: serializeBigInt(0n),
                  sourceDurationFrames: serializeBigInt(1n),
                  capability: "unified",
                  audioBusId: null,
                  name: "Red square",
                },
              ],
            },
          ],
        },
      },
    };
    const timelineReceipt = await projects.executeCommand(command);
    expect(timelineReceipt, JSON.stringify(timelineReceipt, null, 2)).toMatchObject({ status: "committed" });
    snapshot = await projects.snapshot();
    const profile = builtInDeliveryProfiles().find((candidate) => candidate.outputKind === "still");
    if (profile === undefined) throw new Error("The built-in still profile is unavailable.");
    const renders = new RenderApiService({
      projects,
      jobs,
      executeRender: createLocalRenderExecutor(projects),
      compositorMode: "local-full",
    });
    const scope = { kind: "frame" as const, frame: "1" };
    await expect(
      renders.preflight({ profile, scope, expectedRevisionId: snapshot.pointer.revisionId }),
    ).resolves.toMatchObject({ executable: true });
    const queued = await renders.enqueue({
      profile,
      scope,
      name: "Exact local still",
      priority: 0,
      actor: { id: "actor-local-render", kind: "user", sessionId: "session-local-render" },
      expectedRevisionId: snapshot.pointer.revisionId,
      correlationId: "correlation-local-render-execute-0001",
    });
    const completed = await jobs.wait(queued.job.id);
    expect(completed, completed.error ?? "local render failed").toMatchObject({ status: "completed" });
    const output = (await renders.outputs())[0];
    if (output === undefined) throw new Error("The local render output was not committed.");
    expect(output).toMatchObject({
      sourceRevisionId: snapshot.pointer.revisionId,
      scope,
    });
    const primary = output.artifacts.find((artifact) => artifact.primary);
    if (primary === undefined) throw new Error("The local render output has no primary artifact.");
    expect(primary.relativePath).toMatch(/frame-1\.png$/u);
    expect((await readFile(path.join(root, primary.relativePath))).subarray(1, 4).toString("ascii")).toBe(
      "PNG",
    );
    await expect(renders.receipt(output.id)).resolves.toMatchObject({
      base: {
        dag: { range: { startFrame: "1", endFrameExclusive: "2" } },
        audio: { status: "not-applicable" },
      },
    });
    await renders.queue();
  });
});
