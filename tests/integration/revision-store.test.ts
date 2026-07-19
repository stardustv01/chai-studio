import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  auditRevisionStorage,
  buildOptimisticConflictReport,
  commitProjectRevision,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  stringifyCanonicalJson,
  type CommitProjectRevisionOptions,
  type LoadedProjectRevision,
  type RevisionCommitCheckpoint,
  type RevisionContentDocuments,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("immutable revision store", () => {
  it("publishes a complete revision before atomically advancing the pointer", async () => {
    const root = await initializedProject();
    const current = await loadCurrentProjectRevision(root);
    const checkpoints: RevisionCommitCheckpoint[] = [];
    const result = await commitProjectRevision(root, {
      baseRevisionId: current.pointer.revisionId,
      revisionId: "revision-commit-0002",
      commandId: "command-title-0001",
      actor: { id: "actor-user-0001", kind: "user", sessionId: "session-test-0001" },
      commandSummary: "Rename project",
      diffSummary: "Changed the project title.",
      affectedEntityIds: [current.project.projectId],
      documents: content(current, { title: "Second Light" }),
      now: new Date("2026-07-15T00:01:00Z"),
      checkpoint: (checkpoint) => {
        checkpoints.push(checkpoint);
      },
    });

    expect(result.project.title).toBe("Second Light");
    expect(result.previousRevisionId).toBe("revision-initializer-0001");
    expect(result.transaction.parentRevisionId).toBe("revision-initializer-0001");
    expect(result.transaction.resultingRevisionId).toBe("revision-commit-0002");
    expect(result.transaction.beforeHashes["transaction.json"]).toMatch(/^[a-f0-9]{64}$/);
    expect(result.transaction.afterHashes["chai.project.json"]).toMatch(/^[a-f0-9]{64}$/);
    expect(checkpoints.at(-2)).toBe("before-pointer-swap");
    expect(checkpoints.at(-1)).toBe("after-pointer-swap");

    const reopened = await loadCurrentProjectRevision(root);
    expect(reopened.pointer.revisionId).toBe("revision-commit-0002");
    expect(reopened.revisionHash).toBe(result.revisionHash);
    expect((await auditRevisionStorage(root)).passed).toBe(true);
  });

  it("keeps the old pointer authoritative when a crash interrupts staging", async () => {
    const root = await initializedProject();
    const current = await loadCurrentProjectRevision(root);
    await expect(
      commitProjectRevision(
        root,
        commitOptions(current, "revision-crash-staging", "after-document:timeline.json"),
      ),
    ).rejects.toThrow("simulated crash");

    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-initializer-0001");
    const audit = await auditRevisionStorage(root);
    expect(audit.stagingEntries).toHaveLength(1);
    expect(audit.orphanRevisionIds).toEqual([]);
    expect(audit.passed).toBe(false);
  });

  it("detects a complete orphan if a crash occurs after publish but before pointer swap", async () => {
    const root = await initializedProject();
    const current = await loadCurrentProjectRevision(root);
    await expect(
      commitProjectRevision(
        root,
        commitOptions(current, "revision-crash-published", "after-revision-publish"),
      ),
    ).rejects.toThrow("simulated crash");

    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-initializer-0001");
    const audit = await auditRevisionStorage(root);
    expect(audit.stagingEntries).toEqual([]);
    expect(audit.orphanRevisionIds).toEqual(["revision-crash-published"]);
  });

  it("treats the new complete revision as authoritative if the process dies after pointer swap", async () => {
    const root = await initializedProject();
    const current = await loadCurrentProjectRevision(root);
    await expect(
      commitProjectRevision(
        root,
        commitOptions(current, "revision-crash-after-pointer", "after-pointer-swap"),
      ),
    ).rejects.toThrow("simulated crash");

    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-crash-after-pointer");
    expect((await auditRevisionStorage(root)).passed).toBe(true);
  });

  it("rejects stale writers and hash-tampered authoritative revisions", async () => {
    const root = await initializedProject();
    const current = await loadCurrentProjectRevision(root);
    await commitProjectRevision(root, commitOptions(current, "revision-valid-0002"));
    await expect(
      commitProjectRevision(root, commitOptions(current, "revision-stale-0003")),
    ).rejects.toMatchObject({
      code: "revision.optimistic-conflict",
    });
    const conflict = await buildOptimisticConflictReport(
      root,
      "revision-initializer-0001",
      "revision-valid-0002",
    );
    expect(conflict.changedDocuments).toContain("chai.project.json");
    expect(conflict.changedDocuments).toContain("transaction.json");
    expect(conflict.changedEntityIds).toEqual(["project-revision-store-0001"]);

    const projectPath = path.join(root, "revisions", "revision-valid-0002", "chai.project.json");
    const project = JSON.parse(await readFile(projectPath, "utf8")) as Record<string, unknown>;
    await writeFile(projectPath, stringifyCanonicalJson({ ...project, title: "Tampered" }), "utf8");
    await expect(loadCurrentProjectRevision(root)).rejects.toMatchObject({
      code: "revision.pointer.hash-mismatch",
    });
  });
});

const initializedProject = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(tmpdir(), "chai-revision-store-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "revision-store.chai");
  await initializeProjectFolder(root, {
    title: "First Light",
    projectId: "project-revision-store-0001",
    revisionId: "revision-initializer-0001",
    actorId: "actor-user-0001",
    sessionId: "session-test-0001",
    now: new Date("2026-07-15T00:00:00Z"),
  });
  expect(await readdir(path.join(root, "revisions"))).toEqual(["revision-initializer-0001"]);
  return root;
};

const content = (
  current: LoadedProjectRevision,
  projectChange: Partial<LoadedProjectRevision["project"]> = {},
): RevisionContentDocuments => ({
  project: { ...current.project, ...projectChange },
  timeline: current.timeline,
  assets: current.assets,
  settings: current.settings,
  approvalState: current.approvalState,
});

const commitOptions = (
  current: LoadedProjectRevision,
  revisionId: string,
  crashAt?: RevisionCommitCheckpoint,
): CommitProjectRevisionOptions => ({
  baseRevisionId: current.pointer.revisionId,
  revisionId,
  commandId: `${revisionId}:command`,
  actor: { id: "actor-user-0001", kind: "user" as const, sessionId: "session-test-0001" },
  commandSummary: "Rename project",
  diffSummary: "Changed the project title.",
  affectedEntityIds: [current.project.projectId],
  documents: content(current, { title: `${current.project.title} revised` }),
  now: new Date("2026-07-15T00:01:00Z"),
  ...(crashAt === undefined
    ? {}
    : {
        checkpoint: (point: RevisionCommitCheckpoint) => {
          if (point === crashAt) throw new Error(`simulated crash at ${point}`);
        },
      }),
});
