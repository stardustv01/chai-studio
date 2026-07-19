import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { StudioEventHub } from "../../apps/studio-server/src/event-hub.js";
import { StudioJobRegistry } from "../../apps/studio-server/src/job-registry.js";
import { ProjectSessionService } from "../../apps/studio-server/src/project-service.js";
import { RegenerableStudioIndex } from "../../apps/studio-server/src/regenerable-index.js";
import {
  recoverInvalidProjectPointer,
  ReliabilityService,
  scanProjectPointerRecovery,
} from "../../apps/studio-server/src/reliability-service.js";
import { RenderApiService } from "../../apps/studio-server/src/render-service.js";
import { RuntimeHygieneService } from "../../apps/studio-server/src/runtime-hygiene.js";
import {
  commitProjectRevision,
  createProjectAutosave,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  stringifyCanonicalJson,
  type RevisionContentDocuments,
} from "../../packages/schema/src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("P24 read-only repair scanner and explicit repairs", () => {
  it("finds stale lock, interrupted storage, corrupt cache, and autosave without changing them", async () => {
    const fixture = await createFixture(new Date("2026-07-16T21:00:00.000Z"));
    const root = fixture.root;
    await mkdir(path.join(root, "revisions", ".staging-interrupted-revision"), { recursive: true });
    await mkdir(path.join(root, "renders", "output-incomplete"), { recursive: true });
    await writeFile(path.join(root, "renders", "output-incomplete", "partial.bin"), "partial");
    await writeFile(
      path.join(root, ".chai-lock.json"),
      stringifyCanonicalJson({
        schemaVersion: "1.0.0",
        token: "stale-lock-token",
        ownerId: "actor-stale-lock",
        sessionId: "session-stale-lock",
        processId: 99_999,
        acquiredAt: "2026-07-16T19:00:00.000Z",
        heartbeatAt: "2026-07-16T19:00:00.000Z",
        expiresAt: "2026-07-16T19:00:15.000Z",
      }),
    );
    const cacheDirectory = path.join(root, ".chai-cache", "render", "artifacts", "aa", "cache-corrupt");
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(path.join(cacheDirectory, "artifact.bin"), "corrupt");
    await writeFile(
      path.join(cacheDirectory, "metadata.json"),
      JSON.stringify({
        artifactHash: createHash("sha256").update("expected").digest("hex"),
        descriptor: { extension: "bin" },
      }),
    );
    await createProjectAutosave(root, {
      reason: "crash-recovery",
      autosaveId: "autosave-reliability-0001",
      now: new Date("2026-07-16T20:30:00.000Z"),
    });
    const pointerBefore = await readFile(path.join(root, "current-revision.json"), "utf8");

    const health = await fixture.reliability.startupHealth();
    expect(health.checks.map((check) => check.id)).toEqual([
      "health.browser",
      "health.engines",
      "health.ffmpeg-codecs",
      "health.gpu-backend",
      "health.fonts",
      "health.permissions",
      "health.disk",
      "health.project-integrity",
    ]);
    expect(health.checks.find((check) => check.id === "health.browser")).toMatchObject({
      state: "passed",
      evidence: { identity: "playwright-managed:test-runtime", launched: false },
    });
    expect(health.status).toBe("blocked");
    const scan = await fixture.reliability.scan();
    expect(scan.readOnly).toBe(true);
    expect(scan.passed).toBe(false);
    expect(scan.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        "repair.lock.stale",
        "repair.revision.staging",
        "repair.runtime.incomplete-render",
        "repair.cache.corrupt",
        "repair.autosave.recoverable",
      ]),
    );
    expect(await readFile(path.join(root, "current-revision.json"), "utf8")).toBe(pointerBefore);
    await expect(stat(path.join(root, ".chai-lock.json"))).resolves.toBeDefined();
    await expect(stat(cacheDirectory)).resolves.toBeDefined();

    const lockIssue = scan.issues.find((entry) => entry.code === "repair.lock.stale");
    if (lockIssue === undefined) throw new Error("Stale lock issue missing from fixture scan.");
    const receipt = await fixture.reliability.repair({
      issueId: lockIssue.id,
      action: "clear-stale-lock",
      actor,
    });
    expect(receipt).toMatchObject({
      action: "clear-stale-lock",
      sourceFilesDeleted: false,
      sourceRevisionId: "revision-reliability-0001",
      resultingRevisionId: "revision-reliability-0001",
    });
    await expect(stat(path.join(root, ".chai-lock.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(receipt.evidenceHashes[0]).toMatch(/^[a-f0-9]{64}$/);
    await fixture.runtime.shutdown();
  });

  it("adopts a verified direct-child orphan and records recovery evidence without deleting source", async () => {
    const fixture = await createFixture(new Date("2026-07-16T22:00:00.000Z"));
    const current = await loadCurrentProjectRevision(fixture.root);
    await expect(
      commitProjectRevision(fixture.root, {
        baseRevisionId: current.pointer.revisionId,
        revisionId: "revision-reliability-orphan",
        commandId: "command-reliability-orphan",
        idempotencyId: "idempotency-reliability-orphan",
        correlationId: "correlation-reliability-orphan",
        actor,
        commandSummary: "Interrupted orphan fixture",
        diffSummary: "Publish a complete child and fail before pointer swap.",
        affectedEntityIds: [current.project.projectId],
        documents: currentContent(current),
        now: new Date("2026-07-16T22:30:00.000Z"),
        checkpoint: (point) => {
          if (point === "after-revision-publish") throw new Error("simulated revision-write crash");
        },
      }),
    ).rejects.toThrow("simulated revision-write crash");
    expect((await loadCurrentProjectRevision(fixture.root)).pointer.revisionId).toBe(
      "revision-reliability-0001",
    );
    const scan = await fixture.reliability.scan();
    const orphan = scan.issues.find(
      (entry) => entry.code === "repair.revision.orphan" && entry.entityId === "revision-reliability-orphan",
    );
    if (orphan === undefined) throw new Error("Orphan recovery issue missing from fixture scan.");
    const receipt = await fixture.reliability.repair({
      issueId: orphan.id,
      action: "adopt-orphan",
      targetRevisionId: "revision-reliability-orphan",
      actor,
    });
    expect(receipt).toMatchObject({
      sourceRevisionId: "revision-reliability-0001",
      resultingRevisionId: "revision-reliability-orphan",
      sourceFilesDeleted: false,
    });
    expect((await loadCurrentProjectRevision(fixture.root)).pointer.revisionId).toBe(
      "revision-reliability-orphan",
    );
    await expect(
      stat(path.join(fixture.root, "revisions", "revision-reliability-orphan")),
    ).resolves.toBeDefined();
    await fixture.runtime.shutdown();
  });

  it("repairs an unreadable current pointer only to a verified immutable candidate", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chai-pointer-recovery-"));
    roots.push(parent);
    const root = path.join(parent, "pointer-recovery.chai");
    await initializeProjectFolder(root, {
      title: "Pointer recovery fixture",
      projectId: "project-pointer-recovery",
      revisionId: "revision-pointer-recovery",
      actorId: actor.id,
      sessionId: actor.sessionId,
      now: new Date("2026-07-16T23:00:00.000Z"),
    });
    await writeFile(path.join(root, "current-revision.json"), "{broken-json", "utf8");
    const scan = await scanProjectPointerRecovery(root);
    expect(scan).toMatchObject({
      status: "invalid",
      readOnly: true,
      validCandidateRevisionIds: ["revision-pointer-recovery"],
    });
    await expect(loadCurrentProjectRevision(root)).rejects.toThrow();
    const receipt = await recoverInvalidProjectPointer({
      rootPath: root,
      targetRevisionId: "revision-pointer-recovery",
      actor,
      reason: "Restore the only hash-verified immutable revision after pointer corruption.",
      now: new Date("2026-07-16T23:01:00.000Z"),
    });
    expect(receipt).toMatchObject({
      action: "recover-pointer",
      resultingRevisionId: "revision-pointer-recovery",
      sourceFilesDeleted: false,
    });
    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-pointer-recovery");
  });
});

