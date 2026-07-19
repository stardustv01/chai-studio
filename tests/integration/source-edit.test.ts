import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  abortSourceEdit,
  beginSourceEdit,
  commitSourceEdit,
  executeProjectCommand,
  initializeProjectFolder,
  loadCurrentProjectRevision,
  reconcileWorkingSources,
  readSourceEditSession,
  type SourceEditCommand,
} from "../../packages/schema/src/index.js";

const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map(async (directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("native source edit transaction", () => {
  it("persists begin/commit/abort sessions, diff evidence, and cache invalidation hooks", async () => {
    const before = "export const title = 'before';\n";
    const after = "export const title = 'after';\n";
    const { root } = await initializedSourceProject(before);
    const session = await beginSourceEdit(root, {
      path: "scenes/remotion/scene.tsx",
      actor: { id: "actor-source-0001", kind: "user", sessionId: "session-source-0001" },
      sessionId: "source-session-test-0001",
      now: new Date("2026-07-15T00:00:30Z"),
    });
    expect(await readSourceEditSession(root, session.id)).toEqual(session);
    const invalidations: unknown[] = [];
    const receipt = await commitSourceEdit(root, session.id, {
      content: after,
      revisionId: "revision-source-session-0002",
      now: new Date("2026-07-15T00:01:00Z"),
      invalidateSourceCaches: (event) => {
        invalidations.push(event);
        return Promise.resolve();
      },
    });
    expect(receipt.status).toBe("committed");
    expect(invalidations).toEqual([
      {
        path: "scenes/remotion/scene.tsx",
        beforeHash: hash(before),
        afterHash: hash(after),
      },
    ]);
    await expect(readSourceEditSession(root, session.id)).rejects.toMatchObject({ code: "ENOENT" });
    const transaction = (await loadCurrentProjectRevision(root)).transaction;
    const diff = await readFile(
      path.join(root, "receipts", "source-edits", `${session.id}:commit.diff`),
      "utf8",
    );
    expect(diff).toContain("--- a/scenes/remotion/scene.tsx");
    expect(hash(diff)).toBe(transaction.sourceEdit?.diffHash);

    const abortable = await beginSourceEdit(root, {
      path: "scenes/remotion/scene.tsx",
      actor: { id: "actor-source-0001", kind: "user", sessionId: "session-source-0001" },
      sessionId: "source-session-abort-0002",
    });
    expect(await abortSourceEdit(root, abortable.id)).toBe(true);
    expect(await abortSourceEdit(root, abortable.id)).toBe(false);
  });

  it("validates and commits source authority before materializing the working file", async () => {
    const { root, sourcePath } = await initializedSourceProject("export const title = 'before';\n");
    const command = sourceCommand("export const title = 'before';\n", "export const title = 'after';\n");
    const receipt = await executeProjectCommand(root, command, {
      revisionId: "revision-source-0002",
      now: () => new Date("2026-07-15T00:01:00Z"),
      validateSource: ({ path: candidatePath, content, engine }) =>
        Promise.resolve({
          valid: candidatePath.endsWith("scene.tsx") && content.includes("after") && engine === "remotion",
        }),
    });
    expect(receipt.status).toBe("committed");
    expect(await readFile(sourcePath, "utf8")).toBe(command.payload.content);

    const current = await loadCurrentProjectRevision(root);
    expect(current.project.sources[command.payload.path]).toEqual({
      engine: "remotion",
      contentHash: hash(command.payload.content),
      content: command.payload.content,
    });
    expect(current.transaction.sourceEdit?.path).toBe(command.payload.path);
    expect(current.transaction.sourceEdit?.beforeHash).toBe(hash("export const title = 'before';\n"));
    expect(current.transaction.sourceEdit?.afterHash).toBe(hash(command.payload.content));
    expect(current.transaction.sourceEdit?.diffHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("quarantines a candidate when an external editor changed the source", async () => {
    const before = "export const value = 1;\n";
    const { root, sourcePath } = await initializedSourceProject(before);
    await writeFile(sourcePath, "export const value = 2;\n", "utf8");
    const receipt = await executeProjectCommand(root, sourceCommand(before, "export const value = 3;\n"), {
      revisionId: "revision-source-should-not-commit",
      now: () => new Date("2026-07-15T00:01:00Z"),
    });
    expect(receipt).toMatchObject({
      status: "failed",
      error: { code: "source.edit.external-change", retryable: false },
    });
    expect(await readFile(sourcePath, "utf8")).toBe("export const value = 2;\n");
    expect(await readdir(path.join(root, ".chai-cache", "quarantine", "source-edits"))).toHaveLength(1);
    expect((await loadCurrentProjectRevision(root)).pointer.revisionId).toBe("revision-source-0001");
  });

  it("rejects invalid candidates and repairs working files from revision authority", async () => {
    const before = "export const value = 1;\n";
    const { root, sourcePath } = await initializedSourceProject(before);
    const invalid = await executeProjectCommand(root, sourceCommand(before, "bad source"), {
      revisionId: "revision-source-invalid",
      now: () => new Date("2026-07-15T00:01:00Z"),
      validateSource: () => Promise.resolve({ valid: false, message: "TypeScript parse failed at line 1." }),
    });
    expect(invalid).toMatchObject({
      status: "failed",
      error: { code: "source.edit.validation-failed", message: "TypeScript parse failed at line 1." },
    });

    const validCommand = {
      ...sourceCommand(before, "export const value = 4;\n"),
      commandId: "command-source-valid-0002",
      idempotencyId: "idempotency-source-valid-0002",
    } satisfies SourceEditCommand;
    expect(
      (
        await executeProjectCommand(root, validCommand, {
          revisionId: "revision-source-0002",
          now: () => new Date("2026-07-15T00:02:00Z"),
        })
      ).status,
    ).toBe("committed");
    await writeFile(sourcePath, "corrupt working copy", "utf8");
    expect(await reconcileWorkingSources(root)).toEqual(["scenes/remotion/scene.tsx"]);
    expect(await readFile(sourcePath, "utf8")).toBe(validCommand.payload.content);
    expect(await reconcileWorkingSources(root)).toEqual([]);
  });
});

const initializedSourceProject = async (content: string): Promise<{ root: string; sourcePath: string }> => {
  const parent = await mkdtemp(path.join(tmpdir(), "chai-source-edit-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "source.chai");
  await initializeProjectFolder(root, {
    title: "Source project",
    projectId: "project-source-0001",
    revisionId: "revision-source-0001",
    actorId: "actor-source-0001",
    sessionId: "session-source-0001",
    now: new Date("2026-07-15T00:00:00Z"),
  });
  const sourcePath = path.join(root, "scenes", "remotion", "scene.tsx");
  await writeFile(sourcePath, content, "utf8");
  return { root, sourcePath };
};

const sourceCommand = (before: string, after: string): SourceEditCommand => ({
  schemaVersion: "1.0.0",
  commandId: "command-source-edit-0001",
  idempotencyId: "idempotency-source-edit-0001",
  actor: { id: "actor-source-0001", kind: "user", sessionId: "session-source-0001" },
  projectId: "project-source-0001",
  correlationId: "correlation-source-edit-0001",
  issuedAt: "2026-07-15T00:00:30Z",
  capability: { name: "source-editor", version: "1.0.0" },
  payloadVersion: "1.0.0",
  affectedEntityIds: ["project-source-0001"],
  declaredScope: "source-edit",
  validationOnly: false,
  baseRevisionId: "revision-source-0001",
  authorizationId: null,
  kind: "source.edit",
  payload: { path: "scenes/remotion/scene.tsx", expectedHash: hash(before), content: after },
});

const hash = (content: string): string => createHash("sha256").update(content, "utf8").digest("hex");
