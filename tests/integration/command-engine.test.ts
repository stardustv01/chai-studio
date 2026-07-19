import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  type ProjectRenameCommand,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("auditable command transaction engine", () => {
  it("commits a validated envelope and exact-replays its durable idempotency receipt", async () => {
    const root = await initializedProject();
    const command = renameCommand();
    const receipt = await executeProjectCommand(root, command, {
      revisionId: "revision-command-0002",
      now: () => new Date("2026-07-15T00:01:00Z"),
    });
    expect(receipt).toMatchObject({
      status: "committed",
      replayed: false,
      baseRevisionId: "revision-command-0001",
      resultingRevisionId: "revision-command-0002",
      error: null,
    });

    const current = await loadCurrentProjectRevision(root);
    expect(current.project.title).toBe("Second Light");
    expect(current.transaction).toMatchObject({
      commandId: command.commandId,
      idempotencyId: command.idempotencyId,
      correlationId: command.correlationId,
      commandEnvelopeHash: receipt.commandEnvelopeHash,
      capability: command.capability,
      declaredScope: "mutation",
      authorizationId: null,
      result: "committed",
    });
    expect(current.transaction.beforeHashes["chai.project.json"]).toMatch(/^[a-f0-9]{64}$/);
    expect(current.transaction.afterHashes["chai.project.json"]).toMatch(/^[a-f0-9]{64}$/);

    const replay = await executeProjectCommand(root, command, {
      revisionId: "revision-should-not-exist",
      now: () => new Date("2026-07-15T00:02:00Z"),
    });
    expect(replay).toEqual({ ...receipt, replayed: true });
    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-command-0002");
  });

  it("rejects idempotency reuse for a different payload", async () => {
    const root = await initializedProject();
    const command = renameCommand();
    await executeProjectCommand(root, command, {
      revisionId: "revision-command-0002",
      now: () => new Date("2026-07-15T00:01:00Z"),
    });
    await expect(
      executeProjectCommand(root, { ...command, payload: { title: "Different payload" } }),
    ).rejects.toMatchObject({ code: "command.idempotency.reused" });
  });

  it("records validation-only and stale-base decisions without mutating authority", async () => {
    const root = await initializedProject();
    const validation = await executeProjectCommand(
      root,
      {
        ...renameCommand(),
        commandId: "command-validate-0001",
        idempotencyId: "idempotency-validate-0001",
        validationOnly: true,
      },
      { now: () => new Date("2026-07-15T00:01:00Z") },
    );
    expect(validation.status).toBe("validated");
    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-command-0001");

    const stale = await executeProjectCommand(
      root,
      {
        ...renameCommand(),
        commandId: "command-stale-0001",
        idempotencyId: "idempotency-stale-0001",
        baseRevisionId: "revision-missing-0000",
      },
      { now: () => new Date("2026-07-15T00:02:00Z") },
    );
    expect(stale).toMatchObject({
      status: "failed",
      error: { code: "command.base-revision.stale", retryable: true },
    });
    const replay = await executeProjectCommand(root, {
      ...renameCommand(),
      commandId: "command-stale-0001",
      idempotencyId: "idempotency-stale-0001",
      baseRevisionId: "revision-missing-0000",
    });
    expect(replay.replayed).toBe(true);
    expect(replay.status).toBe("failed");
  });
});

const initializedProject = async (): Promise<string> => {
  const parent = await mkdtemp(path.join(tmpdir(), "chai-command-engine-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "command.chai");
  await initializeProjectFolder(root, {
    title: "First Light",
    projectId: "project-command-0001",
    revisionId: "revision-command-0001",
    actorId: "actor-command-0001",
    sessionId: "session-command-0001",
    now: new Date("2026-07-15T00:00:00Z"),
  });
  return root;
};

const renameCommand = (): ProjectRenameCommand => ({
  schemaVersion: "1.0.0",
  commandId: "command-rename-0001",
  idempotencyId: "idempotency-rename-0001",
  actor: { id: "actor-command-0001", kind: "user", sessionId: "session-command-0001" },
  projectId: "project-command-0001",
  correlationId: "correlation-rename-0001",
  issuedAt: "2026-07-15T00:00:30Z",
  capability: { name: "project-core", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: ["project-command-0001"],
  declaredScope: "mutation",
  validationOnly: false,
  baseRevisionId: "revision-command-0001",
  authorizationId: null,
  kind: "project.rename",
  payload: { title: "Second Light" },
});
