import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditRevisionStorage,
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  markProjectCleanShutdown,
  markProjectOpened,
  reconcileWorkingSources,
  sha256CanonicalJson,
  type ProjectRenameCommand,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("repeated close and reopen stability", () => {
  it("preserves authoritative bytes and semantic state without drift", async () => {
    const parent = await mkdtemp(path.join(tmpdir(), "chai-reopen-drift-"));
    temporaryRoots.push(parent);
    const root = path.join(parent, "reopen.chai");
    await initializeProjectFolder(root, {
      title: "Before reopen",
      projectId: "project-reopen-0001",
      revisionId: "revision-reopen-0001",
      actorId: "actor-reopen-0001",
      sessionId: "session-reopen-0001",
      now: new Date("2026-07-15T00:00:00Z"),
    });
    await executeProjectCommand(root, renameCommand(), {
      revisionId: "revision-reopen-0002",
      now: () => new Date("2026-07-15T00:01:00Z"),
    });
    const baseline = await loadCurrentProjectRevision(root);
    const baselinePointerBytes = await readFile(path.join(root, "current-revision.json"), "utf8");
    const baselineSemanticHash = sha256CanonicalJson({
      project: baseline.project,
      timeline: baseline.timeline,
      assets: baseline.assets,
      settings: baseline.settings,
      approvalState: baseline.approvalState,
      transaction: baseline.transaction,
    });

    for (let cycle = 0; cycle < 10; cycle += 1) {
      await markProjectOpened(root);
      const reopened = await loadCurrentProjectRevision(root);
      expect(reopened.revisionHash, `cycle ${String(cycle)}`).toBe(baseline.revisionHash);
      expect(
        sha256CanonicalJson({
          project: reopened.project,
          timeline: reopened.timeline,
          assets: reopened.assets,
          settings: reopened.settings,
          approvalState: reopened.approvalState,
          transaction: reopened.transaction,
        }),
      ).toBe(baselineSemanticHash);
      expect(await reconcileWorkingSources(root)).toEqual([]);
      await markProjectCleanShutdown(root);
    }
    expect(await readFile(path.join(root, "current-revision.json"), "utf8")).toBe(baselinePointerBytes);
    expect((await auditRevisionStorage(root)).passed).toBe(true);
  });
});

const renameCommand = (): ProjectRenameCommand => ({
  schemaVersion: "1.0.0",
  commandId: "command-reopen-0001",
  idempotencyId: "idempotency-reopen-0001",
  actor: { id: "actor-reopen-0001", kind: "user", sessionId: "session-reopen-0001" },
  projectId: "project-reopen-0001",
  correlationId: "correlation-reopen-0001",
  issuedAt: "2026-07-15T00:00:30Z",
  capability: { name: "project-core", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: ["project-reopen-0001"],
  declaredScope: "mutation",
  validationOnly: false,
  baseRevisionId: "revision-reopen-0001",
  authorizationId: null,
  kind: "project.rename",
  payload: { title: "After reopen" },
});
