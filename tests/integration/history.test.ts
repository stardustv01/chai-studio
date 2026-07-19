import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  beginAsyncOperation,
  completeAsyncOperation,
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  type HistoryMoveCommand,
  type ProjectRenameCommand,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("persistent undo and redo", () => {
  it("blocks history movement while an asynchronous operation owns a revision snapshot", async () => {
    const root = await initializedProject();
    await executeProjectCommand(root, rename("revision-history-0001", "Second", "barrier-0002"), {
      revisionId: "revision-history-barrier-0002",
      now: clock(2),
    });
    const barrier = await beginAsyncOperation(root, {
      kind: "render",
      actorId: "actor-history-0001",
      operationId: "operation-render-test-0001",
      now: new Date("2026-07-15T00:02:30Z"),
    });
    const blocked = await executeProjectCommand(
      root,
      history("undo", "revision-history-barrier-0002", 1, "barrier-0003"),
      { revisionId: "revision-history-barrier-0003", now: clock(3) },
    );
    expect(blocked).toMatchObject({
      status: "failed",
      error: { code: "history.async-operation.active" },
    });
    expect(await completeAsyncOperation(root, barrier.id)).toBe(true);
    const undone = await executeProjectCommand(
      root,
      history("undo", "revision-history-barrier-0002", 1, "barrier-0004"),
      { revisionId: "revision-history-barrier-0004", now: clock(4) },
    );
    expect(undone.status).toBe("committed");
    expect((await loadCurrentProjectRevision(root)).project.title).toBe("First");
  });

  it("restores and reapplies immutable content across relaunches", async () => {
    const root = await initializedProject();
    await executeProjectCommand(root, rename("revision-history-0001", "Second", "0002"), {
      revisionId: "revision-history-0002",
      now: clock(2),
    });
    await executeProjectCommand(root, rename("revision-history-0002", "Third", "0003"), {
      revisionId: "revision-history-0003",
      now: clock(3),
    });

    const undo = await executeProjectCommand(root, history("undo", "revision-history-0003", 1, "0004"), {
      revisionId: "revision-history-0004",
      now: clock(4),
    });
    expect(undo.status).toBe("committed");
    let reopened = await loadCurrentProjectRevision(root);
    expect(reopened.project.title).toBe("Second");
    expect(reopened.transaction.history).toEqual({
      action: "undo",
      contentRevisionId: "revision-history-0002",
      undoStack: ["revision-history-0001"],
      redoStack: ["revision-history-0003"],
    });

    const redo = await executeProjectCommand(root, history("redo", "revision-history-0004", 1, "0005"), {
      revisionId: "revision-history-0005",
      now: clock(5),
    });
    expect(redo.status).toBe("committed");
    reopened = await loadCurrentProjectRevision(root);
    expect(reopened.project.title).toBe("Third");
    expect(reopened.transaction.history).toEqual({
      action: "redo",
      contentRevisionId: "revision-history-0003",
      undoStack: ["revision-history-0001", "revision-history-0002"],
      redoStack: [],
    });
  });

  it("supports multi-step undo and clears redo after a divergent edit", async () => {
    const root = await initializedProject();
    await executeProjectCommand(root, rename("revision-history-0001", "Second", "1002"), {
      revisionId: "revision-history-1002",
      now: clock(2),
    });
    await executeProjectCommand(root, rename("revision-history-1002", "Third", "1003"), {
      revisionId: "revision-history-1003",
      now: clock(3),
    });
    await executeProjectCommand(root, history("undo", "revision-history-1003", 2, "1004"), {
      revisionId: "revision-history-1004",
      now: clock(4),
    });
    expect((await loadCurrentProjectRevision(root)).project.title).toBe("First");

    await executeProjectCommand(root, rename("revision-history-1004", "Divergent", "1005"), {
      revisionId: "revision-history-1005",
      now: clock(5),
    });
    const current = await loadCurrentProjectRevision(root);
    expect(current.transaction.history.redoStack).toEqual([]);
    expect(current.transaction.history.undoStack).toEqual(["revision-history-0001"]);
    const failedRedo = await executeProjectCommand(
      root,
      history("redo", "revision-history-1005", 1, "1006"),
      { revisionId: "revision-history-1006", now: clock(6) },
    );
    expect(failedRedo).toMatchObject({
      status: "failed",
      error: { code: "history.redo.exhausted" },
    });
    expect((await loadCurrentProjectRevision(root)).project.title).toBe("Divergent");
  });
});

const initializedProject = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(tmpdir(), "chai-history-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "history.chai");
  await initializeProjectFolder(root, {
    title: "First",
    projectId: "project-history-0001",
    revisionId: "revision-history-0001",
    actorId: "actor-history-0001",
    sessionId: "session-history-0001",
    now: new Date("2026-07-15T00:00:00Z"),
  });
  return root;
};

const common = {
  schemaVersion: "1.0.0",
  actor: { id: "actor-history-0001", kind: "user", sessionId: "session-history-0001" },
  projectId: "project-history-0001",
  issuedAt: "2026-07-15T00:00:30Z",
  capability: { name: "project-history", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: ["project-history-0001"],
  declaredScope: "mutation",
  validationOnly: false,
  authorizationId: null,
} as const;

const rename = (baseRevisionId: string, title: string, suffix: string): ProjectRenameCommand => ({
  ...common,
  commandId: `command-rename-${suffix}`,
  idempotencyId: `idempotency-rename-${suffix}`,
  correlationId: `correlation-rename-${suffix}`,
  baseRevisionId,
  kind: "project.rename",
  payload: { title },
});

const history = (
  action: "undo" | "redo",
  baseRevisionId: string,
  steps: number,
  suffix: string,
): HistoryMoveCommand => ({
  ...common,
  commandId: `command-${action}-${suffix}`,
  idempotencyId: `idempotency-${action}-${suffix}`,
  correlationId: `correlation-${action}-${suffix}`,
  baseRevisionId,
  kind: `history.${action}`,
  payload: { steps },
});

const clock = (minute: number) => (): Date =>
  new Date(`2026-07-15T00:${String(minute).padStart(2, "0")}:00Z`);