const actor = {
  id: "actor-reliability-0001",
  kind: "user" as const,
  sessionId: "session-reliability-0001",
};

const createFixture = async (now: Date) => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chai-reliability-"));
  roots.push(parent);
  const root = path.join(parent, "reliability.chai");
  await initializeProjectFolder(root, {
    title: "Reliability fixture",
    projectId: "project-reliability-0001",
    revisionId: "revision-reliability-0001",
    actorId: actor.id,
    sessionId: actor.sessionId,
    now,
  });
  const projects = new ProjectSessionService({ now: () => now });
  await projects.open(root);
  const jobs = new StudioJobRegistry();
  const index = new RegenerableStudioIndex({ projects, jobs });
  const runtime = new RuntimeHygieneService({
    projects,
    jobs,
    index,
    events: new StudioEventHub(),
    now: () => now,
    orphanAgeMs: 0,
    minimumFreeBytes: 0,
  });
  const renders = new RenderApiService({ projects, jobs, now: () => now });
  const reliability = new ReliabilityService({
    projects,
    runtime,
    renders,
    now: () => now,
    browserExecutablePath: process.execPath,
    browserIdentity: "playwright-managed:test-runtime",
  });
  return { root, projects, jobs, index, runtime, renders, reliability };
};

const currentContent = (
  current: Awaited<ReturnType<typeof loadCurrentProjectRevision>>,
): RevisionContentDocuments => ({
  project: current.project,
  timeline: current.timeline,
  assets: current.assets,
  settings: current.settings,
  approvalState: current.approvalState,
});
